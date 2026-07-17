/// <reference path="./mp4box.d.ts" />
import type { MP4File, MP4Info } from "mp4box";
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

export interface SampleRef {
  /** Absolute byte offset in the file. */
  offset: number;
  size: number;
  ctsUs: number;
  durationUs: number;
  isSync: boolean;
}

export interface AudioTrackInfo {
  id: number;
  codec: string;
  sampleRate: number;
  channelCount: number;
  /** AudioSpecificConfig (AAC) when extractable — remux needs it. */
  description: Uint8Array | null;
}

const PARSE_CHUNK = 2 * 1024 * 1024;

/**
 * Streaming MP4 demuxer: parses only the container structure (moov) by
 * slicing the blob — appendBuffer's returned next-parse-position lets us
 * jump over mdat, so a multi-GB file costs a few MB of reads even with
 * moov at the end (DJI in-camera files). Sample payloads are then read
 * on demand per sample via blob.slice — nothing is held resident.
 */
export class StreamingDemuxer {
  #blob: Blob;
  readonly videoTrack: VideoTrackInfo;
  readonly samples: SampleRef[];
  readonly audioTrack: AudioTrackInfo | null;
  readonly audioSamples: SampleRef[];

  private constructor(
    blob: Blob,
    track: VideoTrackInfo,
    samples: SampleRef[],
    audioTrack: AudioTrackInfo | null,
    audioSamples: SampleRef[],
  ) {
    this.#blob = blob;
    this.videoTrack = track;
    this.samples = samples;
    this.audioTrack = audioTrack;
    this.audioSamples = audioSamples;
  }

  static async open(blob: Blob): Promise<StreamingDemuxer> {
    const file = createFile();
    let info: MP4Info | null = null;
    let error: string | null = null;
    file.onError = (e) => (error = String(e));
    file.onReady = (i) => (info = i);

    let offset = 0;
    while (info === null && error === null && offset < blob.size) {
      const end = Math.min(offset + PARSE_CHUNK, blob.size);
      const buf = (await blob.slice(offset, end).arrayBuffer()) as ArrayBuffer & {
        fileStart?: number;
      };
      buf.fileStart = offset;
      const next = file.appendBuffer(buf);
      // mp4box asks for the next position it needs; jumping honors that and
      // skips mdat payload bytes entirely.
      offset = typeof next === "number" && next > end ? next : end;
    }
    if (error) throw new Error(`mp4box: ${error}`);
    if (info === null) throw new Error("未能解析 MP4 结构（缺少 moov？）");

    const v = (info as MP4Info).videoTracks[0];
    if (!v) throw new Error("文件中没有视频轨");

    const trak = file.getTrackById(v.id);
    const rawSamples = trak.samples ?? [];
    if (rawSamples.length === 0) throw new Error("样本表为空");
    const samples: SampleRef[] = rawSamples.map((s) => ({
      offset: s.offset,
      size: s.size,
      ctsUs: (1e6 * s.cts) / s.timescale,
      durationUs: (1e6 * s.duration) / s.timescale,
      isSync: s.is_sync,
    }));

    const track: VideoTrackInfo = {
      id: v.id,
      codec: v.codec,
      width: v.video?.width ?? 0,
      height: v.video?.height ?? 0,
      durationUs: (v.movie_duration / v.movie_timescale) * 1e6,
      nbSamples: v.nb_samples,
      description: extractDescription(file, v.id),
    };

    // Audio (optional): index samples for lossless remux on export.
    let audioTrack: AudioTrackInfo | null = null;
    let audioSamples: SampleRef[] = [];
    const a = (info as MP4Info).audioTracks?.[0];
    if (a) {
      const audioRaw = file.getTrackById(a.id).samples ?? [];
      audioSamples = audioRaw.map((s) => ({
        offset: s.offset,
        size: s.size,
        ctsUs: (1e6 * s.cts) / s.timescale,
        durationUs: (1e6 * s.duration) / s.timescale,
        isSync: s.is_sync,
      }));
      audioTrack = {
        id: a.id,
        codec: a.codec,
        sampleRate: a.audio?.sample_rate ?? 48000,
        channelCount: a.audio?.channel_count ?? 2,
        description: extractAudioSpecificConfig(file, a.id),
      };
    }

    file.stop();
    return new StreamingDemuxer(blob, track, samples, audioTrack, audioSamples);
  }

  /** Read one audio sample's payload. */
  async audioChunkAt(index: number): Promise<ArrayBuffer> {
    const s = this.audioSamples[index];
    if (!s) throw new Error(`音频样本越界: ${index}`);
    return this.#blob.slice(s.offset, s.offset + s.size).arrayBuffer();
  }

  decoderConfig(): VideoDecoderConfig {
    const cfg: VideoDecoderConfig = {
      codec: this.videoTrack.codec,
      codedWidth: this.videoTrack.width,
      codedHeight: this.videoTrack.height,
      hardwareAcceleration: "prefer-hardware",
    };
    if (this.videoTrack.description) cfg.description = this.videoTrack.description;
    return cfg;
  }

  /** Read one sample's payload and wrap it as an EncodedVideoChunk. */
  async chunkAt(index: number): Promise<EncodedVideoChunk> {
    const s = this.samples[index];
    if (!s) throw new Error(`样本越界: ${index}/${this.samples.length}`);
    const data = await this.#blob.slice(s.offset, s.offset + s.size).arrayBuffer();
    return new EncodedVideoChunk({
      type: s.isSync ? "key" : "delta",
      timestamp: s.ctsUs,
      duration: s.durationUs,
      data,
    });
  }

  /** Index of the nearest keyframe at or before the target time. */
  keyframeIndexBefore(targetUs: number): number {
    let key = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i]!;
      if (s.isSync && s.ctsUs <= targetUs) key = i;
      if (s.ctsUs > targetUs) break;
    }
    return key;
  }
}

/** Serialize the hvcC/avcC/vpcC/av1C sample-entry box into the raw
 * `description` bytes WebCodecs expects (box payload without 8-byte header). */
/** AAC AudioSpecificConfig from the esds descriptor chain (defensive —
 * returns null on any unexpected shape and the export degrades to
 * video-only). */
function extractAudioSpecificConfig(file: MP4File, trackId: number): Uint8Array | null {
  try {
    const trak = file.getTrackById(trackId) as unknown as {
      mdia: { minf: { stbl: { stsd: { entries: Array<Record<string, unknown>> } } } };
    };
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const esds = entry.esds as { esd?: { descs?: Array<{ descs?: Array<{ data?: Uint8Array }> }> } } | undefined;
      const data = esds?.esd?.descs?.[0]?.descs?.[0]?.data;
      if (data instanceof Uint8Array && data.length > 0) return data;
    }
  } catch {
    // fall through
  }
  return null;
}

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
