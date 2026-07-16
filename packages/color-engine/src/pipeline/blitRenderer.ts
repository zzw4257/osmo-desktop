import type { GpuContext } from "./gpuContext";

/**
 * P0-embryo: renders a decoded VideoFrame to a render target through
 * `importExternalTexture` (zero-copy, preserves 10-bit YUV precision — the
 * platform does YUV→RGB inside `textureSampleBaseClampToEdge`).
 *
 * The full grade pipeline (P1/P2) will slot between this ingest sampling and
 * the target write; for M0 it is a pass-through blit.
 *
 * External texture lifetime rule: the GPUExternalTexture returned by
 * importExternalTexture expires at the end of the current task — import and
 * submit MUST happen synchronously in the same callback, which `render()`
 * guarantees by design.
 */
export class ExternalTextureBlitter {
  #gpu: GpuContext;
  #sampler: GPUSampler;
  #pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  #module: GPUShaderModule;

  constructor(gpu: GpuContext) {
    this.#gpu = gpu;
    this.#sampler = gpu.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.#module = gpu.device.createShaderModule({ code: BLIT_WGSL });
  }

  #pipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    let p = this.#pipelines.get(format);
    if (!p) {
      p = this.#gpu.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: this.#module, entryPoint: "vs" },
        fragment: { module: this.#module, entryPoint: "fs", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      this.#pipelines.set(format, p);
    }
    return p;
  }

  /** Blit `frame` to `view`. Does NOT close the frame — caller owns it. */
  render(frame: VideoFrame, view: GPUTextureView, format: GPUTextureFormat): void {
    const device = this.#gpu.device;
    const external = device.importExternalTexture({ source: frame });
    const pipeline = this.#pipelineFor(format);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#sampler },
        { binding: 1, resource: external },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  renderToCanvas(frame: VideoFrame, canvasContext: GPUCanvasContext): void {
    this.render(
      frame,
      canvasContext.getCurrentTexture().createView(),
      this.#gpu.preferredFormat,
    );
  }
}

const BLIT_WGSL = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  // Fullscreen triangle
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  let p = positions[vi];
  var out: VSOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
  return out;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_external;

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(tex, samp, in.uv);
}
`;
