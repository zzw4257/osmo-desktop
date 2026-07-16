import type { Grade } from "@osmo/color-engine";
import { GpuContext, GradeRenderer, parseCube } from "@osmo/color-engine";
import type { ClipPlayerStats } from "@osmo/media-pipeline";
import { ClipPlayer, Mp4Demuxer } from "@osmo/media-pipeline";
import { ScopesRenderer } from "@osmo/scopes";
import { useCallback, useEffect, useRef, useState } from "react";

export interface EditorEngine {
  ready: boolean;
  error: string | null;
  stats: ClipPlayerStats | null;
  loadFile(file: File): Promise<void>;
  play(): void;
  pause(): void;
  stepForward(): void;
  seek(us: number): void;
  applyGrade(grade: Grade): void;
  loadCreativeLut(file: File): Promise<void>;
  loadInputLut(file: File): Promise<void>;
  attachScopes(hist: HTMLCanvasElement | null, wave: HTMLCanvasElement | null): void;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    loadFile: useCallback(async (file: File) => {
      const demuxer = await Mp4Demuxer.open(file);
      await playerRef.current!.load(demuxer);
    }, []),
    play: useCallback(() => playerRef.current?.play(), []),
    pause: useCallback(() => playerRef.current?.pause(), []),
    stepForward: useCallback(() => playerRef.current?.stepForward(), []),
    seek: useCallback((us: number) => playerRef.current?.seek(us), []),
    applyGrade: useCallback(
      (grade: Grade) => {
        rendererRef.current?.setGrade(grade);
        rerenderPaused();
      },
      [rerenderPaused],
    ),
    loadCreativeLut: useCallback(
      async (file: File) => {
        rendererRef.current?.setCreativeLut(parseCube(await file.text()));
        rerenderPaused();
      },
      [rerenderPaused],
    ),
    loadInputLut: useCallback(
      async (file: File) => {
        rendererRef.current?.setInputLut(parseCube(await file.text()));
        rerenderPaused();
      },
      [rerenderPaused],
    ),
    attachScopes: useCallback(
      (hist: HTMLCanvasElement | null, wave: HTMLCanvasElement | null) => {
        scopesRef.current?.attachCanvases(hist, wave);
        rerenderPaused();
      },
      [rerenderPaused],
    ),
  };
}
