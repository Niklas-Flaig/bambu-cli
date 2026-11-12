// Read-only commands that talk to the printer over local MQTT: status, watch,
// ams, info. All work in cloud mode with just the access code — no Developer
// Mode, no signing.

import { loadAccessCode, type BambuConfig } from "../config.ts";
import { Exit, type ExitCode } from "../exit.ts";
import { BambuClient, ConnectionError } from "../mqtt.ts";
import { renderAms, renderStatusBlock, renderStatusJson, renderStatusLine } from "../output.ts";
import type { GcodeState, PrinterStatus } from "../types.ts";

export interface MonitorFlags {
  json?: boolean;
  intervalSec?: number;
  timeoutMin?: number;
  until?: GcodeState;
}

async function withClient<T>(
  config: BambuConfig,
  fn: (client: BambuClient) => Promise<T>,
): Promise<T> {
  const accessCode = await loadAccessCode();
  const client = new BambuClient({
    host: config.host,
    serial: config.serial,
    accessCode,
    model: config.model,
    port: config.mqttPort,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

export async function cmdStatus(config: BambuConfig, flags: MonitorFlags): Promise<ExitCode> {
  const status = await withClient(config, (c) => c.waitForFirstReport());
  console.log(flags.json ? renderStatusJson(status) : renderStatusBlock(status));
  return Exit.ok;
}

export async function cmdAms(config: BambuConfig, flags: MonitorFlags): Promise<ExitCode> {
  const status = await withClient(config, (c) => c.waitForFirstReport());
  console.log(flags.json ? JSON.stringify(status.ams, null, 2) : renderAms(status));
  return Exit.ok;
}

export async function cmdInfo(config: BambuConfig, flags: MonitorFlags): Promise<ExitCode> {
  const result = await withClient(config, async (c) => {
    c.requestVersion();
    await c.waitForFirstReport().catch(() => undefined);
    // Give the version reply a brief moment to arrive.
    await new Promise((r) => setTimeout(r, 1500));
    return { status: c.status(), raw: c.raw() };
  });
  const modules = (result.raw.info?.module ?? []) as Array<Record<string, unknown>>;
  const firmware = pickFirmware(modules);
  if (flags.json) {
    console.log(JSON.stringify({ ...result.status, firmware, modules }, null, 2));
  } else {
    console.log(`Modell:      ${result.status.model}`);
    console.log(`Seriennr.:   ${result.status.serial}`);
    console.log(`Firmware:    ${firmware ?? "unbekannt"}`);
    console.log(`Zustand:     ${result.status.state}`);
  }
  return Exit.ok;
}

function pickFirmware(modules: Array<Record<string, unknown>>): string | undefined {
  const ota = modules.find((m) => m["name"] === "ota" || m["name"] === "esp32");
  const sw = ota?.["sw_ver"] ?? modules[0]?.["sw_ver"];
  return typeof sw === "string" ? sw : undefined;
}

const TERMINAL: GcodeState[] = ["FINISH", "FAILED"];

export async function cmdWatch(config: BambuConfig, flags: MonitorFlags): Promise<ExitCode> {
  const intervalMs = (flags.intervalSec ?? 5) * 1000;
  const timeoutMs = flags.timeoutMin ? flags.timeoutMin * 60_000 : undefined;
  const until = flags.until;

  return withClient(config, async (client) => {
    await client.waitForFirstReport().catch(() => undefined);

    return new Promise<ExitCode>((resolve) => {
      let lastLine = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      let overall: ReturnType<typeof setTimeout> | undefined;

      const finish = (code: ExitCode) => {
        if (timer) clearInterval(timer);
        if (overall) clearTimeout(overall);
        resolve(code);
      };

      const emit = (s: PrinterStatus, force = false) => {
        if (flags.json) {
          console.log(renderStatusJson(s));
          return;
        }
        const line = renderStatusLine(s);
        if (force || line !== lastLine) {
          lastLine = line;
          console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
        }
      };

      const check = (s: PrinterStatus) => {
        if (until && s.state === until) return finish(Exit.ok);
        if (!until && TERMINAL.includes(s.state)) {
          return finish(s.state === "FAILED" ? Exit.failed : Exit.ok);
        }
      };

      emit(client.status(), true);
      check(client.status());

      client.onUpdate((s) => {
        emit(s);
        check(s);
      });

      // Periodic re-emit so a long-running print still prints a heartbeat.
      timer = setInterval(() => emit(client.status(), false), intervalMs);

      if (timeoutMs) {
        overall = setTimeout(() => {
          if (!flags.json) console.error(`Zeitlimit (${flags.timeoutMin} min) erreicht.`);
          finish(Exit.timeout);
        }, timeoutMs);
      }
    });
  });
}

export { ConnectionError };
