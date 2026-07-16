/**
 * The grade mega-shader (P0 ingest + P1 grade fused into one pass).
 *
 * Design rules:
 * - Zero pipeline rebuilds: every op is always executed, neutral parameters
 *   are mathematically identity (or blended out with mix()) — dragging a
 *   slider only rewrites the uniform buffer.
 * - Op order here IS grade schema semantics (schemaVersion 1); keep in sync
 *   with packages/color-engine/src/grade/schema.ts.
 * - The TS-side uniform packer (uniforms.ts) mirrors the Params struct
 *   byte-for-byte; change them together.
 *
 * Domains: working space is linear Rec.709. Tonal/wheel/curve ops run in a
 * gamma-encoded "grading domain" (γ=2.4-ish via pow) like Resolve's video
 * levels, then return to linear for output encoding.
 */
export const GRADE_WGSL = /* wgsl */ `
struct Params {
  input_mode: u32,          // 0 bypass, 1 dlog CST, 2 3D input LUT, 3 hlg (M2)
  input_strength: f32,
  temp: f32,
  tint: f32,

  exposure: f32,
  contrast: f32,
  highlights: f32,
  shadows: f32,

  whites: f32,
  blacks: f32,
  saturation: f32,
  vibrance: f32,

  fade: f32,
  split_shadow_hue: f32,
  split_shadow_sat: f32,
  split_highlight_hue: f32,

  split_highlight_sat: f32,
  split_balance: f32,
  creative_lut_strength: f32,
  creative_lut_enabled: u32,

  vig_amount: f32,
  vig_midpoint: f32,
  vig_roundness: f32,
  vig_feather: f32,

  lift: vec4f,
  gamma_w: vec4f,
  gain: vec4f,
  offset_w: vec4f,

  hsl: array<vec4f, 8>,     // per band: x=hueShift(deg) y=satScale z=lumScale
}

@group(0) @binding(0) var<uniform> P: Params;
// Curve LUTs: 1024 × 6 rows (luma, r, g, b, hueVsHue, hueVsSat), r32float
@group(0) @binding(1) var curves: texture_2d<f32>;

@group(1) @binding(0) var video: texture_external;
@group(1) @binding(1) var video_samp: sampler;

@group(2) @binding(0) var input_lut: texture_3d<f32>;
@group(2) @binding(1) var creative_lut: texture_3d<f32>;
@group(2) @binding(2) var lut_samp: sampler;

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

// ---------- color science ----------

const GRADE_GAMMA: f32 = 2.4;

fn dlog_to_linear(v: vec3f) -> vec3f {
  // DJI white paper: piecewise at code 0.14
  let lin_seg = (v - vec3f(0.0929)) / 6.025;
  let log_seg = (pow(vec3f(10.0), 3.89616 * v - 2.27752) - 0.0108) / 0.9892;
  return select(log_seg, lin_seg, v <= vec3f(0.14));
}

const D_GAMUT_TO_REC709 = mat3x3f(
  vec3f(1.6746, -0.0981, -0.041),   // column 0
  vec3f(-0.5797, 1.334, -0.243),    // column 1
  vec3f(-0.0949, -0.2359, 1.284),   // column 2
);

fn srgbish_to_linear(v: vec3f) -> vec3f {
  return pow(max(v, vec3f(0.0)), vec3f(GRADE_GAMMA));
}

fn linear_to_srgbish(v: vec3f) -> vec3f {
  return pow(max(v, vec3f(0.0)), vec3f(1.0 / GRADE_GAMMA));
}

fn luma_of(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722)); // Rec.709
}

fn rgb_to_hsv(c: vec3f) -> vec3f {
  let cmax = max(c.r, max(c.g, c.b));
  let cmin = min(c.r, min(c.g, c.b));
  let d = cmax - cmin;
  var h = 0.0;
  if (d > 1e-6) {
    if (cmax == c.r) {
      h = ((c.g - c.b) / d) % 6.0;
    } else if (cmax == c.g) {
      h = (c.b - c.r) / d + 2.0;
    } else {
      h = (c.r - c.g) / d + 4.0;
    }
    h = h / 6.0;
    if (h < 0.0) { h = h + 1.0; }
  }
  let s = select(0.0, d / cmax, cmax > 1e-6);
  return vec3f(h, s, cmax);
}

fn hsv_to_rgb(hsv: vec3f) -> vec3f {
  let h = hsv.x * 6.0;
  let s = hsv.y;
  let v = hsv.z;
  let c = v * s;
  let x = c * (1.0 - abs(h % 2.0 - 1.0));
  let m = v - c;
  var rgb = vec3f(0.0);
  if (h < 1.0)      { rgb = vec3f(c, x, 0.0); }
  else if (h < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (h < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (h < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (h < 5.0) { rgb = vec3f(x, 0.0, c); }
  else              { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(m);
}

fn hue_to_rgb(hue01: f32) -> vec3f {
  return hsv_to_rgb(vec3f(hue01, 1.0, 1.0));
}

// Piecewise-linear sample of a baked curve row with manual lerp.
fn sample_curve(row: u32, x: f32) -> f32 {
  let w = 1024.0;
  let fx = clamp(x, 0.0, 1.0) * (w - 1.0);
  let i0 = u32(floor(fx));
  let i1 = min(i0 + 1u, u32(w) - 1u);
  let t = fx - floor(fx);
  let a = textureLoad(curves, vec2u(i0, row), 0).r;
  let b = textureLoad(curves, vec2u(i1, row), 0).r;
  return mix(a, b, t);
}

fn sample_lut3d(tex: texture_3d<f32>, c: vec3f, size: f32) -> vec3f {
  // half-texel inset so [0,1] maps to texel centers
  let scale = (size - 1.0) / size;
  let offset = 0.5 / size;
  let coord = clamp(c, vec3f(0.0), vec3f(1.0)) * scale + vec3f(offset);
  return textureSampleLevel(tex, lut_samp, coord, 0.0).rgb;
}

// ---------- fragment ----------

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let raw = textureSampleBaseClampToEdge(video, video_samp, in.uv).rgb;

  // ---- input transform → linear working space ----
  var lin: vec3f;
  if (P.input_mode == 1u) {
    lin = D_GAMUT_TO_REC709 * dlog_to_linear(raw);
  } else if (P.input_mode == 2u) {
    // 3D LUT maps encoded source → Rec.709 display-encoded
    lin = srgbish_to_linear(sample_lut3d(input_lut, raw, f32(textureDimensions(input_lut).x)));
  } else {
    lin = srgbish_to_linear(raw);
  }
  if (P.input_strength < 1.0) {
    lin = mix(srgbish_to_linear(raw), lin, max(P.input_strength, 0.0));
  }

  // ---- white balance (linear, simple channel gains) ----
  let t = P.temp * 0.01;   // -1..1
  let g = P.tint * 0.01;
  let wb = vec3f(1.0 + 0.30 * t - 0.10 * g, 1.0 + 0.20 * g, 1.0 - 0.30 * t - 0.10 * g);
  lin = max(lin * wb, vec3f(0.0));

  // ---- exposure (linear stops) ----
  lin = lin * exp2(P.exposure);

  // ---- to grading domain (gamma encoded) ----
  var v = linear_to_srgbish(lin);

  // ---- tonal six-pack ----
  // contrast around 18% grey pivot in the grading domain
  let pivot = pow(0.18, 1.0 / GRADE_GAMMA);
  let contrast = 1.0 + P.contrast * 0.01;
  v = (v - vec3f(pivot)) * contrast + vec3f(pivot);

  let y0 = clamp(luma_of(v), 0.0, 1.0);
  // region masks: smooth, sum ≤ 1 in mid regions
  let hi_mask = smoothstep(0.5, 1.0, y0);
  let sh_mask = 1.0 - smoothstep(0.0, 0.5, y0);
  let wh_mask = smoothstep(0.75, 1.0, y0);
  let bl_mask = 1.0 - smoothstep(0.0, 0.25, y0);
  let tonal_shift =
      P.highlights * 0.004 * hi_mask
    + P.shadows    * 0.004 * sh_mask
    + P.whites     * 0.003 * wh_mask
    + P.blacks     * 0.003 * bl_mask;
  v = v + vec3f(tonal_shift);

  // ---- wheels (lift/gamma/gain/offset), master in .w ----
  let lift = P.lift.rgb + vec3f(P.lift.w);
  let gain = vec3f(1.0) + P.gain.rgb + vec3f(P.gain.w);
  let gamma_adj = vec3f(1.0) - (P.gamma_w.rgb + vec3f(P.gamma_w.w)); // + → brighter mids
  let offset = P.offset_w.rgb + vec3f(P.offset_w.w);
  v = max(v, vec3f(0.0));
  v = pow(v, max(gamma_adj, vec3f(0.05)));
  v = v * gain + lift * (vec3f(1.0) - v) * 0.5 + offset;

  // ---- curves: luma then per-channel ----
  let y1 = clamp(luma_of(v), 0.0, 1.0);
  let y_curved = sample_curve(0u, y1);
  let y_ratio = select(1.0, y_curved / max(y1, 1e-4), y1 > 1e-4);
  v = v * y_ratio;
  v = vec3f(
    sample_curve(1u, clamp(v.r, 0.0, 1.0)),
    sample_curve(2u, clamp(v.g, 0.0, 1.0)),
    sample_curve(3u, clamp(v.b, 0.0, 1.0)),
  );

  // ---- HSL bands + hue curves ----
  var hsv = rgb_to_hsv(clamp(v, vec3f(0.0), vec3f(1.0)));
  // hue curves: rows 4 (hueVsHue, offset in ±0.5 turns) and 5 (hueVsSat, ±1 scale)
  let hue_shift_curve = sample_curve(4u, hsv.x);          // 0 = neutral
  let sat_scale_curve = sample_curve(5u, hsv.x);          // 0 = neutral
  hsv.x = fract(hsv.x + hue_shift_curve * 0.5 + 1.0);
  hsv.y = clamp(hsv.y * (1.0 + sat_scale_curve), 0.0, 1.0);
  // 8 fixed bands (centers every 45°), gaussian-ish weights
  var hue_delta = 0.0;
  var sat_mul = 1.0;
  var lum_mul = 1.0;
  for (var b = 0u; b < 8u; b++) {
    let center = f32(b) / 8.0;
    var d = abs(hsv.x - center);
    d = min(d, 1.0 - d);                    // wrap-around distance
    let wgt = max(0.0, 1.0 - d * 8.0);      // triangle, width = 1 band
    let adj = P.hsl[b];
    hue_delta = hue_delta + wgt * adj.x / 360.0;
    sat_mul = sat_mul * (1.0 + wgt * adj.y * 0.01);
    lum_mul = lum_mul * (1.0 + wgt * adj.z * 0.005);
  }
  hsv.x = fract(hsv.x + hue_delta + 1.0);
  hsv.y = clamp(hsv.y * sat_mul, 0.0, 1.0);
  hsv.z = clamp(hsv.z * lum_mul, 0.0, 1.0);
  v = hsv_to_rgb(hsv);

  // ---- saturation & vibrance ----
  let y2 = luma_of(v);
  let sat = 1.0 + P.saturation * 0.01;
  v = mix(vec3f(y2), v, sat);
  // vibrance: boost low-sat pixels more, protect skin-ish hues
  let hsv2 = rgb_to_hsv(clamp(v, vec3f(0.0), vec3f(1.0)));
  let skin_dist = min(abs(hsv2.x - 0.083), 1.0 - abs(hsv2.x - 0.083)); // ~30° orange
  let skin_protect = smoothstep(0.0, 0.15, skin_dist);
  let vib = P.vibrance * 0.01 * (1.0 - hsv2.y) * mix(0.35, 1.0, skin_protect);
  v = mix(vec3f(luma_of(v)), v, 1.0 + vib);

  // ---- split tone ----
  let y3 = clamp(luma_of(v), 0.0, 1.0);
  let balance = P.split_balance * 0.005;
  let sh_w = 1.0 - smoothstep(0.25 + balance, 0.75 + balance, y3);
  let hi_w = smoothstep(0.25 + balance, 0.75 + balance, y3);
  let sh_tint = (hue_to_rgb(P.split_shadow_hue / 360.0) - vec3f(0.5)) * P.split_shadow_sat * 0.002;
  let hi_tint = (hue_to_rgb(P.split_highlight_hue / 360.0) - vec3f(0.5)) * P.split_highlight_sat * 0.002;
  v = v + sh_tint * sh_w + hi_tint * hi_w;

  // ---- fade (lifted blacks, film print emulation) ----
  let f = P.fade * 0.01;
  v = mix(v, v * 0.88 + vec3f(0.10), f);

  // ---- creative LUT ----
  if (P.creative_lut_enabled == 1u) {
    let lutted = sample_lut3d(creative_lut, clamp(v, vec3f(0.0), vec3f(1.0)),
                              f32(textureDimensions(creative_lut).x));
    v = mix(v, lutted, clamp(P.creative_lut_strength, 0.0, 1.0));
  }

  // ---- vignette ----
  let centered = (in.uv - vec2f(0.5)) * 2.0;
  let roundness = P.vig_roundness * 0.01;   // -1 rect … 0 ellipse … +1 circle
  let aspect_pull = mix(1.0, 9.0 / 16.0, clamp(roundness, 0.0, 1.0));
  let rv = vec2f(centered.x, centered.y * (1.0 / aspect_pull));
  let dist = length(rv) * 0.7071;
  let mid = P.vig_midpoint * 0.01;
  let feather = max(P.vig_feather * 0.01, 0.01);
  let vig_mask = smoothstep(mid - feather * 0.5, mid + feather * 0.5 + 0.001, dist);
  let vig = 1.0 + P.vig_amount * 0.01 * vig_mask;
  v = v * max(vig, 0.0);

  return vec4f(clamp(v, vec3f(0.0), vec3f(1.0)), 1.0);
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
