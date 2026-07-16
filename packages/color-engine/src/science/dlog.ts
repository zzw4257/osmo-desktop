/**
 * DJI D-Log / D-Gamut color science — TypeScript reference implementation.
 *
 * Source: DJI "White Paper on D-Log and D-Gamut of DJI Cinema Color System",
 * Revision 1.0, 2017-09-29 (dl.djicdn.com/downloads/zenmuse+x7/20171010/
 * D-Log_D-Gamut_Whitepaper.pdf). Used by Osmo Pocket 4 (standard) "true
 * D-Log" footage among others.
 *
 * This module is the ground truth the WGSL shaders are tested against: the
 * GPU implementation must match these functions within tolerance.
 */

/** Scene-linear reflectance → D-Log code value (both normalized 0..1). */
export function linearToDlog(x: number): number {
  return x <= 0.0078
    ? 6.025 * x + 0.0929
    : Math.log10(x * 0.9892 + 0.0108) * 0.256663 + 0.584555;
}

/** D-Log code value → scene-linear reflectance. */
export function dlogToLinear(v: number): number {
  return v <= 0.14
    ? (v - 0.0929) / 6.025
    : (Math.pow(10, 3.89616 * v - 2.27752) - 0.0108) / 0.9892;
}

/** Row-major 3×3: D-Gamut RGB → Rec.709 RGB (linear light, D65). */
export const D_GAMUT_TO_REC709 = [
  [1.6746, -0.5797, -0.0949],
  [-0.0981, 1.334, -0.2359],
  [-0.041, -0.243, 1.284],
] as const;

/** Row-major 3×3: Rec.709 RGB → D-Gamut RGB (linear light, D65). */
export const REC709_TO_D_GAMUT = [
  [0.6163, 0.2857, 0.098],
  [0.0505, 0.799, 0.1505],
  [0.0292, 0.1604, 0.8104],
] as const;

/** D-Gamut primaries (CIE xy, D65 white) — for gamut visualizations. */
export const D_GAMUT_PRIMARIES = {
  red: { x: 0.71, y: 0.31 },
  green: { x: 0.21, y: 0.88 },
  blue: { x: 0.09, y: -0.08 },
  white: { x: 0.3127, y: 0.329 },
} as const;

export type Vec3 = [number, number, number];

export function mulMat3(m: readonly (readonly number[])[], v: Vec3): Vec3 {
  return [
    m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
    m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
    m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
  ];
}

/** Rec.709 OETF-inverse/forward pair (display gamma handled separately in
 * the pipeline output stage; kept here for the reference CST). */
export function rec709Oetf(x: number): number {
  return x < 0.018 ? 4.5 * x : 1.099 * Math.pow(x, 0.45) - 0.099;
}

/**
 * Full reference CST: D-Log/D-Gamut encoded pixel → Rec.709 display pixel.
 * The GPU path does the same stages inside P0/P3; this exists for tests and
 * for CPU-side baking (e.g. exporting a technical LUT of our transform).
 */
export function dlogPixelToRec709(rgb: Vec3): Vec3 {
  const linear: Vec3 = [dlogToLinear(rgb[0]), dlogToLinear(rgb[1]), dlogToLinear(rgb[2])];
  const rec709Linear = mulMat3(D_GAMUT_TO_REC709, linear);
  return [
    rec709Oetf(clamp01(rec709Linear[0])),
    rec709Oetf(clamp01(rec709Linear[1])),
    rec709Oetf(clamp01(rec709Linear[2])),
  ];
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** White-paper 10-bit anchor code values, used as test fixtures:
 * 0% reflectance → 95, 18% grey → 408, 90% reflectance → 586. */
export const DLOG_10BIT_ANCHORS = [
  { reflectance: 0.0, code10: 95 },
  { reflectance: 0.18, code10: 408 },
  { reflectance: 0.9, code10: 586 },
] as const;
