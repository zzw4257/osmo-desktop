/**
 * BT.2100 HLG → SDR reference math (mirrors the WGSL in gradeCore.ts; the
 * GPU implementation is tested against these functions).
 */
const A = 0.17883277;
const B = 0.28466892; // 1 - 4a
const C = 0.55991073; // 0.5 - a·ln(4a)

/** HLG inverse OETF: signal 0..1 → scene-linear 0..1 (per channel). */
export function hlgInvOetf(v: number): number {
  return v <= 0.5 ? (v * v) / 3 : (Math.exp((v - C) / A) + B) / 12;
}

/** BT.2020 luminance coefficients. */
export const BT2020_LUMA = [0.2627, 0.678, 0.0593] as const;

/** Row-major BT.2020 → BT.709 linear-light matrix. */
export const REC2020_TO_REC709 = [
  [1.6605, -0.5876, -0.0728],
  [-0.1246, 1.1329, -0.0083],
  [-0.0182, -0.1006, 1.1187],
] as const;

/** Full HLG signal → display-linear Rec.709 (γ=1.2 OOTF via luminance). */
export function hlgToRec709Linear(rgb: [number, number, number]): [number, number, number] {
  const scene = rgb.map((v) => hlgInvOetf(Math.min(Math.max(v, 0), 1)));
  const y =
    scene[0]! * BT2020_LUMA[0] + scene[1]! * BT2020_LUMA[1] + scene[2]! * BT2020_LUMA[2];
  const gain = Math.pow(Math.max(y, 1e-5), 0.2);
  const d = scene.map((v) => v * gain);
  const m = REC2020_TO_REC709;
  return [
    Math.max(m[0][0] * d[0]! + m[0][1] * d[1]! + m[0][2] * d[2]!, 0),
    Math.max(m[1][0] * d[0]! + m[1][1] * d[1]! + m[1][2] * d[2]!, 0),
    Math.max(m[2][0] * d[0]! + m[2][1] * d[1]! + m[2][2] * d[2]!, 0),
  ];
}
