// `bambu slice` — slice an STL into a print-ready .gcode.3mf via the slicer
// sidecar on the Docker host (chosen at the plan gate: a container running the
// bambu-studio-api / orca-slicer-api HTTP service). The agent container itself
// cannot run the GUI-linked slicer AppImage.
//
// HTTP contract (AFKFelix/orca-slicer-api, which the bambuddy images fork):
//   POST /slice-async   multipart: file=<model>, optional *Profile=<json>,
//                       body: printer, preset, filament, bedType, arrange,
//                       orient, exportType; → 202 { requestId, statusUrl }
//   GET  /slice-async/:id          → { status, metadata?, downloadUrl? }
//   GET  /slice-async/:id/result   → the sliced file
//   DELETE /slice-async/:id        → free the job

import { basename } from "node:path";
import type { BambuConfig } from "../config.ts";
import { Exit, type ExitCode } from "../exit.ts";
import { formatMinutes } from "../output.ts";

export interface SliceFlags {
  input?: string;
  output?: string;
  process?: string;
  filament?: string;
  nozzle?: string;
  json?: boolean;
}

interface SliceMetadata {
  printTime?: number;
  filamentUsedG?: number;
  filamentUsedMm?: number;
}

interface JobStatus {
  requestId: string;
  status: "pending" | "processing" | "completed" | "failed";
  metadata?: SliceMetadata;
  downloadUrl?: string;
  error?: string;
}

export class SliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SliceError";
  }
}

function defaultOutput(input: string): string {
  const base = basename(input).replace(/\.(stl|step|stp|3mf)$/i, "");
  return `${base}.gcode.3mf`;
}

export async function cmdSlice(config: BambuConfig, flags: SliceFlags): Promise<ExitCode> {
  if (!flags.input) throw new SliceError("Keine Eingabedatei. Nutzung: bambu slice <datei.stl>");
  const inputFile = Bun.file(flags.input);
  if (!(await inputFile.exists())) throw new SliceError(`Datei nicht gefunden: ${flags.input}`);

  const base = config.slicer.url.replace(/\/$/, "");
  await assertSidecarUp(base);

  const printer = flags.nozzle
    ? config.defaults.printer.replace(/[\d.]+ nozzle/, `${flags.nozzle} nozzle`)
    : config.defaults.printer;

  const form = new FormData();
  form.set("file", new Blob([await inputFile.arrayBuffer()]), basename(flags.input));
  form.set("printer", printer);
  form.set("preset", flags.process ?? config.defaults.process);
  form.set("filament", flags.filament ?? config.defaults.filament);
  form.set("bedType", config.defaults.bedType);
  form.set("arrange", "true");
  form.set("orient", "true");
  form.set("exportType", "3mf");

  const submit = await fetch(`${base}/slice-async`, { method: "POST", body: form });
  if (submit.status !== 202) {
    throw new SliceError(
      `Sidecar lehnte den Auftrag ab (HTTP ${submit.status}): ${await safeText(submit)}`,
    );
  }
  const { requestId } = (await submit.json()) as { requestId: string };

  const job = await pollJob(base, requestId, flags.json ?? false);
  if (job.status === "failed") {
    throw new SliceError(`Slicing fehlgeschlagen: ${job.error ?? "unbekannter Fehler"}`);
  }

  const output = flags.output ?? defaultOutput(flags.input);
  const dl = await fetch(`${base}/slice-async/${requestId}/result`);
  if (!dl.ok) throw new SliceError(`Download fehlgeschlagen (HTTP ${dl.status}).`);
  await Bun.write(output, await dl.arrayBuffer());

  // Best-effort cleanup so the sidecar does not keep the job in memory.
  void fetch(`${base}/slice-async/${requestId}`, { method: "DELETE" }).catch(() => undefined);

  const meta = job.metadata;
  if (flags.json) {
    console.log(JSON.stringify({ output, requestId, metadata: meta }, null, 2));
  } else {
    console.log(`Gesliced → ${output}`);
    if (meta?.printTime)
      console.log(`  Druckzeit: ${formatMinutes(Math.round(meta.printTime / 60))}`);
    if (meta?.filamentUsedG) console.log(`  Filament:  ${meta.filamentUsedG.toFixed(1)} g`);
  }
  return Exit.ok;
}

async function assertSidecarUp(base: string): Promise<void> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new SliceError(
      `Slicer-Sidecar nicht erreichbar unter ${base} (${(err as Error).message}). ` +
        `Läuft der Container? Siehe docs/bambu-setup.md.`,
    );
  }
}

async function pollJob(base: string, id: string, json: boolean): Promise<JobStatus> {
  const deadline = Date.now() + 20 * 60_000; // 20 min hard cap
  let lastStatus = "";
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/slice-async/${id}`);
    if (!res.ok) throw new SliceError(`Status-Abfrage fehlgeschlagen (HTTP ${res.status}).`);
    const job = (await res.json()) as JobStatus;
    if (!json && job.status !== lastStatus) {
      lastStatus = job.status;
      console.error(`… ${job.status}`);
    }
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new SliceError("Slicing-Zeitlimit (20 min) erreicht.");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
