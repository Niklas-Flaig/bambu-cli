// `bambu snapshot` — grab one still frame from the printer's chamber camera.
// On the X1 the camera is an RTSPS stream on port 322 and only answers when
// "LAN Mode Liveview" is enabled on the printer (it was off on the last scan).
// Optional feature: needs ffmpeg on PATH or at ~/.local/bin/ffmpeg.

import { join } from "node:path";
import { homedir } from "node:os";
import { loadAccessCode, type BambuConfig } from "../config.ts";
import { Exit, type ExitCode } from "../exit.ts";
import { BambuClient } from "../mqtt.ts";

export interface SnapshotFlags {
  output?: string;
  json?: boolean;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

async function findFfmpeg(): Promise<string | undefined> {
  const local = join(homedir(), ".local", "bin", "ffmpeg");
  if (await Bun.file(local).exists()) return local;
  const which = Bun.spawnSync(["sh", "-c", "command -v ffmpeg"]);
  const path = which.stdout.toString().trim();
  return path || undefined;
}

export async function cmdSnapshot(config: BambuConfig, flags: SnapshotFlags): Promise<ExitCode> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) {
    throw new SnapshotError(
      "ffmpeg fehlt. Statisches Binary nach ~/.local/bin holen (siehe docs/bambu-setup.md), " +
        "dann erneut versuchen.",
    );
  }

  const accessCode = await loadAccessCode();
  const client = new BambuClient({
    host: config.host,
    serial: config.serial,
    accessCode,
    model: config.model,
    port: config.mqttPort,
  });
  await client.connect();
  let cameraEnabled = false;
  try {
    const status = await client.waitForFirstReport().catch(() => client.status());
    cameraEnabled = Boolean(status.cameraUrl);
  } finally {
    await client.disconnect();
  }

  if (!cameraEnabled) {
    throw new SnapshotError(
      "Der Drucker meldet keinen Kamera-Stream (LAN Mode Liveview aus?). " +
        "Am Drucker: Einstellungen → LAN Mode Liveview einschalten.",
    );
  }

  const output = flags.output ?? "snapshot.jpg";
  const url = `rtsps://bblp:${accessCode}@${config.host}:322/streaming/live/1`;
  const args = [
    "-y",
    "-rtsp_transport",
    "tcp",
    "-tls_verify",
    "0",
    "-i",
    url,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    output,
  ];
  const proc = Bun.spawnSync([ffmpeg, ...args], { stderr: "pipe", stdout: "pipe" });
  if (proc.exitCode !== 0) {
    const tail = proc.stderr.toString().split("\n").slice(-4).join(" ").slice(0, 300);
    throw new SnapshotError(`ffmpeg schlug fehl: ${tail}`);
  }

  if (flags.json) {
    console.log(JSON.stringify({ output }, null, 2));
  } else {
    console.log(`Kamerabild → ${output}`);
  }
  return Exit.ok;
}
