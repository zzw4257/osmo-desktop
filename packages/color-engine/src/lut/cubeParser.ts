/**
 * Adobe/Resolve .cube 3D LUT parser (the format DJI publishes official
 * D-Log M → Rec.709 LUTs in; 17/33/64/65-point cubes are what Mimo accepts).
 */
export interface Cube3dLut {
  size: number;
  title: string | null;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** RGB triples, red fastest: data[(b*N*N + g*N + r) * 3 + c] */
  data: Float32Array;
}

export function parseCube(text: string): Cube3dLut {
  let size = 0;
  let title: string | null = null;
  const domainMin: [number, number, number] = [0, 0, 0];
  const domainMax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  let cursor = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    if (/^[A-Za-z]/.test(line)) {
      const upper = line.toUpperCase();
      if (upper.startsWith("TITLE")) {
        title = line.slice(5).trim().replace(/^"|"$/g, "");
      } else if (upper.startsWith("LUT_3D_SIZE")) {
        size = Number(line.split(/\s+/)[1]);
        if (!Number.isInteger(size) || size < 2 || size > 256) {
          throw new Error(`Invalid LUT_3D_SIZE: ${size}`);
        }
        data = new Float32Array(size * size * size * 3);
      } else if (upper.startsWith("DOMAIN_MIN")) {
        const v = line.split(/\s+/).slice(1).map(Number);
        domainMin[0] = v[0] ?? 0;
        domainMin[1] = v[1] ?? 0;
        domainMin[2] = v[2] ?? 0;
      } else if (upper.startsWith("DOMAIN_MAX")) {
        const v = line.split(/\s+/).slice(1).map(Number);
        domainMax[0] = v[0] ?? 1;
        domainMax[1] = v[1] ?? 1;
        domainMax[2] = v[2] ?? 1;
      } else if (upper.startsWith("LUT_1D_SIZE")) {
        throw new Error("1D .cube LUTs are not supported (expected 3D)");
      }
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    if (!data) throw new Error(".cube data before LUT_3D_SIZE");
    if (cursor + 3 > data.length) throw new Error(".cube has more entries than size³");
    data[cursor++] = Number(parts[0]);
    data[cursor++] = Number(parts[1]);
    data[cursor++] = Number(parts[2]);
  }

  if (!data || size === 0) throw new Error("Missing LUT_3D_SIZE");
  if (cursor !== data.length) {
    throw new Error(`.cube entry count mismatch: got ${cursor / 3}, want ${size ** 3}`);
  }
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i]!)) throw new Error(".cube contains non-finite values");
  }
  return { size, title, domainMin, domainMax, data };
}

/** Expand RGB triples to RGBA (A=1) for texture upload. */
export function cubeToRgba(lut: Cube3dLut): Float32Array {
  const n = lut.size ** 3;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = lut.data[i * 3]!;
    out[i * 4 + 1] = lut.data[i * 3 + 1]!;
    out[i * 4 + 2] = lut.data[i * 3 + 2]!;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** Identity cube for the "no LUT loaded" dummy binding. */
export function identityCube(size = 2): Cube3dLut {
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[i++] = r / (size - 1);
        data[i++] = g / (size - 1);
        data[i++] = b / (size - 1);
      }
    }
  }
  return { size, title: "identity", domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}
