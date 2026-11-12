// `bambu cloud-login` and `bambu stage` — the Bambu cloud path, so that a
// sliced file lands in Niklas' account and can be started with one tap in
// Bambu Handy (requested at the plan gate).
//
// Login is the documented endpoint; the file-upload/“print task” endpoints are
// reverse-engineered and UNVERIFIED (OpenBambuAPI cloud-http.md). `stage`
// therefore attempts the upload but always offers the reliable fallback
// `--to-board`: validate the file and hand it over on the board instead.

import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { BambuConfig, CloudCredentials } from "../config.ts";
import { cloudDir, loadCloudCredentials } from "../config.ts";
import { Exit, type ExitCode } from "../exit.ts";
import { inspectArchive, InspectError } from "./inspect.ts";

const API = "https://api.bambulab.com";

export class CloudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudError";
  }
}

export interface LoginFlags {
  account?: string;
  region?: string;
}

interface LoginResponse {
  accessToken?: string;
  loginType?: string; // "verifyCode" => a 2FA code is required
  tfaKey?: string;
}

async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  for await (const line of console) return line.trim();
  return "";
}

export async function cmdCloudLogin(flags: LoginFlags): Promise<ExitCode> {
  const account =
    flags.account ?? process.env.BAMBU_ACCOUNT ?? (await ask("Bambu-Account (E-Mail): "));
  const password = process.env.BAMBU_PASSWORD ?? (await ask("Passwort: "));
  if (!account || !password) throw new CloudError("Account und Passwort sind nötig.");

  const first = await login({ account, password });
  let token = first.accessToken;

  if (!token && first.loginType === "verifyCode") {
    console.error("Bambu hat einen Bestätigungscode per E-Mail geschickt.");
    const code = process.env.BAMBU_CODE ?? (await ask("Code: "));
    const second = await login({ account, code });
    token = second.accessToken;
  }

  if (!token) {
    throw new CloudError(
      "Login ohne Token — eventuell Zwei-Faktor aktiv. Setze BAMBU_CODE und wiederhole, " +
        "oder hinterlege den Token von Hand in cloud.json.",
    );
  }

  const uid = await fetchUid(token).catch(() => undefined);
  const creds: CloudCredentials = { token, uid, region: flags.region ?? "us" };
  const dir = cloudDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, "cloud.json");
  await writeFile(path, JSON.stringify(creds, null, 2));
  await chmod(path, 0o600);
  console.log(`Angemeldet. Token in ${path} (gültig ~3 Monate).`);
  return Exit.ok;
}

async function login(body: Record<string, string>): Promise<LoginResponse> {
  const res = await fetch(`${API}/v1/user-service/user/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 200) {
    throw new CloudError(`Login fehlgeschlagen (HTTP ${res.status}).`);
  }
  return (await res.json()) as LoginResponse;
}

async function fetchUid(token: string): Promise<string | undefined> {
  const res = await fetch(`${API}/v1/design-user-service/my/preference`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { uid?: number | string };
  return data.uid !== undefined ? String(data.uid) : undefined;
}

export interface StageFlags {
  input?: string;
  toBoard?: boolean;
  json?: boolean;
}

export async function cmdStage(config: BambuConfig, flags: StageFlags): Promise<ExitCode> {
  if (!flags.input) throw new CloudError("Keine Datei. Nutzung: bambu stage <datei.gcode.3mf>");
  const file = Bun.file(flags.input);
  if (!(await file.exists())) throw new CloudError(`Datei nicht gefunden: ${flags.input}`);

  // Validate before doing anything with it.
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const inspection = inspectArchive(flags.input, bytes);
    if (!flags.json) {
      console.error(
        `Geprüft: ${inspection.plates.length} Platte(n), Modell ${inspection.printerModelId ?? "?"}.`,
      );
    }
  } catch (err) {
    if (err instanceof InspectError) throw new CloudError(`Ungültige Druckdatei: ${err.message}`);
    throw err;
  }

  if (flags.toBoard) {
    return handoffToBoard(flags.input, flags.json ?? false);
  }

  let creds: CloudCredentials;
  try {
    creds = await loadCloudCredentials();
  } catch {
    console.error("Keine Cloud-Zugangsdaten — nutze stattdessen die Board-Übergabe.");
    return handoffToBoard(flags.input, flags.json ?? false);
  }

  try {
    const result = await cloudUpload(creds, flags.input, bytes);
    if (flags.json) {
      console.log(JSON.stringify({ staged: "cloud", ...result }, null, 2));
    } else {
      console.log(`In die Bambu-Cloud geladen — in Handy druckbereit (${result.name}).`);
    }
    return Exit.ok;
  } catch (err) {
    // The cloud upload path is unverified; never fail hard — fall back cleanly.
    console.error(
      `Cloud-Upload nicht möglich (${(err as Error).message}). Board-Übergabe stattdessen.`,
    );
    return handoffToBoard(flags.input, flags.json ?? false);
  }
}

function handoffToBoard(path: string, json: boolean): ExitCode {
  if (json) {
    console.log(JSON.stringify({ staged: "board", path }, null, 2));
  } else {
    console.log(`Bereit für die Board-Übergabe: ${path}`);
    console.log("Der Agent legt die Datei auf das Board; du druckst sie in Handy.");
  }
  return Exit.ok;
}

interface UploadResult {
  name: string;
  id?: string;
}

/**
 * Attempt to upload a 3mf to the Bambu cloud. The exact endpoint is
 * reverse-engineered and unverified, so this throws on any non-success and the
 * caller falls back to board handoff. To be confirmed live at the walkthrough.
 */
async function cloudUpload(
  creds: CloudCredentials,
  path: string,
  bytes: Uint8Array,
): Promise<UploadResult> {
  const name = path.split("/").pop() ?? "model.gcode.3mf";
  const res = await fetch(`${API}/v1/iot-service/api/user/print/profile`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${creds.token}`,
      "content-type": "application/octet-stream",
      "x-file-name": name,
    },
    body: new Blob([bytes]),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new CloudError(`HTTP ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { name, id: data.id };
}
