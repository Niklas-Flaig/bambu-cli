import { describe, expect, test } from "bun:test";
import { modelFromSerial } from "../src/model.ts";

describe("modelFromSerial", () => {
  test("maps this printer's prefix to X1C", () => {
    expect(modelFromSerial("00M09D4A2100751")).toBe("X1C");
  });

  test("maps known prefixes", () => {
    expect(modelFromSerial("039XXXXXXXXXXXX")).toBe("A1");
    expect(modelFromSerial("030XXXXXXXXXXXX")).toBe("A1 mini");
  });

  test("undefined for an unknown prefix", () => {
    expect(modelFromSerial("ZZZ000")).toBeUndefined();
  });
});
