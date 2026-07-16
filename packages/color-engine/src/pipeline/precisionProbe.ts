import { ExternalTextureBlitter } from "./blitRenderer";
import type { GpuContext } from "./gpuContext";

export interface PrecisionReport {
  /** Distinct red-channel levels seen across the ramp scanline. */
  distinctLevels: number;
  /** True when clearly beyond 8-bit (256-level) quantization. */
  tenBitIntact: boolean;
  sampledWidth: number;
  /** What the decoder actually handed us (P010 = 10-bit, NV12 = 8-bit…). */
  videoFrameFormat: string | null;
  /** Which ingest path produced this report. */
  path: "external-texture" | "copy-to-planar";
}

/**
 * 10-bit integrity probe (risk #2 in the plan): render one frame of the
 * horizontal-ramp test clip through the exact ingest path the player uses
 * (importExternalTexture → sample → rgba16float), read a scanline back and
 * count distinct levels. An 8-bit-truncated path collapses the 3840-px ramp
 * to ≤256 levels; the true 10-bit path yields ~1024.
 */
export async function runPrecisionProbe(
  gpu: GpuContext,
  frame: VideoFrame,
): Promise<PrecisionReport> {
  const width = frame.displayWidth;
  const device = gpu.device;

  const target = device.createTexture({
    size: { width, height: 1 },
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  const blitter = new ExternalTextureBlitter(gpu);
  blitter.render(frame, target.createView(), "rgba16float");

  const bytesPerPixel = 8; // rgba16float
  const bytesPerRow = alignTo(width * bytesPerPixel, 256);
  const readback = device.createBuffer({
    size: bytesPerRow,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow },
    { width, height: 1 },
  );
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const half = new Uint16Array(readback.getMappedRange());
  const levels = new Set<number>();
  for (let x = 0; x < width; x++) {
    levels.add(half[x * 4]!); // red channel, raw half bits are fine as keys
  }
  readback.unmap();
  readback.destroy();
  target.destroy();

  return {
    distinctLevels: levels.size,
    tenBitIntact: levels.size > 300,
    sampledWidth: width,
    videoFrameFormat: frame.format,
    path: "external-texture",
  };
}

const alignTo = (n: number, a: number): number => Math.ceil(n / a) * a;
