import { ExternalTextureBlitter, GpuContext, runPrecisionProbe } from "@osmo/color-engine";
import type { PrecisionReport } from "@osmo/color-engine";
import { Mp4Demuxer, VideoDecodeSession } from "@osmo/media-pipeline";
import type { DemuxedChunk } from "@osmo/media-pipeline";

export interface PlayerStats {
  presentedFps: number;
  decodeQueue: number;
  frameQueue: number;
  dropped: number;
  presented: number;
  codec: string;
  resolution: string;
  state: "idle" | "loading" | "playing" | "ended" | "error";
  error?: string;
}

const MAX_DECODE_QUEUE = 6;
const MAX_FRAME_QUEUE = 4;

/**
 * M0 spike playback controller: single-pass demux into memory, then a
 * backpressured decode→present loop. Not the final architecture (workers
 * arrive in M1) — but the demux/decode/render seams are already the real
 * package APIs.
 */
export class SpikePlayer {
  #gpu: GpuContext | null = null;
  #blitter: ExternalTextureBlitter | null = null;
  #canvasCtx: GPUCanvasContext | null = null;
  #chunks: DemuxedChunk[] = [];
  #config: VideoDecoderConfig | null = null;
  #session: VideoDecodeSession | null = null;
  #frameQueue: VideoFrame[] = [];
  #raf = 0;
  #feedIndex = 0;
  #baseTimeMs = 0;
  #presented = 0;
  #dropped = 0;
  #fpsWindow: number[] = [];
  #onStats: (s: PlayerStats) => void;
  #stats: PlayerStats = {
    presentedFps: 0,
    decodeQueue: 0,
    frameQueue: 0,
    dropped: 0,
    presented: 0,
    codec: "",
    resolution: "",
    state: "idle",
  };

  constructor(onStats: (s: PlayerStats) => void) {
    this.#onStats = onStats;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.#gpu = await GpuContext.create();
    this.#blitter = new ExternalTextureBlitter(this.#gpu);
    this.#canvasCtx = this.#gpu.configureCanvas(canvas);
  }

  async load(file: Blob): Promise<void> {
    this.stop();
    this.#patch({ state: "loading" });
    const demuxer = await Mp4Demuxer.open(file);
    const track = demuxer.videoTrack;
    this.#config = demuxer.decoderConfig();

    const supported = await VideoDecodeSession.isSupported(this.#config);
    if (!supported) {
      this.#patch({ state: "error", error: `解码器不支持: ${track.codec}` });
      throw new Error(`Unsupported codec: ${track.codec}`);
    }

    this.#chunks = [];
    await demuxer.extractAll((c) => this.#chunks.push(c));
    this.#patch({
      codec: track.codec,
      resolution: `${track.width}×${track.height}`,
      state: "idle",
    });
  }

  play(): void {
    if (!this.#config || this.#chunks.length === 0) return;
    this.stopPlayback();
    this.#session = new VideoDecodeSession(
      this.#config,
      (frame) => this.#frameQueue.push(frame),
      (e) => this.#patch({ state: "error", error: e.message }),
    );
    this.#feedIndex = 0;
    this.#presented = 0;
    this.#dropped = 0;
    this.#fpsWindow = [];
    this.#baseTimeMs = -1;
    this.#patch({ state: "playing", presented: 0, dropped: 0 });
    this.#tick();
  }

  #tick = (): void => {
    this.#raf = requestAnimationFrame(this.#tick);
    this.#pumpDecoder();
    this.#presentDue();
    this.#publishStats();
  };

  #pumpDecoder(): void {
    const session = this.#session;
    if (!session || session.state !== "configured") return;
    while (
      this.#feedIndex < this.#chunks.length &&
      session.queueSize < MAX_DECODE_QUEUE &&
      this.#frameQueue.length < MAX_FRAME_QUEUE
    ) {
      session.decode(this.#chunks[this.#feedIndex]!.chunk);
      this.#feedIndex++;
    }
    if (this.#feedIndex >= this.#chunks.length) {
      void session.flush();
    }
  }

  #presentDue(): void {
    if (this.#frameQueue.length === 0) {
      if (
        this.#feedIndex >= this.#chunks.length &&
        this.#session &&
        this.#session.queueSize === 0 &&
        this.#stats.state === "playing" &&
        this.#presented > 0
      ) {
        this.#patch({ state: "ended" });
        this.stopPlayback();
      }
      return;
    }
    const now = performance.now();
    if (this.#baseTimeMs < 0) {
      this.#baseTimeMs = now - this.#frameQueue[0]!.timestamp / 1000;
    }
    const elapsedMs = now - this.#baseTimeMs;

    // Find the newest due frame; everything older than it is dropped.
    let dueIndex = -1;
    for (let i = 0; i < this.#frameQueue.length; i++) {
      if (this.#frameQueue[i]!.timestamp / 1000 <= elapsedMs) dueIndex = i;
      else break;
    }
    if (dueIndex < 0) return;

    for (let i = 0; i < dueIndex; i++) {
      this.#frameQueue[i]!.close();
      this.#dropped++;
    }
    const frame = this.#frameQueue[dueIndex]!;
    this.#frameQueue.splice(0, dueIndex + 1);

    if (this.#blitter && this.#canvasCtx) {
      this.#blitter.renderToCanvas(frame, this.#canvasCtx);
    }
    frame.close();
    this.#presented++;
    this.#fpsWindow.push(now);
  }

  #publishStats(): void {
    const cutoff = performance.now() - 1000;
    while (this.#fpsWindow.length > 0 && this.#fpsWindow[0]! < cutoff) this.#fpsWindow.shift();
    this.#patch({
      presentedFps: this.#fpsWindow.length,
      decodeQueue: this.#session?.queueSize ?? 0,
      frameQueue: this.#frameQueue.length,
      presented: this.#presented,
      dropped: this.#dropped,
    });
  }

  /** Decode the first frame and run the 10-bit integrity probe on it. */
  async probePrecision(file: Blob): Promise<PrecisionReport> {
    if (!this.#gpu) throw new Error("init() first");
    const demuxer = await Mp4Demuxer.open(file);
    const config = demuxer.decoderConfig();
    const frame = await new Promise<VideoFrame>((resolve, reject) => {
      const session = new VideoDecodeSession(
        config,
        (f) => {
          resolve(f);
          session.close();
        },
        reject,
      );
      demuxer
        .extractAll((c) => {
          if (session.state === "configured") session.decode(c.chunk);
        })
        .then(() => session.flush())
        .catch(reject);
    });
    try {
      return await runPrecisionProbe(this.#gpu, frame);
    } finally {
      frame.close();
    }
  }

  stopPlayback(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#session?.close();
    this.#session = null;
    for (const f of this.#frameQueue) f.close();
    this.#frameQueue = [];
  }

  stop(): void {
    this.stopPlayback();
    this.#chunks = [];
    this.#config = null;
  }

  #patch(p: Partial<PlayerStats>): void {
    this.#stats = { ...this.#stats, ...p };
    this.#onStats(this.#stats);
  }
}
