import { bakeCurveLut } from "../curves/spline";
import type { Grade } from "../grade/schema";
import { defaultGrade } from "../grade/schema";
import type { Cube3dLut } from "../lut/cubeParser";
import { cubeToRgba, identityCube } from "../lut/cubeParser";
import { floatsToHalves } from "../lut/halfFloat";
import { DETAIL_WGSL } from "./detailShader";
import { GRADE_WGSL, PRESENT_WGSL } from "./gradeShader";
import type { GpuContext } from "./gpuContext";
import { PARAMS_BYTE_SIZE, packParams } from "./uniforms";

const CURVE_SIZE = 1024;
const CURVE_ROWS = 6; // luma, r, g, b, hueVsHue, hueVsSat

/**
 * The realtime grade pipeline: one fused ingest+grade pass into an
 * rgba16float intermediate (sized to the render target, not the source —
 * grading at display resolution is the first rung of the degradation
 * ladder), then a present blit. Scopes tap the intermediate (M1 scopes
 * pass reads `intermediateView`).
 */
export class GradeRenderer {
  #gpu: GpuContext;
  #paramsBuf: GPUBuffer;
  #paramsData = new ArrayBuffer(PARAMS_BYTE_SIZE);
  #curvesTex: GPUTexture;
  #gradePipeline: GPURenderPipeline;
  #presentPipeline: GPURenderPipeline;
  #videoSampler: GPUSampler;
  #lutSampler: GPUSampler;
  #presentSampler: GPUSampler;
  #inputLutTex: GPUTexture;
  #creativeLutTex: GPUTexture;
  #intermediate: GPUTexture | null = null;
  #detailTex: GPUTexture | null = null;
  #detailPipeline: GPURenderPipeline;
  #detailParamsBuf: GPUBuffer;
  #detailActive = false;
  #detailValues: [number, number, number] = [0, 0, 0];
  #frameCounter = 0;
  #group0: GPUBindGroup;
  #group2: GPUBindGroup;
  #curvesKey = "";

  constructor(gpu: GpuContext) {
    this.#gpu = gpu;
    const device = gpu.device;

    this.#paramsBuf = device.createBuffer({
      size: PARAMS_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#curvesTex = device.createTexture({
      size: { width: CURVE_SIZE, height: CURVE_ROWS },
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const gradeModule = device.createShaderModule({ code: GRADE_WGSL });
    this.#gradePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: gradeModule, entryPoint: "vs" },
      fragment: { module: gradeModule, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });

    const detailModule = device.createShaderModule({ code: DETAIL_WGSL });
    this.#detailPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: detailModule, entryPoint: "vs" },
      fragment: { module: detailModule, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
    this.#detailParamsBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const presentModule = device.createShaderModule({ code: PRESENT_WGSL });
    this.#presentPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: presentModule, entryPoint: "vs" },
      fragment: {
        module: presentModule,
        entryPoint: "fs",
        targets: [{ format: gpu.preferredFormat }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.#videoSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.#lutSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.#presentSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

    this.#inputLutTex = this.#uploadLut(identityCube(2));
    this.#creativeLutTex = this.#uploadLut(identityCube(2));

    this.#group0 = this.#makeGroup0();
    this.#group2 = this.#makeGroup2();
    this.setGrade(structuredClone(NEUTRAL_GRADE));
  }

  #makeGroup0(): GPUBindGroup {
    return this.#gpu.device.createBindGroup({
      layout: this.#gradePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#paramsBuf } },
        { binding: 1, resource: this.#curvesTex.createView() },
      ],
    });
  }

  #makeGroup2(): GPUBindGroup {
    return this.#gpu.device.createBindGroup({
      layout: this.#gradePipeline.getBindGroupLayout(2),
      entries: [
        { binding: 0, resource: this.#inputLutTex.createView({ dimension: "3d" }) },
        { binding: 1, resource: this.#creativeLutTex.createView({ dimension: "3d" }) },
        { binding: 2, resource: this.#lutSampler },
      ],
    });
  }

  #uploadLut(cube: Cube3dLut): GPUTexture {
    const device = this.#gpu.device;
    const tex = device.createTexture({
      size: { width: cube.size, height: cube.size, depthOrArrayLayers: cube.size },
      dimension: "3d",
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const halves = floatsToHalves(cubeToRgba(cube));
    device.queue.writeTexture(
      { texture: tex },
      halves,
      { bytesPerRow: cube.size * 8, rowsPerImage: cube.size },
      { width: cube.size, height: cube.size, depthOrArrayLayers: cube.size },
    );
    return tex;
  }

  setInputLut(cube: Cube3dLut | null): void {
    this.#inputLutTex.destroy();
    this.#inputLutTex = this.#uploadLut(cube ?? identityCube(2));
    this.#group2 = this.#makeGroup2();
  }

  setCreativeLut(cube: Cube3dLut | null): void {
    this.#creativeLutTex.destroy();
    this.#creativeLutTex = this.#uploadLut(cube ?? identityCube(2));
    this.#group2 = this.#makeGroup2();
  }

  /** Cheap per-drag update: rewrites uniforms; rebakes curves only when the
   * curve control points actually changed. */
  setGrade(grade: Grade): void {
    packParams(grade, this.#paramsData);
    this.#gpu.device.queue.writeBuffer(this.#paramsBuf, 0, this.#paramsData);

    const d = grade.ops.detail;
    this.#detailValues = [d.sharpen, d.denoise, d.grain];
    this.#detailActive = d.sharpen !== 0 || d.denoise !== 0 || d.grain !== 0;

    const key = JSON.stringify(grade.ops.curves);
    if (key !== this.#curvesKey) {
      this.#curvesKey = key;
      const rows = new Float32Array(CURVE_SIZE * CURVE_ROWS);
      const c = grade.ops.curves;
      rows.set(bakeCurveLut(c.luma, CURVE_SIZE), 0);
      rows.set(bakeCurveLut(c.red, CURVE_SIZE), CURVE_SIZE);
      rows.set(bakeCurveLut(c.green, CURVE_SIZE), CURVE_SIZE * 2);
      rows.set(bakeCurveLut(c.blue, CURVE_SIZE), CURVE_SIZE * 3);
      rows.set(bakeCurveLut(c.hueVsHue, CURVE_SIZE, "zero"), CURVE_SIZE * 4);
      rows.set(bakeCurveLut(c.hueVsSat, CURVE_SIZE, "zero"), CURVE_SIZE * 5);
      this.#gpu.device.queue.writeTexture(
        { texture: this.#curvesTex },
        rows,
        { bytesPerRow: CURVE_SIZE * 4, rowsPerImage: CURVE_ROWS },
        { width: CURVE_SIZE, height: CURVE_ROWS },
      );
    }
  }

  #ensureIntermediate(width: number, height: number): GPUTexture {
    if (this.#intermediate && this.#intermediate.width === width && this.#intermediate.height === height) {
      return this.#intermediate;
    }
    this.#intermediate?.destroy();
    this.#intermediate = this.#gpu.device.createTexture({
      size: { width, height },
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    return this.#intermediate;
  }

  /** The final pre-display texture of the most recent frame (scopes input) —
   * post-detail when the detail pass ran, the grade output otherwise. */
  get intermediateTexture(): GPUTexture | null {
    return this.#detailActive && this.#detailTex ? this.#detailTex : this.#intermediate;
  }

  #ensureDetailTex(width: number, height: number): GPUTexture {
    if (this.#detailTex && this.#detailTex.width === width && this.#detailTex.height === height) {
      return this.#detailTex;
    }
    this.#detailTex?.destroy();
    this.#detailTex = this.#gpu.device.createTexture({
      size: { width, height },
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return this.#detailTex;
  }

  /** Render one video frame through grade (+detail) into the canvas. */
  render(frame: VideoFrame, canvasCtx: GPUCanvasContext): void {
    const device = this.#gpu.device;
    const target = canvasCtx.getCurrentTexture();
    const inter = this.#ensureIntermediate(target.width, target.height);

    const external = device.importExternalTexture({ source: frame });
    const group1 = device.createBindGroup({
      layout: this.#gradePipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: external },
        { binding: 1, resource: this.#videoSampler },
      ],
    });

    const encoder = device.createCommandEncoder();

    const gradePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: inter.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    gradePass.setPipeline(this.#gradePipeline);
    gradePass.setBindGroup(0, this.#group0);
    gradePass.setBindGroup(1, group1);
    gradePass.setBindGroup(2, this.#group2);
    gradePass.draw(3);
    gradePass.end();

    // P2: spatial detail (sharpen/denoise/grain), skipped while neutral
    let presentSrc = inter;
    if (this.#detailActive) {
      const detailTex = this.#ensureDetailTex(target.width, target.height);
      this.#frameCounter++;
      device.queue.writeBuffer(
        this.#detailParamsBuf,
        0,
        new Float32Array([...this.#detailValues, this.#frameCounter % 1024]),
      );
      const detailGroup = device.createBindGroup({
        layout: this.#detailPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: inter.createView() },
          { binding: 1, resource: this.#presentSampler },
          { binding: 2, resource: { buffer: this.#detailParamsBuf } },
        ],
      });
      const detailPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: detailTex.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      detailPass.setPipeline(this.#detailPipeline);
      detailPass.setBindGroup(0, detailGroup);
      detailPass.draw(3);
      detailPass.end();
      presentSrc = detailTex;
    }

    const presentGroup = device.createBindGroup({
      layout: this.#presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: presentSrc.createView() },
        { binding: 1, resource: this.#presentSampler },
      ],
    });
    const presentPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    presentPass.setPipeline(this.#presentPipeline);
    presentPass.setBindGroup(0, presentGroup);
    presentPass.draw(3);
    presentPass.end();

    device.queue.submit([encoder.finish()]);
  }
}

const NEUTRAL_GRADE = defaultGrade();
