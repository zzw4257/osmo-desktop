import { describe, expect, it } from "vitest";
import { fingerprintVolume, pairLrfProxies, parseDjiFileName } from "./djiFiles";

describe("parseDjiFileName", () => {
  it("parses a Pocket-series video name", () => {
    const p = parseDjiFileName("DJI_20260701143022_0042_D.MP4");
    expect(p).not.toBeNull();
    expect(p!.sequence).toBe(42);
    expect(p!.suffix).toBe("D");
    expect(p!.ext).toBe("mp4");
    const d = new Date(p!.shotAt);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(1);
  });

  it("rejects non-DJI names and impossible dates", () => {
    expect(parseDjiFileName("IMG_1234.MP4")).toBeNull();
    expect(parseDjiFileName("DJI_notadate_0001_D.MP4")).toBeNull();
  });
});

describe("fingerprintVolume", () => {
  it("recognizes a DJI DCIM layout", () => {
    const fp = fingerprintVolume(
      new Map([
        ["DCIM/DJI_001", ["DJI_20260701143022_0042_D.MP4", "DJI_20260701143022_0042_D.LRF"]],
      ]),
    );
    expect(fp.isDjiDevice).toBe(true);
    expect(fp.mediaDirs).toEqual(["DCIM/DJI_001"]);
    expect(fp.namingConfidence).toBe(1);
  });

  it("treats a generic volume as non-DJI", () => {
    const fp = fingerprintVolume(new Map([["Documents", ["notes.txt"]]]));
    expect(fp.isDjiDevice).toBe(false);
  });
});

describe("pairLrfProxies", () => {
  it("pairs main videos with LRF proxies by stem", () => {
    const pairs = pairLrfProxies([
      "DJI_20260701143022_0042_D.MP4",
      "DJI_20260701143022_0042_D.LRF",
      "DJI_20260701150000_0043_D.MP4",
    ]);
    expect(pairs.get("DJI_20260701143022_0042_D.MP4")).toBe("DJI_20260701143022_0042_D.LRF");
    expect(pairs.has("DJI_20260701150000_0043_D.MP4")).toBe(false);
  });
});
