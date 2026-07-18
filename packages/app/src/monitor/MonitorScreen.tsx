import type { Grade } from "@osmo/color-engine";
import { GpuContext, GradeRenderer, defaultGrade, parseCube } from "@osmo/color-engine";
import { attachMseStream } from "@osmo/media-pipeline";
import { isTauri, rtmpStartNative, rtmpStopNative } from "@osmo/platform";
import { ScopesRenderer } from "@osmo/scopes";
import { BackIcon, Button, tokens } from "@osmo/ui";
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
  const [source, setSource] = useState<"uvc" | "rtmp">("uvc");
  const [rtmpUrl, setRtmpUrl] = useState<string | null>(null);

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

  /** 无线（RTMP）源: Rust relay → localhost fMP4 → MSE → 同一渲染循环 */
  const startRtmp = useCallback(async () => {
    stopRef.current?.();
    setError(null);
    setRtmpUrl(null);
    try {
      const restored = (await gradeStore.load("monitor:rtmp")) ?? defaultGrade();
      setGrade(restored);
      rendererRef.current?.setGrade(restored);

      const info = await rtmpStartNative();
      setRtmpUrl(info.rtmpUrl);

      let cancelled = false;
      const video = document.createElement("video");
      video.muted = true;
      let cleanupMse: (() => void) | null = null;
      let raf = 0;

      // The relay only produces bytes once the camera pushes — attach lazily
      // so we show the guide immediately and start rendering when data flows.
      void (async () => {
        try {
          const res = await fetch(info.httpUrl);
          if (cancelled) return;
          cleanupMse = await attachMseStream(video, res);
          await video.play().catch(() => {});
          const tick = () => {
            if (cancelled) return;
            if (video.readyState >= 2 && !video.paused) {
              try {
                const frame = new VideoFrame(video);
                const renderer = rendererRef.current;
                const ctx = canvasCtxRef.current;
                if (renderer && ctx) {
                  renderer.render(frame, ctx);
                  const inter = renderer.intermediateTexture;
                  if (inter) scopesRef.current?.update(inter);
                }
                frame.close();
              } catch {
                // frame not ready this tick
              }
            }
            raf = requestAnimationFrame(tick);
          };
          tick();
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      })();

      stopRef.current = () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        cleanupMse?.();
        void rtmpStopNative().catch(() => {});
        setRtmpUrl(null);
        setRunning(false);
      };
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
          className="osmo-glass"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 18px",
            borderBottom: `1px solid ${tokens.color.border}`,
            boxShadow: `0 8px 24px rgba(0,0,0,0.3), inset 0 1px 0 ${tokens.color.hairlineLight}`,
            position: "relative",
            zIndex: 1,
          }}
        >
          <Button variant="ghost" size="icon" onClick={onBack} title="返回素材库">
            <BackIcon size={16} />
          </Button>
          <h1 style={{ color: tokens.color.accent, fontSize: 15, margin: 0, fontWeight: 700, letterSpacing: 0.2 }}>
            监看
          </h1>
          <span style={{ fontSize: 12, color: tokens.color.textDim }}>
            相机切到「网络摄像头」模式后选择设备
          </span>
          <div style={{ flex: 1 }} />
          {isTauri() && (
            <div
              style={{
                display: "flex",
                gap: 2,
                background: tokens.color.surfaceRaised,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.pill,
                padding: 3,
                boxShadow: `inset 0 1px 2px rgba(0,0,0,0.3)`,
              }}
            >
              {(["uvc", "rtmp"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    stopRef.current?.();
                    setSource(s);
                  }}
                  className="osmo-btn"
                  style={{
                    border: "none",
                    borderRadius: tokens.radius.pill,
                    padding: "6px 14px",
                    fontSize: 12,
                    cursor: "pointer",
                    background: source === s ? tokens.color.text : "transparent",
                    color: source === s ? tokens.color.onLight : tokens.color.textDim,
                    fontWeight: 600,
                  }}
                >
                  {s === "uvc" ? "USB 摄像头" : "无线 RTMP"}
                </button>
              ))}
            </div>
          )}
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={source === "rtmp"}
            style={{
              background: tokens.color.surfaceRaised,
              color: tokens.color.text,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: tokens.radius.sm,
              padding: "7px 10px",
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
          <Button
            variant={running ? "secondary" : "primary"}
            onClick={() => (running ? stopRef.current?.() : void (source === "rtmp" ? startRtmp() : start()))}
          >
            {running ? "停止" : "开始监看"}
          </Button>
        </header>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            minHeight: 0,
            gap: 12,
            background: "radial-gradient(ellipse 70% 60% at 50% 42%, #0c0c0d 0%, transparent 72%)",
          }}
        >
          {rtmpUrl && (
            <div
              className="osmo-fade-in"
              style={{
                background: tokens.color.accentWash,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.md,
                padding: "10px 16px",
                fontSize: 13,
                display: "flex",
                gap: 12,
                alignItems: "center",
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08)`,
              }}
            >
              <span>
                手机 Mimo → 直播 → 自定义 RTMP，推流地址填：
                <code style={{ color: tokens.color.accent, marginLeft: 6, fontFamily: tokens.font.mono }}>
                  {rtmpUrl}
                </code>
              </span>
              <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(rtmpUrl)}>
                复制
              </Button>
            </div>
          )}
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
              boxShadow: `${tokens.shadow.lg}, 0 0 0 1px ${tokens.color.hairlineLight}`,
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 12, padding: "0 18px 14px", alignItems: "flex-end" }}>
          <canvas ref={histRef} width={256} height={110} style={scopeCanvas} />
          <canvas ref={waveRef} width={512} height={110} style={{ ...scopeCanvas, width: 320 }} />
          <canvas ref={vecRef} width={256} height={256} style={{ ...scopeCanvas, width: 110, height: 110 }} />
          {error && <span style={{ color: tokens.color.bad, fontSize: 12 }}>{error}</span>}
        </div>
      </div>

      <aside
        className="osmo-glass"
        style={{
          width: 300,
          borderLeft: `1px solid ${tokens.color.border}`,
          display: "flex",
          flexDirection: "column",
          boxShadow: `-8px 0 24px rgba(0,0,0,0.25), inset 1px 0 0 ${tokens.color.hairlineLight}`,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.2,
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

const scopeCanvas: React.CSSProperties = {
  width: 200,
  height: 90,
  background: "#000",
  borderRadius: tokens.radius.sm,
  boxShadow: `inset 0 0 0 1px ${tokens.color.border}`,
  display: "block",
};
