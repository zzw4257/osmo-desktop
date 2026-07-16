/** Minimal ambient types for the subset of mp4box.js we use. */
declare module "mp4box" {
  export interface MP4MediaTrack {
    id: number;
    codec: string;
    timescale: number;
    duration: number;
    nb_samples: number;
    movie_duration: number;
    movie_timescale: number;
    video?: { width: number; height: number };
    audio?: { sample_rate: number; channel_count: number };
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    videoTracks: MP4MediaTrack[];
    audioTracks: MP4MediaTrack[];
  }

  export interface MP4Sample {
    number: number;
    track_id: number;
    timescale: number;
    is_sync: boolean;
    cts: number;
    dts: number;
    duration: number;
    data: Uint8Array;
  }

  export interface MP4Box {
    write(stream: DataStream): void;
  }

  export interface MP4SampleEntry {
    hvcC?: MP4Box;
    avcC?: MP4Box;
    vpcC?: MP4Box;
    av1C?: MP4Box;
  }

  export interface MP4Trak {
    mdia: { minf: { stbl: { stsd: { entries: MP4SampleEntry[] } } } };
  }

  export interface MP4File {
    onReady: ((info: MP4Info) => void) | null;
    onError: ((error: string) => void) | null;
    onSamples: ((trackId: number, user: unknown, samples: MP4Sample[]) => void) | null;
    appendBuffer(buffer: ArrayBuffer & { fileStart?: number }): number;
    setExtractionOptions(
      trackId: number,
      user?: unknown,
      options?: { nbSamples?: number; rapAlignement?: boolean },
    ): void;
    start(): void;
    stop(): void;
    flush(): void;
    releaseUsedSamples(trackId: number, sampleNumber: number): void;
    getTrackById(trackId: number): MP4Trak;
  }

  export class DataStream {
    static BIG_ENDIAN: boolean;
    static LITTLE_ENDIAN: boolean;
    constructor(arrayBuffer?: ArrayBuffer, byteOffset?: number, endianness?: boolean);
    buffer: ArrayBuffer;
  }

  export function createFile(): MP4File;
}
