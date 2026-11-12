#!/usr/bin/env bun
// bambu — a CLI for agents to slice, stage, print and monitor a Bambu Lab X1C.
//
// In this setup the printer stays in CLOUD mode (Bambu Handy keeps working), so
// agents MONITOR and PREPARE but do not start prints over LAN. Flow:
//   bambu slice part.stl -o part.gcode.3mf   # via the slicer sidecar
//   bambu stage part.gcode.3mf               # upload to the Bambu cloud (→ Handy)
//   # you tap Start in Handy
//   bambu watch                              # follow the print to the end

import { loadConfig, ConfigError } from "./config.ts";
import { Exit, type ExitCode } from "./exit.ts";
import { cmdAms, cmdInfo, cmdStatus, cmdWatch, ConnectionError } from "./commands/monitor.ts";
import type { GcodeState } from "./types.ts";

// A dependency reaches for the deprecated url.parse(); its warning would clutter
// agent output. Replace the default warning handler to drop deprecation
// warnings only (keep everything else).
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "DeprecationWarning") console.error(w.stack ?? w.message);
});

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
      } else {
        const next = rest[i + 1];
        if (next && !next.startsWith("-")) {
          flags.set(body, next);
          i++;
        } else {
          flags.set(body, true);
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const next = rest[i + 1];
      if (next && !next.startsWith("-")) {
        flags.set(arg.slice(1), next);
        i++;
      } else {
        flags.set(arg.slice(1), true);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

function flagNum(flags: Map<string, string | boolean>, key: string): number | undefined {
  const v = flags.get(key);
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const HELP = `bambu — Bambu Lab Drucker für Agenten (Cloud-Modus: überwachen & vorbereiten)

Überwachen (nur Zugangscode nötig):
  bambu status [--json]              Zustand, Fortschritt, Temperaturen
  bambu watch  [--json] [--interval=5] [--timeout=<min>] [--until=FINISH]
                                     folgt dem Druck bis FINISH/FAILED
  bambu ams    [--json]              AMS-Fächer
  bambu info   [--json]              Modell, Firmware, Seriennummer

Vorbereiten:
  bambu slice <datei.stl> [-o out.gcode.3mf] [--process=…] [--filament=…] [--nozzle=0.4]
  bambu inspect <datei.gcode.3mf> [--json]    liest Platten, Filamente, Druckzeit
  bambu stage <datei.gcode.3mf> [--to-board]  lädt in deine Bambu-Cloud (→ Handy)
  bambu cloud-login                  meldet dich einmalig bei der Bambu-Cloud an
  bambu snapshot [out.jpg]           Kamerabild (nur mit LAN-Liveview)

Exit-Codes: 0 ok · 2 FAILED · 3 Timeout · 4 Config · 5 Verbindung

Konfiguration: bambu.config.json (Host, Seriennummer, Modell).
Geheimnisse: ~/.config/bambu/access-code und ~/.config/bambu/cloud.json.`;

async function run(): Promise<ExitCode> {
  const { command, positionals, flags } = parseArgs(Bun.argv.slice(2));

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return Exit.ok;
  }

  const json = flags.get("json") === true || flags.get("json") === "true";

  // Monitoring commands share the config + MQTT setup.
  if (command === "status" || command === "watch" || command === "ams" || command === "info") {
    const config = await loadConfig();
    const monitorFlags = {
      json,
      intervalSec: flagNum(flags, "interval"),
      timeoutMin: flagNum(flags, "timeout"),
      until: (flags.get("until") as GcodeState) || undefined,
    };
    switch (command) {
      case "status":
        return cmdStatus(config, monitorFlags);
      case "ams":
        return cmdAms(config, monitorFlags);
      case "info":
        return cmdInfo(config, monitorFlags);
      case "watch":
        return cmdWatch(config, monitorFlags);
    }
  }

  if (command === "slice") {
    const { cmdSlice } = await import("./commands/slice.ts");
    return cmdSlice(await loadConfig(), {
      input: positionals[0],
      output: (flags.get("o") as string) || (flags.get("output") as string) || undefined,
      process: (flags.get("process") as string) || undefined,
      filament: (flags.get("filament") as string) || undefined,
      nozzle: (flags.get("nozzle") as string) || undefined,
      json,
    });
  }

  if (command === "inspect") {
    const { cmdInspect } = await import("./commands/inspect.ts");
    return cmdInspect({ input: positionals[0], json });
  }

  if (command === "stage") {
    const { cmdStage } = await import("./commands/cloud.ts");
    return cmdStage(await loadConfig(), {
      input: positionals[0],
      toBoard: flags.get("to-board") === true,
      json,
    });
  }

  if (command === "cloud-login") {
    const { cmdCloudLogin } = await import("./commands/cloud.ts");
    return cmdCloudLogin({
      account: (flags.get("account") as string) || undefined,
      region: (flags.get("region") as string) || undefined,
    });
  }

  if (command === "snapshot") {
    const { cmdSnapshot } = await import("./commands/snapshot.ts");
    return cmdSnapshot(await loadConfig(), { output: positionals[0], json });
  }

  console.error(`Unbekanntes Kommando: ${command}\n`);
  console.error(HELP);
  return Exit.usage;
}

try {
  const code = await run();
  process.exit(code);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Konfiguration: ${err.message}`);
    process.exit(Exit.config);
  }
  if (err instanceof ConnectionError) {
    console.error(`Verbindung: ${err.message}`);
    process.exit(Exit.connection);
  }
  console.error(`Fehler: ${(err as Error).message ?? err}`);
  process.exit(Exit.error);
}
