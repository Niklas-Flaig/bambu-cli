import { describe, expect, test } from "bun:test";
import { decodeHms } from "../src/hms.ts";

describe("decodeHms", () => {
  test("empty or missing yields no entries", () => {
    expect(decodeHms(undefined)).toEqual([]);
    expect(decodeHms([])).toEqual([]);
  });

  test("decodes severity from the high bits of code", () => {
    // code 0x0001xxxx => fatal, 0x0002xxxx => serious, etc.
    const entries = decodeHms([
      { attr: 0x03000100, code: 0x00010001 },
      { attr: 0x07008000, code: 0x00020002 },
      { attr: 0x05000200, code: 0x00030003 },
      { attr: 0x0c000100, code: 0x00040004 },
    ]);
    expect(entries.map((e) => e.severity)).toEqual(["fatal", "serious", "common", "info"]);
  });

  test("builds the AAAA_BBBB_CCCC_DDDD key", () => {
    const [entry] = decodeHms([{ attr: 0x0300_0100, code: 0x0001_0002 }]);
    expect(entry!.code).toBe("0300_0100_0001_0002");
  });

  test("skips malformed entries", () => {
    // @ts-expect-error intentionally malformed input
    expect(decodeHms([{ attr: 1 }, null, { code: 2 }])).toEqual([]);
  });
});
