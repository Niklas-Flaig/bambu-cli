// Decoding of HMS (Health Management System) entries. The printer reports
// errors as { attr, code } integer pairs; the severity lives in the high bits
// of `code`, and the printable hex key is assembled from both.
//
// Reference: pybambu utils.py (get_hms_severity / hms code formatting) in
// https://github.com/greghesp/ha-bambulab and
// https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md

import type { HmsEntry, HmsEntryRaw } from "./types.ts";

const SEVERITY: Record<number, HmsEntry["severity"]> = {
  1: "fatal",
  2: "serious",
  3: "common",
  4: "info",
};

/** Severity is the top 16 bits of `code` (after masking to a nibble). */
function severityOf(code: number): HmsEntry["severity"] {
  const bits = (code >> 16) & 0xffff;
  return SEVERITY[bits] ?? "unknown";
}

/** Assemble the `AAAA_BBBB_CCCC_DDDD` key used on the Bambu HMS wiki. */
function hmsKey(attr: number, code: number): string {
  const a = (attr >>> 16) & 0xffff;
  const b = attr & 0xffff;
  const c = (code >>> 16) & 0xffff;
  const d = code & 0xffff;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
  return `${hex(a)}_${hex(b)}_${hex(c)}_${hex(d)}`;
}

/** The wiki page where a user can look up the full text of a code. */
export function hmsWikiUrl(entry: HmsEntry): string {
  return `https://wiki.bambulab.com/en/x1/troubleshooting/how-to-get-error-code`;
}

export function decodeHms(raw: HmsEntryRaw[] | undefined): HmsEntry[] {
  if (!raw || raw.length === 0) return [];
  return raw
    .filter((e) => e && typeof e.attr === "number" && typeof e.code === "number")
    .map((e) => ({
      code: hmsKey(e.attr, e.code),
      severity: severityOf(e.code),
      attr: e.attr,
      rawCode: e.code,
    }));
}
