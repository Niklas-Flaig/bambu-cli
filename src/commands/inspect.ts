// `bambu inspect` — read a sliced .gcode.3mf (a ZIP) and report what the
// printer will see: plates, per-plate print time and filament, the printer
// model it was sliced for, and whether the preview thumbnail is present.
// Used as a sanity check before staging a file for printing.

import { unzipSync } from "fflate";
import { Exit, type ExitCode } from "../exit.ts";
import { formatMinutes } from "../output.ts";

export interface InspectFlags {
  input?: string;
  json?: boolean;
}

export class InspectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectError";
  }
}

interface Filament {
  type?: string;
  color?: string;
  usedG?: number;
}

interface Plate {
  index: number;
  gcodePath: string;
  hasThumbnail: boolean;
  printSeconds?: number;
  filaments: Filament[];
}

interface Inspection {
  file: string;
  printerModelId?: string;
  plates: Plate[];
  entryCount: number;
}

function attr(block: string, key: string): string | undefined {
  const m = block.match(new RegExp(`key="${key}"\\s+value="([^"]*)"`));
  return m?.[1];
}

export function inspectArchive(file: string, bytes: Uint8Array): Inspection {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new InspectError(`Kein lesbares 3mf/ZIP: ${(err as Error).message}`);
  }
  const names = Object.keys(entries);
  const gcodes = names.filter((n) => /^Metadata\/plate_\d+\.gcode$/i.test(n)).sort();
  if (gcodes.length === 0) {
    throw new InspectError(
      "Keine Metadata/plate_N.gcode im Archiv — das ist keine geslicte Bambu-Datei.",
    );
  }

  const sliceInfoRaw = entries["Metadata/slice_info.config"];
  const sliceInfo = sliceInfoRaw ? new TextDecoder().decode(sliceInfoRaw) : "";
  const printerModelId = sliceInfo.match(/key="printer_model_id"\s+value="([^"]*)"/)?.[1];

  const plateBlocks = sliceInfo.split(/<plate>/i).slice(1);

  const plates: Plate[] = gcodes.map((path) => {
    const idx = Number(path.match(/plate_(\d+)\.gcode/i)?.[1] ?? "0");
    const block = plateBlocks.find((b) => attr(b, "index") === String(idx)) ?? plateBlocks[idx - 1];
    const prediction = block ? attr(block, "prediction") : undefined;
    const filaments: Filament[] = [];
    if (block) {
      for (const fm of block.matchAll(/<filament\b([^/]*)\/>/gi)) {
        const f = fm[1] ?? "";
        const type = f.match(/type="([^"]*)"/)?.[1];
        const color = f.match(/color="([^"]*)"/)?.[1];
        const usedG = f.match(/used_g="([^"]*)"/)?.[1];
        filaments.push({ type, color, usedG: usedG ? Number(usedG) : undefined });
      }
    }
    return {
      index: idx,
      gcodePath: path,
      hasThumbnail: names.includes(`Metadata/plate_${idx}.png`),
      printSeconds: prediction ? Number(prediction) : undefined,
      filaments,
    };
  });

  return { file, printerModelId, plates, entryCount: names.length };
}

export async function cmdInspect(flags: InspectFlags): Promise<ExitCode> {
  if (!flags.input) throw new InspectError("Keine Datei. Nutzung: bambu inspect <datei.gcode.3mf>");
  const f = Bun.file(flags.input);
  if (!(await f.exists())) throw new InspectError(`Datei nicht gefunden: ${flags.input}`);
  const result = inspectArchive(flags.input, new Uint8Array(await f.arrayBuffer()));

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return Exit.ok;
  }

  console.log(`${result.file}`);
  console.log(`  Druckermodell: ${result.printerModelId ?? "unbekannt"}`);
  console.log(`  Platten: ${result.plates.length}`);
  for (const p of result.plates) {
    const time = p.printSeconds ? formatMinutes(Math.round(p.printSeconds / 60)) : "?";
    const fil = p.filaments.map((x) => x.type ?? "?").join(", ") || "–";
    const thumb = p.hasThumbnail ? "mit Vorschau" : "OHNE Vorschau";
    console.log(`    Platte ${p.index}: ${time} · Filament ${fil} · ${thumb}`);
  }
  return Exit.ok;
}
