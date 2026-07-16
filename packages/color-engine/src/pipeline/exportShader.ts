import { GRADE_CORE_WGSL } from "./gradeCore";

/**
 * Export shell around the shared grade core, run by NATIVE wgpu on the Rust
 * side (the string is passed over IPC / embedded — same source as preview).
 *
 * Input: decoded P010 planes uploaded as r16unorm (Y) + rg16unorm (UV, half
 * res). Output: packed P010 frame in a storage buffer (Y plane then
 * interleaved UV plane), limited-range BT.709, 10 bits in the high bits.
 *
 * One thread per 2×2 pixel block: writes 2 Y words (2 u16 each) and 1 UV
 * word — no overlapping writes, no atomics.
 */
export const EXPORT_WGSL = /* wgsl */ `
${GRADE_CORE_WGSL}

struct FrameInfo {
  width: u32,
  height: u32,
}

@group(1) @binding(0) var y_tex: texture_2d<f32>;    // r16unorm, w × h
@group(1) @binding(1) var uv_tex: texture_2d<f32>;   // rg16unorm, w/2 × h/2
@group(1) @binding(2) var<storage, read_write> out_buf: array<u32>;
@group(1) @binding(3) var<uniform> info: FrameInfo;

// P010 sample (v10 << 6) read via r16unorm → v10 = s * 65535 / 64
fn p010_to_10bit(s: f32) -> f32 {
  return s * 65535.0 / 64.0;
}

// Limited-range BT.709 10-bit YUV → encoded R'G'B'
fn yuv_to_rgb(y10: f32, cb10: f32, cr10: f32) -> vec3f {
  let y = (y10 - 64.0) / 876.0;
  let cb = (cb10 - 512.0) / 896.0;
  let cr = (cr10 - 512.0) / 896.0;
  return vec3f(
    y + 1.5748 * cr,
    y - 0.18732 * cb - 0.46812 * cr,
    y + 1.8556 * cb,
  );
}

// Encoded R'G'B' → limited-range BT.709 10-bit YCbCr
fn rgb_to_yuv10(c: vec3f) -> vec3f {
  let y = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let cb = (c.b - y) / 1.8556;
  let cr = (c.r - y) / 1.5748;
  return vec3f(
    clamp(64.0 + y * 876.0, 0.0, 1023.0),
    clamp(512.0 + cb * 896.0, 0.0, 1023.0),
    clamp(512.0 + cr * 896.0, 0.0, 1023.0),
  );
}

fn p010_word(a10: f32, b10: f32) -> u32 {
  let a = u32(round(a10)) << 6u;
  let b = u32(round(b10)) << 6u;
  return a | (b << 16u);
}

fn load_graded(x: u32, y: u32) -> vec3f {
  let w = info.width;
  let h = info.height;
  let y10 = p010_to_10bit(textureLoad(y_tex, vec2u(x, y), 0).r);
  let uvs = textureLoad(uv_tex, vec2u(x / 2u, y / 2u), 0).rg;
  let cb10 = p010_to_10bit(uvs.x);
  let cr10 = p010_to_10bit(uvs.y);
  let raw = clamp(yuv_to_rgb(y10, cb10, cr10), vec3f(0.0), vec3f(1.0));
  let uv = vec2f((f32(x) + 0.5) / f32(w), (f32(y) + 0.5) / f32(h));
  return grade_pixel(raw, uv);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let w = info.width;
  let h = info.height;
  let bx = gid.x * 2u;
  let by = gid.y * 2u;
  if (bx >= w || by >= h) { return; }

  let c00 = rgb_to_yuv10(load_graded(bx, by));
  let c10 = rgb_to_yuv10(load_graded(bx + 1u, by));
  let c01 = rgb_to_yuv10(load_graded(bx, by + 1u));
  let c11 = rgb_to_yuv10(load_graded(bx + 1u, by + 1u));

  // Y plane: u16 index = y*w + x, two per u32 (w is even)
  out_buf[(by * w + bx) / 2u] = p010_word(c00.x, c10.x);
  out_buf[((by + 1u) * w + bx) / 2u] = p010_word(c01.x, c11.x);

  // UV plane (after Y plane, w*h/2 u32 words in): one CbCr pair per 2×2
  let y_words = w * h / 2u;
  let uv_row_pairs = w / 2u;
  let cb = (c00.y + c10.y + c01.y + c11.y) * 0.25;
  let cr = (c00.z + c10.z + c01.z + c11.z) * 0.25;
  out_buf[y_words + (by / 2u) * uv_row_pairs + (bx / 2u)] = p010_word(cb, cr);
}
`;
