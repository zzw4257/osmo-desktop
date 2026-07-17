import type { Grade } from "@osmo/color-engine";
import { GpuContext, GradeRenderer, defaultGrade, parseCube } from "@osmo/color-engine";
import { ScopesRenderer } from "@osmo/scopes";
import { tokens } from "@osmo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdjustPanel } from "../editor/AdjustPanel";
import { IdbGradeStore } from "../editor/gradeStore";

const gradeStore = new IdbGradeStore();

export interface MonitorScreenProps {
  onBack: () => void;
}

/**
 * 监看模式: live UVC feed (Pocket in webcam mode) rendered through the SAME
 * grade pipeline + scopes — a field monitor with LUT preview and waveform.
 * The grade persists per camera device, through the same store as clips.
 */
export function MonitorScreen({ onBack }: MonitorScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const vecRef = useRef<HTMLCanvasElement>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<Grade>(() => defaultGrade());

  const rendererRef = useRef<GradeRenderer | null>(null);
  const scopesRef = useRef<ScopesRenderer | null>(null);
  const canvasCtxRef = useRef<GPUCanvasContext | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // GPU init once
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const gpu = await GpuContext.create();
        if (disposed || !canvasRef.current) return;
        rendererRef.current = new GradeRenderer(gpu);
        canvasCtxRef.current = gpu.configureCanvas(canvasRef.current);
        scopesRef.current = new ScopesRenderer(gpu.device, gpu.preferredFormat);
        scopesRef.current.attachCanvases(histRef.current, waveRef.current, vecRef.current);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      disposed = true;
      stopRef.current?.();
    };
  }, []);

  // Camera list (labels appear after first permission grant)
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      setDeviceId((cur) => cur || cams[0]?.deviceId || "");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const gradeKey = `monitor:${deviceId || "default"}`;

  const updateGrade = useCallback(
    (next: Grade) => {
      setGrade(next);
      rendererRef.current?.setGrade(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void gradeStore.save(gradeKey, next), 400);
    },
    [gradeKey],
  );

  const start = useCallback(async () => {
    stopRef.current?.();
    setError(null);
    try {
      const restored = (await gradeStore.load(gradeKey)) ?? defaultGrade();
      setGrade(restored);
      rendererRef.current?.setGrade(restored);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      await refreshDevices(); // labels become visible post-permission
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("没有视频轨");

      let cancelled = false;
      const renderFrame = (frame: VideoFrame) => {
        const renderer = rendererRef.current;
        const ctx = canvasCtxRef.current;
        if (renderer && ctx && !cancelled) {
          renderer.render(frame, ctx);
          const inter = renderer.intermediateTexture;
          if (inter) scopesRef.current?.update(inter);
        }
        frame.close();
      };

      const MSTP = (
        window as Window & {
          MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => {
            readable: ReadableStream<VideoFrame>;
          };
        }
      ).MediaStreamTrackProcessor;

      if (MSTP) {
        const reader = new MSTP({ track: track as MediaStreamTrack }).readable.getReader();
        void (async () => {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || cancelled) {
              value?.close();
              break;
            }
            renderFrame(value);
          }
        })();
        stopRef.current = () => {
          cancelled = true;
          void reader.cancel().catch(() => {});
          track.stop();
          setRunning(false);
        };
      } else {
        // Fallback: hidden <video> + rAF frame lift
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        let raf = 0;
        const tick = () => {
          if (cancelled) return;
          if (video.readyState >= 2) {
            try {
              renderFrame(new VideoFrame(video));
            } catch {
              // not ready this tick
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
        stopRef.current = () => {
          cancelled = true;
          cancelAnimationFrame(raf);
          track.stop();
          setRunning(false);
        };
      }
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [deviceId, gradeKey, refreshDevices]);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: tokens.color.bg,
        color: tokens.color.text,
        fontFamily: tokens.font.family,
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            borderBottom: `1px solid ${tokens.color.border}`,
          }}
        >
          <button onClick={onBack} style={btn} title="返回素材库">
            ←
          </button>
          <h1 style={{ color: tokens.color.accent, fontSize: 16, margin: 0, fontWeight: 700 }}>
            监看
          </h1>
          <span style={{ fontSize: 12, color: tokens.color.textDim }}>
            相机切到「网络摄像头」模式后选择设备
          </span>
          <div style={{ flex: 1 }} />
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            style={{
              background: tokens.color.surfaceRaised,
              color: tokens.color.text,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              padding: "6px 8px",
              fontSize: 12,
              maxWidth: 240,
            }}
          >
            {devices.length === 0 && <option value="">（授权后显示设备名）</option>}
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `摄像头 ${i + 1}`}
              </option>
            ))}
          </select>
          <button
            onClick={() => (running ? stopRef.current?.() : void start())}
            style={{
              ...btn,
              width: "auto",
              padding: "0 16px",
              background: running ? tokens.color.surfaceRaised : tokens.color.accent,
              color: running ? tokens.color.text : "#141414",
              fontWeight: 600,
            }}
          >
            {running ? "停止" : "开始监看"}
          </button>
        </header>

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            minHeight: 0,
          }}
        >
          <canvas
            ref={canvasRef}
            width={1920}
            height={1080}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              aspectRatio: "16/9",
              background: "#000",
              borderRadius: tokens.radius.md,
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 12, padding: "0 16px 12px", alignItems: "flex-end" }}>
          <canvas ref={histRef} width={256} height={110} style={scopeCanvas} />
          <canvas ref={waveRef} width={512} height={110} style={{ ...scopeCanvas, width: 320 }} />
          <canvas ref={vecRef} width={256} height={256} style={{ ...scopeCanvas, width: 110, height: 110 }} />
          {error && <span style={{ color: tokens.color.bad, fontSize: 12 }}>{error}</span>}
        </div>
      </div>

      <aside
        style={{
          width: 300,
          borderLeft: `1px solid ${tokens.color.border}`,
          display: "flex",
          flexDirection: "column",
          background: tokens.color.surface,
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 700,
            borderBottom: `1px solid ${tokens.color.border}`,
          }}
        >
          监看调色（按设备记忆）
        </div>
        <AdjustPanel
          grade={grade}
          onChange={updateGrade}
          onPickCreativeLut={(f) =>
            void f.text().then((t) => {
              rendererRef.current?.setCreativeLut(parseCube(t));
            })
          }
          onPickInputLut={(f) =>
            void f.text().then((t) => {
              rendererRef.current?.setInputLut(parseCube(t));
            })
          }
        />
      </aside>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: tokens.color.surfaceRaised,
  color: tokens.color.text,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.sm,
  width: 36,
  height: 30,
  cursor: "pointer",
  fontSize: 14,
};

const scopeCanvas: React.CSSProperties = {
  width: 200,
  height: 90,
  background: "#000",
  borderRadius: 6,
  border: `1px solid ${tokens.color.border}`,
  display: "block",
};
