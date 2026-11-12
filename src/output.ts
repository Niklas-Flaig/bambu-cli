// Rendering helpers: a compact human-readable status line/block, and JSON.

import type { PrinterStatus } from "./types.ts";

export function renderStatusJson(status: PrinterStatus): string {
  return JSON.stringify(status, null, 2);
}

function temp(t?: { current?: number; target?: number }): string {
  if (!t || t.current === undefined) return "–";
  const target = t.target && t.target > 0 ? `/${t.target}` : "";
  return `${t.current}${target}°C`;
}

/** A one-line summary, e.g. for `watch` tick output. */
export function renderStatusLine(s: PrinterStatus): string {
  const parts: string[] = [s.state];
  if (s.stage && s.state === "RUNNING" && s.stage !== "printing") parts.push(s.stage);
  if (s.percent !== undefined && (s.state === "RUNNING" || s.state === "PAUSE")) {
    parts.push(`${s.percent}%`);
  }
  if (s.layer !== undefined && s.totalLayers) parts.push(`L${s.layer}/${s.totalLayers}`);
  if (s.remainingMinutes !== undefined && s.remainingMinutes > 0) {
    parts.push(`noch ${formatMinutes(s.remainingMinutes)}`);
  }
  parts.push(`Düse ${temp(s.nozzle)}`, `Bett ${temp(s.bed)}`);
  if (s.errors.length > 0) parts.push(`⚠ ${s.errors.length} HMS`);
  return parts.join(" · ");
}

/** A multi-line block for `status`. */
export function renderStatusBlock(s: PrinterStatus): string {
  const lines: string[] = [];
  lines.push(`${s.model} (${s.serial})`);
  lines.push(`Zustand:   ${s.state}${s.stage && s.stage !== "printing" ? ` · ${s.stage}` : ""}`);
  if (s.job) lines.push(`Auftrag:   ${s.job}`);
  if (s.percent !== undefined && (s.state === "RUNNING" || s.state === "PAUSE")) {
    const eta = s.remainingMinutes ? ` · noch ${formatMinutes(s.remainingMinutes)}` : "";
    const layer =
      s.layer !== undefined && s.totalLayers ? ` · Schicht ${s.layer}/${s.totalLayers}` : "";
    lines.push(`Fortschritt: ${s.percent}%${layer}${eta}`);
  }
  lines.push(`Düse:      ${temp(s.nozzle)}`);
  lines.push(`Bett:      ${temp(s.bed)}`);
  if (s.chamber !== undefined) lines.push(`Kammer:    ${s.chamber}°C`);
  if (s.wifi) lines.push(`WLAN:      ${s.wifi}`);
  if (s.printError && s.printError !== 0) lines.push(`print_error: ${s.printError}`);
  if (s.errors.length > 0) {
    lines.push(`Fehler (HMS):`);
    for (const e of s.errors) lines.push(`  - ${e.code} (${e.severity})`);
  }
  return lines.join("\n");
}

export function renderAms(s: PrinterStatus): string {
  if (s.ams.length === 0) return "Kein AMS gemeldet.";
  const lines: string[] = [];
  for (const unit of s.ams) {
    const meta = [
      unit.humidity ? `Feuchte ${unit.humidity}` : "",
      unit.temp ? `${unit.temp}°C` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`AMS ${unit.id}${meta ? ` (${meta})` : ""}`);
    for (const t of unit.trays) {
      if (t.empty) {
        lines.push(`  [${t.globalId}] leer`);
      } else {
        const remain = t.remainPercent !== undefined ? ` · ${t.remainPercent}%` : "";
        const name = t.name ? ` ${t.name}` : "";
        lines.push(`  [${t.globalId}] ${t.type ?? "?"}${name}${remain}`);
      }
    }
  }
  return lines.join("\n");
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
