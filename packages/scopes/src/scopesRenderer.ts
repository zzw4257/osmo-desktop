/**
 * Video scopes: RGB histogram + luma waveform + CbCr vectorscope, computed
 * on-GPU from the graded intermediate texture (post-grade, pre-display) and
 * drawn straight from storage buffers — pixel data never returns to the CPU.
 */
const WAVE_COLS = 512;
const WAVE_ROWS = 256;
const HIST_BINS = 256;
const VEC_SIZE = 256;
const SAMPLE_STRIDE = 2;

const COMPUTE_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> hist: array<atomic<u32>, ${HIST_BINS * 3}>;
@group(0) @binding(2) var<storage, read_write> wave: array<atomic<u32>, ${WAVE_COLS * WAVE_ROWS}>;
@group(0) @binding(3) var<storage, read_write> maxima: array<atomic<u32>, 3>; // [histMax, waveMax, vecMax]
@group(0) @binding(4) var<storage, read_write> vecs: array<atomic<u32>, ${VEC_SIZE * VEC_SIZE}>;

fn luma_of(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(src);
  let xy = gid.xy * ${SAMPLE_STRIDE}u;
  if (xy.x >= dims.x || xy.y >= dims.y) { return; }
  let c = clamp(textureLoad(src, xy, 0).rgb, vec3f(0.0), vec3f(1.0));

  let rb = u32(c.r * ${HIST_BINS - 1}.0);
  let gb = u32(c.g * ${HIST_BINS - 1}.0);
  let bb = u32(c.b * ${HIST_BINS - 1}.0);
  let hr = atomicAdd(&hist[rb], 1u) + 1u;
  let hg = atomicAdd(&hist[${HIST_BINS}u + gb], 1u) + 1u;
  let hb = atomicAdd(&hist[${HIST_BINS * 2}u + bb], 1u) + 1u;
  atomicMax(&maxima[0], max(hr, max(hg, hb)));

  let col = min(xy.x * ${WAVE_COLS}u / dims.x, ${WAVE_COLS - 1}u);
  let y = clamp(luma_of(c), 0.0, 1.0);
  let row = u32((1.0 - y) * ${WAVE_ROWS - 1}.0);
  let w = atomicAdd(&wave[row * ${WAVE_COLS}u + col], 1u) + 1u;
  atomicMax(&maxima[1], w);

  // Vectorscope: BT.709 CbCr, centered; Cb → +x, Cr → +y(up)
  let cb = clamp((c.b - y) / 1.8556 + 0.5, 0.0, 1.0);
  let cr = clamp((c.r - y) / 1.5748 + 0.5, 0.0, 1.0);
  let vx = min(u32(cb * ${VEC_SIZE - 1}.0), ${VEC_SIZE - 1}u);
  let vy = min(u32((1.0 - cr) * ${VEC_SIZE - 1}.0), ${VEC_SIZE - 1}u);
  let vv = atomicAdd(&vecs[vy * ${VEC_SIZE}u + vx], 1u) + 1u;
  atomicMax(&maxima[2], vv);
}
`;

const DRAW_WGSL = /* wgsl */ `
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

@group(0) @binding(0) var<storage, read> hist: array<u32, ${HIST_BINS * 3}>;
@group(0) @binding(1) var<storage, read> wave: array<u32, ${WAVE_COLS * WAVE_ROWS}>;
@group(0) @binding(2) var<storage, read> maxima: array<u32, 3>;
@group(0) @binding(3) var<storage, read> vecs: array<u32, ${VEC_SIZE * VEC_SIZE}>;

@fragment
fn fs_hist(in: VSOut) -> @location(0) vec4f {
  let bin = min(u32(in.uv.x * ${HIST_BINS}.0), ${HIST_BINS - 1}u);
  let norm = max(f32(maxima[0]), 1.0);
  // log-ish scale so midtone mass doesn't dwarf everything
  let hr = pow(f32(hist[bin]) / norm, 0.4);
  let hg = pow(f32(hist[${HIST_BINS}u + bin]) / norm, 0.4);
  let hb = pow(f32(hist[${HIST_BINS * 2}u + bin]) / norm, 0.4);
  let yUp = 1.0 - in.uv.y;
  var color = vec3f(0.02, 0.02, 0.02);
  if (yUp <= hr) { color.r = 0.85; }
  if (yUp <= hg) { color.g = 0.85; }
  if (yUp <= hb) { color.b = 0.9; }
  return vec4f(color, 1.0);
}

@fragment
fn fs_wave(in: VSOut) -> @location(0) vec4f {
  let col = min(u32(in.uv.x * ${WAVE_COLS}.0), ${WAVE_COLS - 1}u);
  let row = min(u32(in.uv.y * ${WAVE_ROWS}.0), ${WAVE_ROWS - 1}u);
  let norm = max(f32(maxima[1]), 1.0);
  let v = pow(f32(wave[row * ${WAVE_COLS}u + col]) / norm, 0.35);
  // graticule lines at 25/50/75 IRE
  let ire = 1.0 - in.uv.y;
  var grat = 0.0;
  if (abs(ire - 0.25) < 0.003 || abs(ire - 0.5) < 0.003 || abs(ire - 0.75) < 0.003) {
    grat = 0.12;
  }
  return vec4f(vec3f(0.1, 0.9, 0.45) * v + vec3f(grat), 1.0);
}

@fragment
fn fs_vector(in: VSOut) -> @location(0) vec4f {
  let vx = min(u32(in.uv.x * ${VEC_SIZE}.0), ${VEC_SIZE - 1}u);
  let vy = min(u32(in.uv.y * ${VEC_SIZE}.0), ${VEC_SIZE - 1}u);
  let norm = max(f32(maxima[2]), 1.0);
  let v = pow(f32(vecs[vy * ${VEC_SIZE}u + vx]) / norm, 0.3);
  // graticule: center cross + 75%/100% saturation circles + skin-tone line
  let p = (in.uv - vec2f(0.5)) * 2.0;   // -1..1, y down
  let r = length(p);
  var grat = 0.0;
  if (abs(r - 0.75) < 0.008 || abs(r - 1.0) < 0.008) { grat = 0.10; }
  if (abs(p.x) < 0.004 || abs(p.y) < 0.004) { grat = max(grat, 0.08); }
  // skin-tone line: ~33° up-left of +Cr axis (angle ≈ 123° from +x, y-up)
  let ang = atan2(-p.y, p.x);
  if (r > 0.05 && r < 0.9 && abs(ang - 2.147) < 0.015) { grat = max(grat, 0.14); }
  return vec4f(vec3f(0.55, 0.85, 1.0) * v + vec3f(grat), 1.0);
}
`;

export class ScopesRenderer {
  #device: GPUDevice;
  #computePipeline: GPUComputePipeline;
  #histPipeline: GPURenderPipeline;
  #wavePipeline: GPURenderPipeline;
  #vecPipeline: GPURenderPipeline;
  #histBuf: GPUBuffer;
  #waveBuf: GPUBuffer;
  #metaBuf: GPUBuffer;
  #vecBuf: GPUBuffer;
  #drawGroup: GPUBindGroup;
  #histCtx: GPUCanvasContext | null = null;
  #waveCtx: GPUCanvasContext | null = null;
  #vecCtx: GPUCanvasContext | null = null;
  #format: GPUTextureFormat;

  constructor(device: GPUDevice, canvasFormat: GPUTextureFormat) {
    this.#device = device;
    this.#format = canvasFormat;

    this.#histBuf = device.createBuffer({
      size: HIST_BINS * 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#waveBuf = device.createBuffer({
      size: WAVE_COLS * WAVE_ROWS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#metaBuf = device.createBuffer({
      size: 12,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#vecBuf = device.createBuffer({
      size: VEC_SIZE * VEC_SIZE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.#computePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: COMPUTE_WGSL }), entryPoint: "main" },
    });

    // Explicit shared layout: "auto" layouts are per-pipeline (not
    // interchangeable) and drop bindings a shader doesn't reference.
    const drawLayout = device.createBindGroupLayout({
      entries: [0, 1, 2, 3].map((binding) => ({
        binding,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" as const },
      })),
    });
    const drawPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] });

    const drawModule = device.createShaderModule({ code: DRAW_WGSL });
    const makeDraw = (entryPoint: string): GPURenderPipeline =>
      device.createRenderPipeline({
        layout: drawPipelineLayout,
        vertex: { module: drawModule, entryPoint: "vs" },
        fragment: { module: drawModule, entryPoint, targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" },
      });
    this.#histPipeline = makeDraw("fs_hist");
    this.#wavePipeline = makeDraw("fs_wave");
    this.#vecPipeline = makeDraw("fs_vector");

    this.#drawGroup = device.createBindGroup({
      layout: drawLayout,
      entries: [
        { binding: 0, resource: { buffer: this.#histBuf } },
        { binding: 1, resource: { buffer: this.#waveBuf } },
        { binding: 2, resource: { buffer: this.#metaBuf } },
        { binding: 3, resource: { buffer: this.#vecBuf } },
      ],
    });
  }

  attachCanvases(
    hist: HTMLCanvasElement | null,
    wave: HTMLCanvasElement | null,
    vector: HTMLCanvasElement | null = null,
  ): void {
    this.#histCtx = hist ? this.#configure(hist) : null;
    this.#waveCtx = wave ? this.#configure(wave) : null;
    this.#vecCtx = vector ? this.#configure(vector) : null;
  }

  #configure(canvas: HTMLCanvasElement): GPUCanvasContext {
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext;
    ctx.configure({ device: this.#device, format: this.#format, alphaMode: "opaque" });
    return ctx;
  }

  /** Analyze the graded intermediate and redraw the attached scopes. */
  update(intermediate: GPUTexture): void {
    if (!this.#histCtx && !this.#waveCtx && !this.#vecCtx) return;
    const device = this.#device;
    const encoder = device.createCommandEncoder();

    encoder.clearBuffer(this.#histBuf);
    encoder.clearBuffer(this.#waveBuf);
    encoder.clearBuffer(this.#metaBuf);
    encoder.clearBuffer(this.#vecBuf);

    const computeGroup = device.createBindGroup({
      layout: this.#computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: intermediate.createView() },
        { binding: 1, resource: { buffer: this.#histBuf } },
        { binding: 2, resource: { buffer: this.#waveBuf } },
        { binding: 3, resource: { buffer: this.#metaBuf } },
        { binding: 4, resource: { buffer: this.#vecBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.#computePipeline);
    pass.setBindGroup(0, computeGroup);
    pass.dispatchWorkgroups(
      Math.ceil(intermediate.width / SAMPLE_STRIDE / 8),
      Math.ceil(intermediate.height / SAMPLE_STRIDE / 8),
    );
    pass.end();

    if (this.#histCtx) {
      this.#draw(encoder, this.#histPipeline, this.#histCtx);
    }
    if (this.#waveCtx) {
      this.#draw(encoder, this.#wavePipeline, this.#waveCtx);
    }
    if (this.#vecCtx) {
      this.#draw(encoder, this.#vecPipeline, this.#vecCtx);
    }
    device.queue.submit([encoder.finish()]);
  }

  #draw(encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, ctx: GPUCanvasContext): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.#drawGroup);
    pass.draw(3);
    pass.end();
  }
}
