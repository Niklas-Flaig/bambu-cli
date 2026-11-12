// Typed model of the Bambu Lab printer report (the `print` object pushed over
// MQTT) and the normalized status the CLI exposes. Only the fields that matter
// for monitoring are modeled; the raw report carries far more.
//
// Protocol references (verified 2026-11-11):
// - https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md
// - https://github.com/greghesp/ha-bambulab (pybambu const.py / models.py)

/** Lifecycle of a print job, as reported in `print.gcode_state`. */
export type GcodeState =
  | "IDLE"
  | "PREPARE"
  | "RUNNING"
  | "PAUSE"
  | "FINISH"
  | "FAILED"
  | "SLICING"
  | "INIT"
  | "OFFLINE"
  | "UNKNOWN";

/** One Health Management System entry as reported in `print.hms[]`. */
export interface HmsEntryRaw {
  attr: number;
  code: number;
}

/** A decoded HMS entry with its severity and a stable hex code for lookup. */
export interface HmsEntry {
  /** e.g. "0300_0100_0002_0001" — the key used on the Bambu HMS wiki. */
  code: string;
  severity: "fatal" | "serious" | "common" | "info" | "unknown";
  /** Raw numbers, kept for debugging. */
  attr: number;
  rawCode: number;
}

/** One AMS tray (filament slot). */
export interface AmsTray {
  id: number;
  /** Global tray id used in `ams_mapping`: ams_id*4 + slot. */
  globalId: number;
  empty: boolean;
  type?: string;
  color?: string;
  name?: string;
  remainPercent?: number;
}

/** One AMS unit. */
export interface AmsUnit {
  id: number;
  humidity?: string;
  temp?: string;
  trays: AmsTray[];
}

/** The subset of the raw `print` object we read. Index signature keeps it open. */
export interface PrintReport {
  gcode_state?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  layer_num?: number;
  total_layer_num?: number;
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number;
  wifi_signal?: string;
  print_type?: string;
  print_error?: number;
  subtask_name?: string;
  gcode_file?: string;
  stg_cur?: number;
  hms?: HmsEntryRaw[];
  ams?: {
    ams?: Array<{
      id?: string | number;
      humidity?: string;
      temp?: string;
      tray?: Array<Record<string, unknown>>;
    }>;
    tray_now?: string;
  };
  ipcam?: { rtsp_url?: string; mode_bits?: number };
  [key: string]: unknown;
}

/** A full message on `device/<serial>/report`. */
export interface ReportMessage {
  print?: PrintReport;
  info?: { command?: string; module?: Array<Record<string, unknown>> };
  [key: string]: unknown;
}

/** The normalized, stable status the CLI prints and returns as JSON. */
export interface PrinterStatus {
  serial: string;
  model: string;
  /** Normalized lifecycle; UNKNOWN until the first report arrives. */
  state: GcodeState;
  /** Current stage text (e.g. "auto_bed_leveling"), when printing. */
  stage?: string;
  job?: string;
  percent?: number;
  remainingMinutes?: number;
  layer?: number;
  totalLayers?: number;
  nozzle?: { current?: number; target?: number };
  bed?: { current?: number; target?: number };
  chamber?: number;
  wifi?: string;
  /** 0 = no error. */
  printError?: number;
  errors: HmsEntry[];
  ams: AmsUnit[];
  /** Whether the printer is pushing the RTSP camera stream (X1/P2S/H2). */
  cameraUrl?: string;
  /** When this snapshot was assembled. */
  at: string;
}
