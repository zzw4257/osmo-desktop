import { describe, expect, it } from "vitest";
import { hlgInvOetf, hlgToRec709Linear } from "./hlg";

describe("HLG BT.2100 math", () => {
  it("inverse OETF hits the standard anchor points", () => {
    expect(hlgInvOetf(0)).toBeCloseTo(0, 8);
    expect(hlgInvOetf(0.5)).toBeCloseTo(1 / 12, 6); // segment junction
    expect(hlgInvOetf(1)).toBeCloseTo(1, 4); // full signal → full scene light
  });

  it("is continuous at the 0.5 junction", () => {
    const eps = 1e-6;
    expect(Math.abs(hlgInvOetf(0.5 + eps) - hlgInvOetf(0.5 - eps))).toBeLessThan(1e-4);
  });

  // Tolerances match the 4-decimal matrix coefficients (row sums are
  // 1.0000 ± 0.0001, i.e. 0.01% grey error — irrelevant for video).
  it("maps grey to grey through the full pipeline (no hue shift)", () => {
    const [r, g, b] = hlgToRec709Linear([0.6, 0.6, 0.6]);
    expect(r).toBeCloseTo(g, 4);
    expect(g).toBeCloseTo(b, 4);
  });

  it("white maps to ~1.0 display linear", () => {
    const [r, g, b] = hlgToRec709Linear([1, 1, 1]);
    expect(r).toBeGreaterThan(0.95);
    expect(r).toBeLessThan(1.05);
    expect(g).toBeCloseTo(r, 3);
    expect(b).toBeCloseTo(r, 3);
  });

  it("is monotone in luminance", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = i / 20;
      const [r] = hlgToRec709Linear([v, v, v]);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});
