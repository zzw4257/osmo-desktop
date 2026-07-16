import { bakeCurveLut } from "../curves/spline";
import type { Grade } from "../grade/schema";
import type { Cube3dLut } from "../lut/cubeParser";
import { cubeToRgba, identityCube } from "../lut/cubeParser";
import { floatsToHalves } from "../lut/halfFloat";
import { EXPORT_WGSL } from "./exportShader";
import { packParams } from "./uniforms";

/**
 * Everything the native (Rust/wgpu) export pipeline needs, packed by the
 * SAME TS code the preview uses — Rust uploads these blobs verbatim and
 * implements zero grading math. Buffers are base64-encoded for Tauri IPC.
 */
export interface ExportPayload {
  shaderWgsl: string;
  paramsB64: string; // 288B uniform block (uniforms.ts layout)
  curvesB64: string; // 1024×6 f32, row-major (r32float texture)
  inputLutB64: string; // rgba16f voxels, red-fastest
  inputLutSize: number;
  creativeLutB64: string;
  creativeLutSize: number;
}

export function buildExportPayload(
  grade: Grade,
  inputLut: Cube3dLut | null,
  creativeLut: Cube3dLut | null,
): ExportPayload {
  const params = packParams(grade);

  const CURVE_SIZE = 1024;
  const rows = new Float32Array(CURVE_SIZE * 6);
  const c = grade.ops.curves;
  rows.set(bakeCurveLut(c.luma, CURVE_SIZE), 0);
  rows.set(bakeCurveLut(c.red, CURVE_SIZE), CURVE_SIZE);
  rows.set(bakeCurveLut(c.green, CURVE_SIZE), CURVE_SIZE * 2);
  rows.set(bakeCurveLut(c.blue, CURVE_SIZE), CURVE_SIZE * 3);
  rows.set(bakeCurveLut(c.hueVsHue, CURVE_SIZE, "zero"), CURVE_SIZE * 4);
  rows.set(bakeCurveLut(c.hueVsSat, CURVE_SIZE, "zero"), CURVE_SIZE * 5);

  const input = inputLut ?? identityCube(2);
  const creative = creativeLut ?? identityCube(2);

  return {
    shaderWgsl: EXPORT_WGSL,
    paramsB64: toB64(params),
    curvesB64: toB64(rows.buffer),
    inputLutB64: toB64(floatsToHalves(cubeToRgba(input)).buffer),
    inputLutSize: input.size,
    creativeLutB64: toB64(floatsToHalves(cubeToRgba(creative)).buffer),
    creativeLutSize: creative.size,
  };
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
