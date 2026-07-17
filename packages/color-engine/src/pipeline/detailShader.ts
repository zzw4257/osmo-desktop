/**
 * P2 spatial pass: denoise → sharpen → grain, one 3×3-neighborhood fragment
 * pass between the grade intermediate and presentation. Skipped entirely
 * (no GPU cost) while all three parameters are zero.
 */
export const DETAIL_WGSL = /* wgsl */ `
struct DetailParams {
  sharpen: f32,   // 0..100
  denoise: f32,   // 0..100
  grain: f32,     // 0..100
  seed: f32,      // frame-varying so grain animates
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> P: DetailParams;

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

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  let texel = 1.0 / dims;
  let center = textureSample(src, samp, in.uv).rgb;

  // 3×3 neighborhood (gaussian-ish weights)
  var blur = center * 4.0;
  var bilateral = center * 4.0;
  var bilateral_w = 4.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let w = select(1.0, 2.0, dx == 0 || dy == 0);
      let n = textureSample(src, samp, in.uv + vec2f(f32(dx), f32(dy)) * texel).rgb;
      blur = blur + n * w;
      // bilateral: down-weight neighbors that differ (edge-preserving)
      let diff = n - center;
      let bw = w * exp(-dot(diff, diff) * 60.0);
      bilateral = bilateral + n * bw;
      bilateral_w = bilateral_w + bw;
    }
  }
  blur = blur / 16.0;
  bilateral = bilateral / bilateral_w;

  // denoise: blend toward the edge-preserving average
  var c = mix(center, bilateral, clamp(P.denoise * 0.01, 0.0, 1.0));

  // sharpen: unsharp mask against the plain blur
  c = c + (c - blur) * P.sharpen * 0.02;

  // grain: luma-weighted monochrome noise, strongest in midtones
  if (P.grain > 0.0) {
    let n = hash12(in.uv * dims + vec2f(P.seed, P.seed * 1.7)) - 0.5;
    let y = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    let mid_weight = 1.0 - abs(y - 0.5) * 1.6;
    c = c + vec3f(n) * P.grain * 0.0012 * max(mid_weight, 0.1) * 100.0 * 0.01;
  }

  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
