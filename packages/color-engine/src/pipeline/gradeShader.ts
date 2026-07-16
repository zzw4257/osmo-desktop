import { GRADE_CORE_WGSL } from "./gradeCore";

/**
 * Preview shell around the shared grade core: samples the decoded frame via
 * texture_external (zero-copy) and writes the graded intermediate.
 * See gradeCore.ts for the grading math and binding contract.
 */
export const GRADE_WGSL = /* wgsl */ `
${GRADE_CORE_WGSL}

@group(1) @binding(0) var video: texture_external;
@group(1) @binding(1) var video_samp: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0),
  );
  let p = positions[vi];
  var out: VSOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let raw = textureSampleBaseClampToEdge(video, video_samp, in.uv).rgb;
  return vec4f(grade_pixel(raw, in.uv), 1.0);
}
`;

/** P3: plain blit of the graded intermediate to the canvas. */
export const PRESENT_WGSL = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0),
  );
  let p = positions[vi];
  var out: VSOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
  return out;
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(textureSample(src, samp, in.uv).rgb, 1.0);
}
`;
