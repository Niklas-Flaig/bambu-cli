// Local MQTT client for a Bambu Lab printer. Reading status works in cloud
// mode (no Developer Mode): status push is not gated by Authorization Control.
// Only the LAN access code is needed. Control commands (print start) are NOT
// implemented here — in cloud mode they require Bambu's signed authorization.
//
// TLS: the printer uses a cert from Bambu's own CA with CN = serial, so the
// hostname never matches the IP; we connect with rejectUnauthorized: false and
// cap at TLS 1.2 (older firmware never answers a TLS 1.3 ClientHello).

import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { mergeReports, normalizeReport } from "./report.ts";
import type { PrinterStatus, ReportMessage } from "./types.ts";

export interface ClientOptions {
  host: string;
  serial: string;
  accessCode: string;
  model: string;
  port?: number;
  /** Max time to wait for the first full report, ms. Default 10000. */
  connectTimeoutMs?: number;
}

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export class BambuClient {
  private readonly opts: Required<ClientOptions>;
  private client?: MqttClient;
  private accumulated: ReportMessage = {};
  private seq = 0;
  private readonly listeners = new Set<(status: PrinterStatus, raw: ReportMessage) => void>();

  constructor(opts: ClientOptions) {
    this.opts = {
      port: 8883,
      connectTimeoutMs: 10_000,
      ...opts,
    };
  }

  private get reportTopic(): string {
    return `device/${this.opts.serial}/report`;
  }

  private get requestTopic(): string {
    return `device/${this.opts.serial}/request`;
  }

  private nextSeq(): string {
    this.seq += 1;
    return String(this.seq);
  }

  /** Connect, subscribe to the report topic, and request a full push. */
  async connect(): Promise<void> {
    const url = `mqtts://${this.opts.host}:${this.opts.port}`;
    const client = mqtt.connect(url, {
      username: "bblp",
      password: this.opts.accessCode,
      protocolVersion: 4,
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: this.opts.connectTimeoutMs,
      rejectUnauthorized: false,
      // @ts-expect-error node tls option passed through by mqtt.js
      maxVersion: "TLSv1.2",
      minVersion: "TLSv1.2",
    });
    this.client = client;

    client.on("message", (_topic, payload) => this.onMessage(payload));

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        client.removeListener("connect", onConnect);
        reject(this.explain(err));
      };
      const onConnect = () => {
        client.removeListener("error", onError);
        client.subscribe(this.reportTopic, { qos: 0 }, (err) => {
          if (err) return reject(new ConnectionError(`subscribe fehlgeschlagen: ${err.message}`));
          resolve();
        });
      };
      client.once("connect", onConnect);
      client.once("error", onError);
    });

    this.requestPushAll();
  }

  private explain(err: Error): ConnectionError {
    const msg = err.message || String(err);
    if (/not authorized|bad user name or password|connack/i.test(msg)) {
      return new ConnectionError(
        `Verbindung abgelehnt — falscher Zugangscode? (${msg}). ` +
          `Den Code zeigt der Drucker unter Einstellungen → LAN.`,
      );
    }
    if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND/i.test(msg)) {
      return new ConnectionError(
        `Drucker nicht erreichbar unter ${this.opts.host}:${this.opts.port} (${msg}).`,
      );
    }
    return new ConnectionError(msg);
  }

  /** Ask the printer to push its full state (needed for P1/A1; harmless on X1). */
  requestPushAll(): void {
    this.publish({
      pushing: { sequence_id: this.nextSeq(), command: "pushall", version: 1, push_target: 1 },
    });
  }

  /** Ask for firmware/module versions; the reply arrives as an `info` report. */
  requestVersion(): void {
    this.publish({ info: { sequence_id: this.nextSeq(), command: "get_version" } });
  }

  private publish(payload: Record<string, unknown>): void {
    this.client?.publish(this.requestTopic, JSON.stringify(payload), { qos: 0 });
  }

  private onMessage(payload: Uint8Array): void {
    let msg: ReportMessage;
    try {
      msg = JSON.parse(new TextDecoder().decode(payload)) as ReportMessage;
    } catch {
      return; // ignore non-JSON frames
    }
    this.accumulated = mergeReports(this.accumulated, msg);
    const status = this.status();
    for (const listener of this.listeners) listener(status, this.accumulated);
  }

  /** The current normalized status from everything received so far. */
  status(): PrinterStatus {
    return normalizeReport(this.accumulated.print, {
      serial: this.opts.serial,
      model: this.opts.model,
    });
  }

  /** The last raw report message, for `info` and debugging. */
  raw(): ReportMessage {
    return this.accumulated;
  }

  onUpdate(listener: (status: PrinterStatus, raw: ReportMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Wait until a report with a gcode_state has arrived, or time out. */
  async waitForFirstReport(timeoutMs = this.opts.connectTimeoutMs): Promise<PrinterStatus> {
    if (this.accumulated.print?.gcode_state) return this.status();
    return new Promise<PrinterStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new ConnectionError(`Keine Antwort vom Drucker innerhalb ${timeoutMs} ms.`));
      }, timeoutMs);
      const off = this.onUpdate((status, raw) => {
        if (raw.print?.gcode_state) {
          clearTimeout(timer);
          off();
          resolve(status);
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    if (!client) return;
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
    this.client = undefined;
  }
}
