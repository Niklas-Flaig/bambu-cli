// Configuration loading. The CLI ships as a standalone binary, so it keeps no
// files in a repo. Non-secret settings come from built-in defaults, overlaid by
// ~/.config/bambu/config.json and then by BAMBU_* env vars. The LAN access code
// and the Bambu cloud token are secrets and live only outside any repo:
//   - BAMBU_ACCESS_CODE  env, or ~/.config/bambu/access-code  (chmod 600)
//   - BAMBU_CLOUD_TOKEN  env, or ~/.config/bambu/cloud.json
//
// On the agent box these are provided by agentic-setup (env/bambu.env).

import { homedir } from "node:os";
import { join } from "node:path";
import { modelFromSerial } from "./model.ts";

export interface SlicerConfig {
  url: string;
}

export interface BambuDefaults {
  nozzle: string;
  /** Machine profile name the slicer sidecar resolves, e.g. "Bambu Lab X1 Carbon 0.4 nozzle". */
  printer: string;
  /** Process/quality profile name ("preset" in the sidecar's settings). */
  process: string;
  filament: string;
  bedType: string;
}

export interface BambuConfig {
  host: string;
  serial: string;
  model: string;
  mqttPort: number;
  region: string;
  defaults: BambuDefaults;
  slicer: SlicerConfig;
}

/** Built-in defaults. Printer identity (host/serial) is intentionally empty —
 *  it must come from config or env, so the binary carries no device details. */
const BUILTIN: BambuConfig = {
  host: "",
  serial: "",
  model: "unknown",
  mqttPort: 8883,
  region: "us",
  defaults: {
    nozzle: "0.4",
    printer: "Bambu Lab X1 Carbon 0.4 nozzle",
    process: "0.20mm Standard @BBL X1C",
    filament: "Bambu PLA Basic @BBL X1C",
    bedType: "textured_plate",
  },
  slicer: { url: "http://bambu-studio-api:3000" },
};

const CONFIG_DIR = join(homedir(), ".config", "bambu");

function configFile(): string {
  return process.env.BAMBU_CONFIG ?? join(CONFIG_DIR, "config.json");
}

type PartialConfig = Partial<Omit<BambuConfig, "defaults" | "slicer">> & {
  defaults?: Partial<BambuDefaults>;
  slicer?: Partial<SlicerConfig>;
};

/** Load the non-secret config: built-in defaults < config file < env vars. */
export async function loadConfig(): Promise<BambuConfig> {
  let fromFile: PartialConfig = {};
  const path = configFile();
  const file = Bun.file(path);
  if (await file.exists()) {
    try {
      fromFile = (await file.json()) as PartialConfig;
    } catch (err) {
      throw new ConfigError(`Config ${path} ist kein gültiges JSON: ${(err as Error).message}`);
    }
  }

  const host = process.env.BAMBU_HOST ?? fromFile.host ?? BUILTIN.host;
  const serial = process.env.BAMBU_SERIAL ?? fromFile.serial ?? BUILTIN.serial;
  if (!host) {
    throw new ConfigError(
      `Kein Drucker konfiguriert. Setze BAMBU_HOST und BAMBU_SERIAL (oder lege ${path} an). ` +
        `Beispiel liegt in bambu.config.example.json.`,
    );
  }
  if (!serial)
    throw new ConfigError("Keine Seriennummer. Setze BAMBU_SERIAL oder serial in der Config.");

  return {
    host,
    serial,
    model: process.env.BAMBU_MODEL ?? fromFile.model ?? modelFromSerial(serial) ?? BUILTIN.model,
    mqttPort: fromFile.mqttPort ?? BUILTIN.mqttPort,
    region: process.env.BAMBU_REGION ?? fromFile.region ?? BUILTIN.region,
    defaults: {
      nozzle: fromFile.defaults?.nozzle ?? BUILTIN.defaults.nozzle,
      printer: fromFile.defaults?.printer ?? BUILTIN.defaults.printer,
      process: fromFile.defaults?.process ?? BUILTIN.defaults.process,
      filament: fromFile.defaults?.filament ?? BUILTIN.defaults.filament,
      bedType: fromFile.defaults?.bedType ?? BUILTIN.defaults.bedType,
    },
    slicer: {
      url: process.env.BAMBU_SLICER_URL ?? fromFile.slicer?.url ?? BUILTIN.slicer.url,
    },
  };
}

/** Read the LAN access code (env wins, then ~/.config/bambu/access-code). */
export async function loadAccessCode(): Promise<string> {
  const fromEnv = process.env.BAMBU_ACCESS_CODE?.trim();
  if (fromEnv) return fromEnv;
  const path = join(CONFIG_DIR, "access-code");
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(
      `Kein Zugangscode. Setze BAMBU_ACCESS_CODE oder lege ihn in ${path} ab (chmod 600). ` +
        `Den 8-stelligen Code zeigt der Drucker unter Einstellungen → LAN.`,
    );
  }
  const code = (await file.text()).trim();
  if (!code) throw new ConfigError(`${path} ist leer.`);
  return code;
}

export interface CloudCredentials {
  token: string;
  /** Numeric user id, used as the cloud MQTT username (u_<uid>). */
  uid?: string;
  region?: string;
}

/** Read the Bambu cloud token (env wins, then ~/.config/bambu/cloud.json). */
export async function loadCloudCredentials(): Promise<CloudCredentials> {
  const fromEnv = process.env.BAMBU_CLOUD_TOKEN?.trim();
  if (fromEnv) {
    return { token: fromEnv, uid: process.env.BAMBU_CLOUD_UID?.trim() };
  }
  const path = join(CONFIG_DIR, "cloud.json");
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(
      `Keine Cloud-Zugangsdaten. Melde dich mit \`bambu cloud-login\` an ` +
        `oder setze BAMBU_CLOUD_TOKEN.`,
    );
  }
  try {
    const data = (await file.json()) as CloudCredentials;
    if (!data.token) throw new Error("kein token");
    return data;
  } catch (err) {
    throw new ConfigError(`${path} ist ungültig: ${(err as Error).message}`);
  }
}

export function cloudDir(): string {
  return CONFIG_DIR;
}

/** A user-facing configuration problem (missing code, broken file). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
