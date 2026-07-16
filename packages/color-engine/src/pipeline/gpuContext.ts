/** Shared WebGPU device holder. One per renderer thread. */
export class GpuContext {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly preferredFormat: GPUTextureFormat;

  private constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    this.preferredFormat = navigator.gpu.getPreferredCanvasFormat();
  }

  static async create(): Promise<GpuContext> {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this environment");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter found");
    const device = await adapter.requestDevice();
    return new GpuContext(adapter, device);
  }

  configureCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): GPUCanvasContext {
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) throw new Error("Failed to get webgpu canvas context");
    ctx.configure({
      device: this.device,
      format: this.preferredFormat,
      alphaMode: "opaque",
    });
    return ctx;
  }
}
