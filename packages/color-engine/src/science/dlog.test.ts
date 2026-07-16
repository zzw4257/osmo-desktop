import { describe, expect, it } from "vitest";
import {
  DLOG_10BIT_ANCHORS,
  D_GAMUT_TO_REC709,
  REC709_TO_D_GAMUT,
  dlogToLinear,
  linearToDlog,
  mulMat3,
} from "./dlog";

describe("D-Log transfer function (white-paper ground truth)", () => {
  it("matches the official 10-bit anchor code values", () => {
    // Full-range mapping: code = round(v * 1023).
    for (const { reflectance, code10 } of DLOG_10BIT_ANCHORS) {
      const v = linearToDlog(reflectance);
      expect(Math.round(v * 1023)).toBe(code10);
    }
  });

  it("round-trips linear → log → linear across the working range", () => {
    for (let i = 0; i <= 1000; i++) {
      const x = (i / 1000) * 4; // up to 400% reflectance (log encodes >1.0)
      const rt = dlogToLinear(linearToDlog(x));
      expect(rt).toBeCloseTo(x, 3);
    }
  });

  it("is continuous at the linear/log segment breakpoint", () => {
    const eps = 1e-6;
    const below = linearToDlog(0.0078 - eps);
    const above = linearToDlog(0.0078 + eps);
    expect(Math.abs(above - below)).toBeLessThan(1e-3);
  });
});

describe("D-Gamut matrices", () => {
  it("forward and inverse matrices compose to ~identity", () => {
    const probes: Array<[number, number, number]> = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.18, 0.18, 0.18],
      [0.7, 0.2, 0.5],
    ];
    for (const p of probes) {
      const roundTrip = mulMat3(REC709_TO_D_GAMUT, mulMat3(D_GAMUT_TO_REC709, p));
      for (let c = 0; c < 3; c++) {
        expect(roundTrip[c]).toBeCloseTo(p[c]!, 2);
      }
    }
  });

  it("maps grey to grey (rows sum to ~1)", () => {
    for (const m of [D_GAMUT_TO_REC709, REC709_TO_D_GAMUT]) {
      for (const row of m) {
        const sum = row[0]! + row[1]! + row[2]!;
        expect(sum).toBeCloseTo(1, 2);
      }
    }
  });
});
