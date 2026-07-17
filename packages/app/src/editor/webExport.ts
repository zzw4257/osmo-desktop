import type { Cube3dLut, Grade } from "@osmo/color-engine";
import { GpuContext, GradeRenderer } from "@osmo/color-engine";
import { StreamingDemuxer } from "@osmo/media-pipeline";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

/**
 * Web-shell export: WebCodecs decode → the SAME grade pipeline rendered
 * into an offscreen canvas → VideoEncoder → mp4-muxer. Audio is remuxed
 * losslessly when the source has an extractable AAC config.
 *
 * Encoder ladder: HEVC Main10 → HEVC Main → H.264 High — the chosen tier is
 * reported so the UI can state the fidelity honestly (десktop native export
 * remains the 10-bit guaranteed path; see docs/baselines.md).
 */
export interface WebExportProgress {
  frame: number;
  totalFrames: number;
}

export interface WebExportResult {
  blob: Blob;
  codecLabel: string;
  frames: number;
}

interface EncoderChoice {
  config: VideoEncoderConfig;
  muxerCodec: "hevc" | "avc";
  label: string;
}

async function pickEncoder(width: number, height: number, fps: number): Promise<EncoderChoice> {
  const bitrate = Math.round(((width * height) / (3840 * 2160)) * 50e6);
  const base = { width, height, framerate: fps, bitrate: Math.max(bitrate, 8e6) };
  const ladder: EncoderChoice[] = [
    {
      config: { ...base, codec: "hvc1.2.4.L153.B0" },
      muxerCodec: "hevc",
      label: "HEVC 10-bit",
    },
    {
      config: { ...base, codec: "hvc1.1.6.L153.B0" },
      muxerCodec: "hevc",
      label: "HEVC 8-bit",
    },
    {
      config: { ...base, codec: "avc1.640033", avc: { format: "avc" } } as VideoEncoderConfig,
      muxerCodec: "avc",
      label: "H.264 8-bit",
    },
  ];
  for (const choice of ladder) {
    try {
      const res = await VideoEncoder.isConfigSupported(choice.config);
      if (res.supported) return choice;
    } catch {
      // try next tier
    }
  }
  throw new Error("当前浏览器没有可用的视频编码器");
}

export async function webExport(
  source: Blob,
  grade: Grade,
  inputLut: Cube3dLut | null,
  creativeLut: Cube3dLut | null,
  onProgress: (p: WebExportProgress) => void,
  cancelled: () => boolean,
): Promise<WebExportResult> {
  const demuxer = await StreamingDemuxer.open(source);
  const { width, height, durationUs } = demuxer.videoTrack;
  const totalFrames = demuxer.samples.length;
  const fps = durationUs > 0 ? Math.round((totalFrames / durationUs) * 1e6) : 30;

  const choice = await pickEncoder(width, height, fps);

  // Own GPU context/renderer so the preview pipeline is untouched.
  const gpu = await GpuContext.create();
  const renderer = new GradeRenderer(gpu);
  renderer.setGrade(grade);
  renderer.setInputLut(inputLut);
  renderer.setCreativeLut(creativeLut);
  const canvas = new OffscreenCanvas(width, height);
  const canvasCtx = gpu.configureCanvas(canvas);

  const includeAudio =
    demuxer.audioTrack !== null &&
    demuxer.audioTrack.codec.startsWith("mp4a") &&
    demuxer.audioTrack.description !== null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: choice.muxerCodec, width, height, frameRate: fps },
    ...(includeAudio
      ? {
          audio: {
            codec: "aac" as const,
            sampleRate: demuxer.audioTrack!.sampleRate,
            numberOfChannels: demuxer.audioTrack!.channelCount,
          },
        }
      : {}),
    fastStart: "in-memory",
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encoderError = e instanceof Error ? e : new Error(String(e))),
  });
  encoder.configure(choice.config);

  let decodeError: Error | null = null;
  let encodedFrames = 0;
  const gop = Math.max(1, Math.round(fps * 2));
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        renderer.render(frame, canvasCtx);
        const init: VideoFrameInit = { timestamp: frame.timestamp };
        if (frame.duration !== null) init.duration = frame.duration;
        const graded = new VideoFrame(canvas as unknown as CanvasImageSource, init);
        encoder.encode(graded, { keyFrame: encodedFrames % gop === 0 });
        graded.close();
        encodedFrames++;
        onProgress({ frame: encodedFrames, totalFrames });
      } catch (e) {
        decodeError = e instanceof Error ? e : new Error(String(e));
      } finally {
        frame.close();
      }
    },
    error: (e) => (decodeError = e instanceof Error ? e : new Error(String(e))),
  });
  decoder.configure(demuxer.decoderConfig());

  for (let i = 0; i < totalFrames; i++) {
    if (cancelled()) throw new Error("已取消");
    if (decodeError) throw decodeError;
    if (encoderError) throw encoderError;
    decoder.decode(await demuxer.chunkAt(i));
    // Backpressure: bound both queues so memory stays flat.
    while (decoder.decodeQueueSize > 4 || encoder.encodeQueueSize > 4) {
      await new Promise((r) => setTimeout(r, 2));
      if (cancelled()) throw new Error("已取消");
    }
  }
  await decoder.flush();
  await encoder.flush();
  decoder.close();
  encoder.close();
  if (decodeError) throw decodeError;
  if (encoderError) throw encoderError;

  if (includeAudio) {
    const at = demuxer.audioTrack!;
    for (let i = 0; i < demuxer.audioSamples.length; i++) {
      const s = demuxer.audioSamples[i]!;
      const data = await demuxer.audioChunkAt(i);
      muxer.addAudioChunk(
        new EncodedAudioChunk({
          type: "key",
          timestamp: s.ctsUs,
          duration: s.durationUs,
          data,
        }),
        i === 0
          ? {
              decoderConfig: {
                codec: at.codec,
                sampleRate: at.sampleRate,
                numberOfChannels: at.channelCount,
                description: at.description!,
              },
            }
          : undefined,
      );
    }
  }

  muxer.finalize();
  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  return {
    blob: new Blob([buffer], { type: "video/mp4" }),
    codecLabel: choice.label,
    frames: encodedFrames,
  };
}

/** Save via FSA when available, else a download link. */
export async function saveBlobAs(blob: Blob, suggestedName: string): Promise<void> {
  const w = window as Window & {
    showSaveFilePicker?(o: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }): Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
  };
  if (w.showSaveFilePicker) {
    const handle = await w.showSaveFilePicker({
      suggestedName,
      types: [{ description: "MP4 视频", accept: { "video/mp4": [".mp4"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
