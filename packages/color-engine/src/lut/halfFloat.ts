/** IEEE 754 binary16 conversion for uploading float LUT/texture data. */
export function floatToHalf(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf/nan
  // Round-to-nearest-even on the mantissa we keep
  const halfExp = exp - 127 + 15;
  if (halfExp >= 0x1f) return sign | 0x7c00; // overflow → inf
  if (halfExp <= 0) {
    // subnormal half
    if (halfExp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - halfExp;
    const rounded = (mant + (1 << (shift - 1))) >>> shift;
    return sign | rounded;
  }
  const rounded = mant + 0x1000;
  if (rounded & 0x800000) {
    mant = 0;
    exp += 1;
    if (exp - 127 + 15 >= 0x1f) return sign | 0x7c00;
    return sign | ((exp - 127 + 15) << 10);
  }
  return sign | (halfExp << 10) | (rounded >>> 13);
}

export function floatsToHalves(src: ArrayLike<number>): Uint16Array<ArrayBuffer> {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = floatToHalf(src[i]!);
  return out;
}

export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
