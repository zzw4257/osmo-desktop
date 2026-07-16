import { describe, expect, it } from "vitest";
import { bakeCurveLut } from "./spline";

describe("bakeCurveLut", () => {
  it("empty points yields identity diagonal", () => {
    const lut = bakeCurveLut([], 256);
    expect(lut[0]).toBeCloseTo(0, 5);
    expect(lut[128]).toBeCloseTo(128 / 255, 5);
    expect(lut[255]).toBeCloseTo(1, 5);
  });

  it("empty points yields zero line for offset-style curves", () => {
    const lut = bakeCurveLut([], 256, "zero");
    expect(lut[0]).toBe(0);
    expect(lut[200]).toBe(0);
  });

  it("passes through control points", () => {
    const lut = bakeCurveLut(
      [
        [0, 0],
        [0.5, 0.7],
        [1, 1],
      ],
      1001,
    );
    expect(lut[0]).toBeCloseTo(0, 4);
    expect(lut[500]).toBeCloseTo(0.7, 3);
    expect(lut[1000]).toBeCloseTo(1, 4);
  });

  it("is monotone for monotone control points (no ringing)", () => {
    const lut = bakeCurveLut(
      [
        [0, 0],
        [0.25, 0.1],
        [0.5, 0.8],
        [1, 1],
      ],
      512,
    );
    for (let i = 1; i < 512; i++) {
      expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]! - 1e-9);
    }
  });

  it("clamps outside the control range to endpoint values", () => {
    const lut = bakeCurveLut(
      [
        [0.25, 0.3],
        [0.75, 0.6],
      ],
      101,
    );
    expect(lut[0]).toBeCloseTo(0.3, 5);
    expect(lut[100]).toBeCloseTo(0.6, 5);
  });
});
