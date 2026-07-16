/// <reference path="./mp4box.d.ts" />
import type { MP4File, MP4Info, MP4Sample } from "mp4box";
import { DataStream, createFile } from "mp4box";

export interface VideoTrackInfo {
  id: number;
  /** RFC 6381 codec string as found in the container, e.g. "hvc1.2.4.L153.B0" */
  codec: string;
  width: number;
  height: number;
  durationUs: number;
  nbSamples: number;
  /** Decoder `description` (hvcC/avcC payload) — required for hvc1/avc1. */
  description: Uint8Array | null;
}

export interface DemuxedChunk {
  chunk: EncodedVideoChunk;
  /** 1-based sample number, for sample-table addressing later (seek). */
  sampleNumber: number;
}

/**
 * MP4 demuxer wrapping mp4box.js.
 *
 * M0 scope: whole-file in memory (test clips), single video track, full
 * extraction pass. Streaming append + sample-table seek land in M1 — the
 * public surface (track info + chunk stream) is already shaped for that.
 */
export class Mp4Demuxer {
  #file: MP4File;
  #track: VideoTrackInfo;

  private constructor(file: MP4File, track: VideoTrackInfo) {
    this.#file = file;
    this.#track = track;
  }

  get videoTrack(): VideoTrackInfo {
    return this.#track;
  }

  static async open(source: Blob | ArrayBuffer): Promise<Mp4Demuxer> {
    const buffer = source instanceof Blob ? await source.arrayBuffer() : source;
    const file = createFile();

    const info = await new Promise<MP4Info>((resolve, reject) => {
      file.onError = (e) => reject(new Error(`mp4box: ${e}`));
      file.onReady = resolve;
      const b = buffer as ArrayBuffer & { fileStart?: number };
      b.fileStart = 0;
      file.appendBuffer(b);
      file.flush();
    });

    const v = info.videoTracks[0];
    if (!v) throw new Error("No video track in file");

    const track: VideoTrackInfo = {
      id: v.id,
      codec: v.codec,
      width: v.video?.width ?? 0,
      height: v.video?.height ?? 0,
      durationUs: (v.movie_duration / v.movie_timescale) * 1e6,
      nbSamples: v.nb_samples,
      description: extractDescription(file, v.id),
    };
    return new Mp4Demuxer(file, track);
  }

  /** VideoDecoder configuration for this file's video track. */
  decoderConfig(): VideoDecoderConfig {
    const cfg: VideoDecoderConfig = {
      codec: this.#track.codec,
      codedWidth: this.#track.width,
      codedHeight: this.#track.height,
      hardwareAcceleration: "prefer-hardware",
    };
    if (this.#track.description) cfg.description = this.#track.description;
    return cfg;
  }

  /**
   * Extract every video sample as an EncodedVideoChunk.
   * Resolves once the whole track has been extracted.
   */
  extractAll(onChunk: (c: DemuxedChunk) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let seen = 0;
      this.#file.onError = (e) => reject(new Error(`mp4box: ${e}`));
      this.#file.onSamples = (_trackId, _user, samples: MP4Sample[]) => {
        for (const s of samples) {
          onChunk({
            sampleNumber: s.number,
            chunk: new EncodedVideoChunk({
              type: s.is_sync ? "key" : "delta",
              timestamp: (1e6 * s.cts) / s.timescale,
              duration: (1e6 * s.duration) / s.timescale,
              data: s.data as BufferSource,
            }),
          });
          seen++;
        }
        this.#file.releaseUsedSamples(this.#track.id, seen);
        if (seen >= this.#track.nbSamples) {
          this.#file.stop();
          resolve();
        }
      };
      this.#file.setExtractionOptions(this.#track.id, null, { nbSamples: 100 });
      this.#file.start();
    });
  }
}

/** Serialize the hvcC/avcC/vpcC/av1C sample-entry box into the raw
 * `description` bytes WebCodecs expects (box payload without 8-byte header). */
function extractDescription(file: MP4File, trackId: number): Uint8Array | null {
  const trak = file.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.hvcC ?? entry.avcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  return null;
}
