import { VideoDecodeSession } from "../decode/decodeSession";
import type { StreamingDemuxer } from "../demux/streamingDemuxer";
import type { FrameSink } from "./clipPlayer";

/**
 * Scrub preview on the LRF proxy: while the user drags the seek bar, decode
 * the nearest frame from the 720p proxy (keyframe→target, cheap at proxy
 * resolution) and render it through the same graded sink. Requests coalesce
 * — only the latest drag position is honored; stale ones are skipped.
 */
export class ScrubPreview {
  #demuxer: StreamingDemuxer;
  #sink: FrameSink;
  #busy = false;
  #pending: number | null = null;
  #disposed = false;
  /** One decoder session reused across scrub steps (flush between GOPs) —
   * creating a hardware decoder per step exhausts VideoToolbox sessions. */
  #session: VideoDecodeSession | null = null;
  #frames: VideoFrame[] = [];

  constructor(demuxer: StreamingDemuxer, sink: FrameSink) {
    this.#demuxer = demuxer;
    this.#sink = sink;
  }

  #ensureSession(): VideoDecodeSession {
    if (this.#session && this.#session.state === "configured") return this.#session;
    this.#session?.close();
    this.#session = new VideoDecodeSession(
      this.#demuxer.decoderConfig(),
      (f) => this.#frames.push(f),
      () => {},
    );
    return this.#session;
  }

  request(targetUs: number): void {
    this.#pending = targetUs;
    if (!this.#busy) void this.#drain();
  }

  async #drain(): Promise<void> {
    this.#busy = true;
    while (this.#pending !== null && !this.#disposed) {
      const target = this.#pending;
      this.#pending = null;
      try {
        await this.#decodeAt(target);
      } catch {
        // scrub is best-effort; the release-seek renders the exact frame
      }
    }
    this.#busy = false;
  }

  async #decodeAt(targetUs: number): Promise<void> {
    const d = this.#demuxer;
    const start = d.keyframeIndexBefore(targetUs);
    let end = start;
    while (
      end + 1 < d.samples.length &&
      d.samples[end]!.ctsUs + d.samples[end]!.durationUs < targetUs
    ) {
      end++;
    }

    this.#frames = [];
    const session = this.#ensureSession();
    for (let i = start; i <= end; i++) {
      if (session.state !== "configured") break;
      session.decode(await d.chunkAt(i));
    }
    await session.flush().catch(() => {});
    const frames = this.#frames;
    this.#frames = [];

    let best: VideoFrame | null = null;
    for (const f of frames) {
      const better =
        best === null ||
        (f.timestamp <= targetUs && f.timestamp > best.timestamp) ||
        (best.timestamp > targetUs && f.timestamp < best.timestamp);
      if (better) {
        best?.close();
        best = f;
      } else {
        f.close();
      }
    }
    if (best) {
      if (!this.#disposed) this.#sink.render(best);
      best.close();
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending = null;
    this.#session?.close();
    this.#session = null;
    for (const f of this.#frames) f.close();
    this.#frames = [];
  }
}
