import type { Cube3dLut, Grade } from "@osmo/color-engine";
import { GpuContext, GradeRenderer } from "@osmo/color-engine";
import type { ClipPlayerStats, FrameSink } from "@osmo/media-pipeline";
import { ClipPlayer, ScrubPreview, StreamingDemuxer } from "@osmo/media-pipeline";
import { ScopesRenderer } from "@osmo/scopes";
import { useCallback, useEffect, useRef, useState } from "react";

export interface LoadedClipInfo {
  width: number;
  height: number;
  fps: number;
  durationUs: number;
}

export interface EditorEngine {
  ready: boolean;
  error: string | null;
  stats: ClipPlayerStats | null;
  loadFile(file: Blob): Promise<LoadedClipInfo>;
  /** Attach the LRF proxy for fast scrubbing (call after loadFile). */
  attachScrubProxy(lrf: Blob | null): Promise<void>;
  play(): void;
  pause(): void;
  stepForward(): void;
  seek(us: number): void;
  /** Fast preview while dragging; falls back to precise seek without proxy. */
  scrub(us: number): void;
  applyGrade(grade: Grade): void;
  applyCreativeLut(cube: Cube3dLut | null): void;
  applyInputLut(cube: Cube3dLut | null): void;
  attachScopes(
    hist: HTMLCanvasElement | null,
    wave: HTMLCanvasElement | null,
    vector: HTMLCanvasElement | null,
  ): void;
}

/**
 * Binds canvas ⇄ GpuContext ⇄ GradeRenderer ⇄ ClipPlayer. Keeps a clone of
 * the last presented frame so grade changes re-render instantly while
 * paused (external textures can't outlive their frame, so we re-import from
 * the clone).
 */
export function useEditorEngine(canvasRef: React.RefObject<HTMLCanvasElement | null>): EditorEngine {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ClipPlayerStats | null>(null);

  const rendererRef = useRef<GradeRenderer | null>(null);
  const canvasCtxRef = useRef<GPUCanvasContext | null>(null);
  const playerRef = useRef<ClipPlayer | null>(null);
  const lastFrameRef = useRef<VideoFrame | null>(null);
  const scopesRef = useRef<ScopesRenderer | null>(null);
  const sinkRef = useRef<FrameSink | null>(null);
  const scrubberRef = useRef<ScrubPreview | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const gpu = await GpuContext.create();
        if (disposed || !canvasRef.current) return;
        const renderer = new GradeRenderer(gpu);
        const ctx = gpu.configureCanvas(canvasRef.current);
        rendererRef.current = renderer;
        canvasCtxRef.current = ctx;

        scopesRef.current = new ScopesRenderer(gpu.device, gpu.preferredFormat);

        const sink = {
          render: (frame: VideoFrame) => {
            renderer.render(frame, ctx);
            const inter = renderer.intermediateTexture;
            if (inter) scopesRef.current?.update(inter);
            lastFrameRef.current?.close();
            try {
              lastFrameRef.current = frame.clone();
            } catch {
              lastFrameRef.current = null;
            }
          },
        };
        sinkRef.current = sink;
        playerRef.current = new ClipPlayer(sink, setStats);
        setReady(true);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      disposed = true;
      playerRef.current?.unload();
      lastFrameRef.current?.close();
      lastFrameRef.current = null;
    };
  }, []);

  const rerenderPaused = useCallback(() => {
    const frame = lastFrameRef.current;
    const renderer = rendererRef.current;
    const ctx = canvasCtxRef.current;
    const state = playerRef.current?.state;
    if (frame && renderer && ctx && state !== "playing") {
      renderer.render(frame, ctx);
      const inter = renderer.intermediateTexture;
      if (inter) scopesRef.current?.update(inter);
    }
  }, []);

  return {
    ready,
    error,
    stats,
    loadFile: useCallback(async (file: Blob) => {
      scrubberRef.current?.dispose();
      scrubberRef.current = null;
      const demuxer = await StreamingDemuxer.open(file);
      const track = demuxer.videoTrack;
      const durationS = track.durationUs / 1e6;
      const info: LoadedClipInfo = {
        width: track.width,
        height: track.height,
        fps: durationS > 0 ? Math.round((track.nbSamples / durationS) * 1000) / 1000 : 30,
        durationUs: track.durationUs,
      };
      await playerRef.current!.load(demuxer);
      return info;
    }, []),
    attachScrubProxy: useCallback(async (lrf: Blob | null) => {
      scrubberRef.current?.dispose();
      scrubberRef.current = null;
      if (!lrf || !sinkRef.current) return;
      try {
        const proxyDemuxer = await StreamingDemuxer.open(lrf);
        scrubberRef.current = new ScrubPreview(proxyDemuxer, sinkRef.current);
      } catch {
        // proxy is optional; scrubbing falls back to precise seeks
      }
    }, []),
    play: useCallback(() => playerRef.current?.play(), []),
    pause: useCallback(() => playerRef.current?.pause(), []),
    stepForward: useCallback(() => playerRef.current?.stepForward(), []),
    seek: useCallback((us: number) => playerRef.current?.seek(us), []),
    scrub: useCallback((us: number) => {
      const scrubber = scrubberRef.current;
      if (scrubber) {
        playerRef.current?.pause();
        scrubber.request(us);
      } else {
        playerRef.current?.seek(us);
      }
    }, []),
    applyGrade: useCallback(
      (grade: Grade) => {
        rendererRef.current?.setGrade(grade);
        rerenderPaused();
      },
      [rerenderPaused],
    ),
    applyCreativeLut: useCallback(
      (cube: Cube3dLut | null) => {
        rendererRef.current?.setCreativeLut(cube);
        rerenderPaused();
      },
      [rerenderPaused],
    ),
    applyInputLut: useCallback(
      (cube: Cube3dLut | null) => {
        rendererRef.current?.setInputLut(cube);
        rerenderPaused();
      },
      [rerenderPaused],
    ),
    attachScopes: useCallback(
      (hist: HTMLCanvasElement | null, wave: HTMLCanvasElement | null, vector: HTMLCanvasElement | null) => {
        scopesRef.current?.attachCanvases(hist, wave, vector);
        rerenderPaused();
      },
      [rerenderPaused],
    ),
  };
}
