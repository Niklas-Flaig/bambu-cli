// Normalize a raw printer report into the stable PrinterStatus the CLI exposes.
// The printer (X1) pushes the full `print` object on each report; P1/A1 push
// deltas, so callers merge reports before normalizing (see mqtt.ts).

import { decodeHms } from "./hms.ts";
import type { AmsUnit, GcodeState, PrinterStatus, PrintReport, ReportMessage } from "./types.ts";

const KNOWN_STATES: GcodeState[] = [
  "IDLE",
  "PREPARE",
  "RUNNING",
  "PAUSE",
  "FINISH",
  "FAILED",
  "SLICING",
  "INIT",
  "OFFLINE",
];

// print.stg_cur → human stage text (pybambu const.py CURRENT_STAGE_IDS, trimmed).
const STAGE: Record<number, string> = {
  0: "printing",
  1: "auto_bed_leveling",
  2: "heatbed_preheating",
  3: "sweeping_xy_mech_mode",
  4: "changing_filament",
  5: "m400_pause",
  6: "paused_filament_runout",
  7: "heating_hotend",
  8: "calibrating_extrusion",
  9: "scanning_bed_surface",
  10: "inspecting_first_layer",
  11: "identifying_build_plate_type",
  12: "calibrating_micro_lidar",
  13: "homing_toolhead",
  14: "cleaning_nozzle_tip",
  15: "checking_extruder_temperature",
  16: "paused_user",
  17: "paused_front_cover_falling",
  18: "calibrating_lidar",
  19: "calibrating_extrusion_flow",
  20: "paused_nozzle_temperature_malfunction",
  21: "paused_heat_bed_temperature_malfunction",
};

function normalizeState(raw: string | undefined): GcodeState {
  if (!raw) return "UNKNOWN";
  const upper = raw.toUpperCase();
  return (KNOWN_STATES as string[]).includes(upper) ? (upper as GcodeState) : "UNKNOWN";
}

function round1(n: number | undefined): number | undefined {
  return typeof n === "number" ? Math.round(n * 10) / 10 : undefined;
}

function normalizeAms(ams: PrintReport["ams"]): AmsUnit[] {
  const units = ams?.ams;
  if (!Array.isArray(units)) return [];
  return units.map((u) => {
    const amsId = Number(u.id ?? 0);
    const trays = Array.isArray(u.tray) ? u.tray : [];
    return {
      id: amsId,
      humidity: u.humidity,
      temp: u.temp,
      trays: trays.map((t, slot) => {
        const type = (t["tray_type"] as string) || undefined;
        const remain = t["remain"];
        return {
          id: slot,
          globalId: amsId * 4 + slot,
          empty: !type,
          type,
          color: (t["tray_color"] as string) || undefined,
          name: (t["tray_id_name"] as string) || (t["tray_sub_brands"] as string) || undefined,
          remainPercent: typeof remain === "number" && remain >= 0 ? remain : undefined,
        };
      }),
    };
  });
}

export function normalizeReport(
  report: PrintReport | undefined,
  meta: { serial: string; model: string },
): PrinterStatus {
  const p = report ?? {};
  const stage = typeof p.stg_cur === "number" ? STAGE[p.stg_cur] : undefined;
  const cameraUrl =
    p.ipcam?.rtsp_url && p.ipcam.rtsp_url !== "disable" ? p.ipcam.rtsp_url : undefined;
  return {
    serial: meta.serial,
    model: meta.model,
    state: normalizeState(p.gcode_state),
    stage,
    job: p.subtask_name || p.gcode_file || undefined,
    percent: typeof p.mc_percent === "number" ? p.mc_percent : undefined,
    remainingMinutes: typeof p.mc_remaining_time === "number" ? p.mc_remaining_time : undefined,
    layer: p.layer_num,
    totalLayers: p.total_layer_num,
    nozzle: { current: round1(p.nozzle_temper), target: round1(p.nozzle_target_temper) },
    bed: { current: round1(p.bed_temper), target: round1(p.bed_target_temper) },
    chamber: round1(p.chamber_temper),
    wifi: p.wifi_signal,
    printError: typeof p.print_error === "number" ? p.print_error : undefined,
    errors: decodeHms(p.hms),
    ams: normalizeAms(p.ams),
    cameraUrl,
    at: new Date().toISOString(),
  };
}

/**
 * Merge a newer report onto an accumulated one. X1 sends full frames, but P1/A1
 * send deltas, so we deep-merge the `print` object to keep a complete picture.
 */
export function mergeReports(base: ReportMessage, next: ReportMessage): ReportMessage {
  const merged: ReportMessage = { ...base, ...next };
  if (base.print || next.print) {
    merged.print = deepMerge(base.print ?? {}, next.print ?? {}) as PrintReport;
  }
  return merged;
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const prev = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev)
    ) {
      out[key] = deepMerge(prev as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
