import { VideoDecodeSession } from "../decode/decodeSession";
import type { DemuxedChunk, Mp4Demuxer } from "../demux/mp4Demuxer";

/** Where decoded frames go. The player never knows what a "grade" is. */
export interface FrameSink {
  render(frame: VideoFrame): void;
}

export type PlaybackState = "empty" | "paused" | "playing" | "ended";

export interface ClipPlayerStats {
  state: PlaybackState;
  positionUs: number;
  durationUs: number;
  presentedFps: number;
  dropped: number;
  decodeQueue: number;
}

const MAX_DECODE_QUEUE = 6;
const MAX_FRAME_QUEUE = 4;

/**
 * M1 clip player: all chunks resident in memory (streaming demux lands in
 * M2), keyframe-indexed seek, pause/step, rAF-paced presentation.
 */
export class ClipPlayer {
  #sink: FrameSink;
  #onStats: (s: ClipPlayerStats) => void;
  #chunks: DemuxedChunk[] = [];
  #keyframeIndices: number[] = [];
  #config: VideoDecoderConfig | null = null;
  #durationUs = 0;

  #session: VideoDecodeSession | null = null;
  #frameQueue: VideoFrame[] = [];
  #feedIndex = 0;
  #raf = 0;
  #state: PlaybackState = "empty";
  #baseTimeMs = -1;
  #positionUs = 0;
  #dropped = 0;
  #fpsWindow: number[] = [];
  /** While seeking: drop everything before this timestamp, present it, pause. */
  #seekTargetUs: number | null = null;
  #resumeAfterSeek = false;
  #stepPending = false;

  constructor(sink: FrameSink, onStats: (s: ClipPlayerStats) => void) {
    this.#sink = sink;
    this.#onStats = onStats;
  }

  async load(demuxer: Mp4Demuxer): Promise<void> {
    this.unload();
    this.#config = demuxer.decoderConfig();
    this.#durationUs = demuxer.videoTrack.durationUs;
    const chunks: DemuxedChunk[] = [];
    await demuxer.extractAll((c) => chunks.push(c));
    chunks.sort((a, b) => a.chunk.timestamp - b.chunk.timestamp);
    this.#chunks = chunks;
    this.#keyframeIndices = [];
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i]!.chunk.type === "key") this.#keyframeIndices.push(i);
    }
    this.#state = "paused";
    // Show the first frame immediately.
    this.seek(0);
  }

  get state(): PlaybackState {
    return this.#state;
  }

  play(): void {
    if (this.#state === "empty" || this.#state === "playing") return;
    if (this.#state === "ended" || this.#session === null) {
      this.#restartFrom(this.#state === "ended" ? 0 : this.#positionUs);
    }
    this.#state = "playing";
    this.#baseTimeMs = -1; // re-anchor clock at current position
    this.#loop();
  }

  pause(): void {
    if (this.#state !== "playing") return;
    this.#state = "paused";
  }

  /** Present the next frame while paused. */
  stepForward(): void {
    if (this.#state !== "paused") return;
    this.#stepPending = true;
    this.#loop();
  }

  seek(targetUs: number): void {
    if (this.#config === null || this.#chunks.length === 0) return;
    const clamped = Math.max(0, Math.min(targetUs, this.#durationUs));
    this.#resumeAfterSeek = this.#state === "playing";
    this.#seekTargetUs = clamped;
    this.#restartFrom(clamped);
    this.#loop();
  }

  #restartFrom(targetUs: number): void {
    this.#teardownSession();
    // Nearest keyframe at or before target
    let keyIdx = 0;
    for (const i of this.#keyframeIndices) {
      if (this.#chunks[i]!.chunk.timestamp <= targetUs) keyIdx = i;
      else break;
    }
    this.#feedIndex = keyIdx;
    this.#session = new VideoDecodeSession(
      this.#config!,
      (frame) => this.#frameQueue.push(frame),
      () => this.#teardownSession(),
    );
  }

  #loop = (): void => {
    cancelAnimationFrame(this.#raf);
    this.#pump();
    this.#present();
    this.#publish();
    const active =
      this.#state === "playing" || this.#seekTargetUs !== null || this.#stepPending;
    if (active) this.#raf = requestAnimationFrame(this.#loop);
  };

  #pump(): void {
    const s = this.#session;
    if (!s || s.state !== "configured") return;
    while (
      this.#feedIndex < this.#chunks.length &&
      s.queueSize < MAX_DECODE_QUEUE &&
      this.#frameQueue.length < MAX_FRAME_QUEUE
    ) {
      s.decode(this.#chunks[this.#feedIndex]!.chunk);
      this.#feedIndex++;
    }
    if (this.#feedIndex >= this.#chunks.length) void s.flush();
  }

  #present(): void {
    // Seek: discard until target frame, render it, pause there.
    if (this.#seekTargetUs !== null) {
      while (this.#frameQueue.length > 0) {
        const f = this.#frameQueue.shift()!;
        const isTarget =
          f.timestamp + (f.duration ?? 0) >= this.#seekTargetUs ||
          this.#feedIndex >= this.#chunks.length;
        if (isTarget) {
          this.#positionUs = f.timestamp;
          this.#sink.render(f);
          f.close();
          this.#seekTargetUs = null;
          this.#state = this.#resumeAfterSeek ? "playing" : "paused";
          this.#baseTimeMs = -1;
          return;
        }
        f.close();
      }
      return;
    }

    if (this.#stepPending) {
      const f = this.#frameQueue.shift();
      if (f) {
        this.#positionUs = f.timestamp;
        this.#sink.render(f);
        f.close();
        this.#stepPending = false;
      }
      return;
    }

    if (this.#state !== "playing") return;
    if (this.#frameQueue.length === 0) {
      if (this.#feedIndex >= this.#chunks.length && (this.#session?.queueSize ?? 0) === 0) {
        this.#state = "ended";
        this.#teardownSession();
      }
      return;
    }

    const now = performance.now();
    if (this.#baseTimeMs < 0) {
      this.#baseTimeMs = now - this.#frameQueue[0]!.timestamp / 1000;
    }
    const elapsedMs = now - this.#baseTimeMs;
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
    this.#positionUs = frame.timestamp;
    this.#sink.render(frame);
    frame.close();
    this.#fpsWindow.push(now);
  }

  #publish(): void {
    const cutoff = performance.now() - 1000;
    while (this.#fpsWindow.length > 0 && this.#fpsWindow[0]! < cutoff) this.#fpsWindow.shift();
    this.#onStats({
      state: this.#state,
      positionUs: this.#positionUs,
      durationUs: this.#durationUs,
      presentedFps: this.#fpsWindow.length,
      dropped: this.#dropped,
      decodeQueue: this.#session?.queueSize ?? 0,
    });
  }

  #teardownSession(): void {
    this.#session?.close();
    this.#session = null;
    for (const f of this.#frameQueue) f.close();
    this.#frameQueue = [];
  }

  unload(): void {
    cancelAnimationFrame(this.#raf);
    this.#teardownSession();
    this.#chunks = [];
    this.#keyframeIndices = [];
    this.#config = null;
    this.#state = "empty";
    this.#positionUs = 0;
    this.#dropped = 0;
  }
}
