import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { normalizeReport, mergeReports } from "../src/report.ts";
import type { ReportMessage } from "../src/types.ts";

const FIX = join(import.meta.dir, "fixtures");
const meta = { serial: "00M09D4A2100751", model: "X1C" };

async function load(name: string): Promise<ReportMessage> {
  return (await Bun.file(join(FIX, name)).json()) as ReportMessage;
}

describe("normalizeReport", () => {
  test("reads a running print", async () => {
    const msg = await load("report-running.json");
    const s = normalizeReport(msg.print, meta);
    expect(s.state).toBe("RUNNING");
    expect(s.percent).toBe(42);
    expect(s.remainingMinutes).toBe(73);
    expect(s.layer).toBe(58);
    expect(s.totalLayers).toBe(140);
    expect(s.nozzle?.current).toBe(219.8);
    expect(s.bed?.target).toBe(60);
    expect(s.job).toBe("benchy");
    expect(s.cameraUrl).toContain("rtsps://");
  });

  test("maps AMS trays to global ids and marks empties", async () => {
    const msg = await load("report-running.json");
    const s = normalizeReport(msg.print, meta);
    expect(s.ams).toHaveLength(1);
    const trays = s.ams[0]!.trays;
    expect(trays).toHaveLength(4);
    expect(trays[0]!.globalId).toBe(0);
    expect(trays[0]!.type).toBe("PLA");
    expect(trays[2]!.empty).toBe(true);
    expect(trays[3]!.globalId).toBe(3);
    expect(trays[1]!.remainPercent).toBe(55);
  });

  test("UNKNOWN when nothing received yet", () => {
    const s = normalizeReport(undefined, meta);
    expect(s.state).toBe("UNKNOWN");
    expect(s.ams).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  test("hides the camera url when disabled", () => {
    const s = normalizeReport({ gcode_state: "IDLE", ipcam: { rtsp_url: "disable" } }, meta);
    expect(s.cameraUrl).toBeUndefined();
  });
});

describe("mergeReports (P1/A1 deltas)", () => {
  test("a delta overlays the accumulated full frame", async () => {
    const full = await load("report-running.json");
    const delta = await load("report-delta-finish.json");
    const merged = mergeReports(full, delta);
    const s = normalizeReport(merged.print, meta);
    expect(s.state).toBe("FINISH");
    expect(s.percent).toBe(100);
    // Field only present in the full frame survives the merge.
    expect(s.job).toBe("benchy");
    expect(s.totalLayers).toBe(140);
  });
});
