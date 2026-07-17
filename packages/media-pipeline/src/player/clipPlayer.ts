import { VideoDecodeSession } from "../decode/decodeSession";
import type { StreamingDemuxer } from "../demux/streamingDemuxer";

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
const MAX_INFLIGHT_READS = 2;

/**
 * Streaming clip player: samples are fetched on demand from the demuxer
 * (blob.slice reads), so multi-GB files play without residing in memory.
 * Keyframe-indexed seek, pause/step, rAF-paced presentation.
 */
export class ClipPlayer {
  #sink: FrameSink;
  #onStats: (s: ClipPlayerStats) => void;
  #demuxer: StreamingDemuxer | null = null;
  #generation = 0;

  #session: VideoDecodeSession | null = null;
  #frameQueue: VideoFrame[] = [];
  #feedIndex = 0;
  #inflight = 0;
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

  async load(demuxer: StreamingDemuxer): Promise<void> {
    this.unload();
    this.#demuxer = demuxer;
    this.#state = "paused";
    this.seek(0); // show the first frame immediately
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
    const demuxer = this.#demuxer;
    if (!demuxer) return;
    const clamped = Math.max(0, Math.min(targetUs, demuxer.videoTrack.durationUs));
    this.#resumeAfterSeek = this.#state === "playing";
    this.#seekTargetUs = clamped;
    this.#restartFrom(clamped);
    this.#loop();
  }

  #restartFrom(targetUs: number): void {
    const demuxer = this.#demuxer!;
    this.#teardownSession();
    this.#feedIndex = demuxer.keyframeIndexBefore(targetUs);
    this.#session = new VideoDecodeSession(
      demuxer.decoderConfig(),
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

  /** Backpressured async feed: at most MAX_INFLIGHT_READS sample reads and
   * MAX_DECODE_QUEUE undecoded chunks outstanding. */
  #pump(): void {
    const s = this.#session;
    const demuxer = this.#demuxer;
    if (!s || !demuxer || s.state !== "configured") return;
    const generation = this.#generation;
    while (
      this.#feedIndex < demuxer.samples.length &&
      this.#inflight < MAX_INFLIGHT_READS &&
      s.queueSize + this.#inflight < MAX_DECODE_QUEUE &&
      this.#frameQueue.length < MAX_FRAME_QUEUE
    ) {
      const index = this.#feedIndex++;
      this.#inflight++;
      demuxer
        .chunkAt(index)
        .then((chunk) => {
          if (generation !== this.#generation) return; // seek/unload raced
          this.#inflight--;
          if (this.#session?.state === "configured") {
            this.#session.decode(chunk);
            if (index === demuxer.samples.length - 1) void this.#session.flush();
          }
          // Keep the pipeline full even between rAF ticks
          this.#pump();
        })
        .catch(() => {
          if (generation === this.#generation) this.#inflight--;
        });
    }
  }

  #present(): void {
    const demuxer = this.#demuxer;
    if (!demuxer) return;

    // Seek: discard until target frame, render it, pause there.
    if (this.#seekTargetUs !== null) {
      while (this.#frameQueue.length > 0) {
        const f = this.#frameQueue.shift()!;
        const isTarget =
          f.timestamp + (f.duration ?? 0) >= this.#seekTargetUs ||
          this.#feedIndex >= demuxer.samples.length;
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
      if (
        this.#feedIndex >= demuxer.samples.length &&
        this.#inflight === 0 &&
        (this.#session?.queueSize ?? 0) === 0
      ) {
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
      durationUs: this.#demuxer?.videoTrack.durationUs ?? 0,
      presentedFps: this.#fpsWindow.length,
      dropped: this.#dropped,
      decodeQueue: this.#session?.queueSize ?? 0,
    });
  }

  #teardownSession(): void {
    this.#generation++;
    this.#inflight = 0;
    this.#session?.close();
    this.#session = null;
    for (const f of this.#frameQueue) f.close();
    this.#frameQueue = [];
  }

  unload(): void {
    cancelAnimationFrame(this.#raf);
    this.#teardownSession();
    this.#demuxer = null;
    this.#state = "empty";
    this.#positionUs = 0;
    this.#dropped = 0;
  }
}
