import type { Grade } from "../grade/schema";
import { HSL_BANDS } from "../grade/schema";

/** Byte size of the WGSL Params struct in gradeShader.ts. */
export const PARAMS_BYTE_SIZE = 288;

export type InputMode = 0 | 1 | 2 | 3;

export function inputModeFor(grade: Grade): InputMode {
  if (grade.input.profile === "dlog") return 1;
  if (grade.input.inputLut !== null) return 2; // dlog-m / dlog2 via LUT
  if (grade.input.profile === "hlg") return 3; // M2: tone map (bypass for now)
  return 0;
}

/**
 * Pack a Grade into the uniform buffer bytes. MUST mirror the Params struct
 * in gradeShader.ts field-for-field — both files carry this warning.
 */
export function packParams(grade: Grade, out?: ArrayBuffer): ArrayBuffer {
  const buf = out ?? new ArrayBuffer(PARAMS_BYTE_SIZE);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const o = grade.ops;

  u[0] = inputModeFor(grade);
  f[1] = grade.input.strength;
  f[2] = o.whiteBalance.temp;
  f[3] = o.whiteBalance.tint;

  f[4] = o.tonal.exposure;
  f[5] = o.tonal.contrast;
  f[6] = o.tonal.highlights;
  f[7] = o.tonal.shadows;

  f[8] = o.tonal.whites;
  f[9] = o.tonal.blacks;
  f[10] = o.saturation;
  f[11] = o.vibrance;

  f[12] = o.fade;
  f[13] = o.splitTone.shadowHue;
  f[14] = o.splitTone.shadowSat;
  f[15] = o.splitTone.highlightHue;

  f[16] = o.splitTone.highlightSat;
  f[17] = o.splitTone.balance;
  f[18] = o.creativeLut?.strength ?? 0;
  u[19] = o.creativeLut ? 1 : 0;

  f[20] = o.vignette.amount;
  f[21] = o.vignette.midpoint;
  f[22] = o.vignette.roundness;
  f[23] = o.vignette.feather;

  f.set(o.wheels.lift, 24);
  f.set(o.wheels.gamma, 28);
  f.set(o.wheels.gain, 32);
  f.set(o.wheels.offset, 36);

  for (let b = 0; b < 8; b++) {
    const band = o.hsl[HSL_BANDS[b]!]!;
    const base = 40 + b * 4;
    f[base] = band.h;
    f[base + 1] = band.s;
    f[base + 2] = band.l;
    f[base + 3] = 0;
  }
  return buf;
}
