import { useEffect, useState } from "react";
import { autoProbeAndReport } from "./spike/autoProbe";
import { PlayerSpike } from "./spike/PlayerSpike";

/**
 * Application shell shared by apps/desktop and apps/web.
 * M0: capability probe strip + playback spike. The real media-library /
 * editor navigation replaces this in M1.
 */
export function App() {
  const [report, setReport] = useState<CapabilityReport | null>(null);

  useEffect(() => {
    probeCapabilities().then(setReport);
    // Startup pipeline-integrity probe; reports to the dev terminal when a
    // sink is present, silently no-ops in production.
    void autoProbeAndReport();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#141414",
        color: "#f2f2f2",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 0 48px",
        gap: 16,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <h1 style={{ color: "#ff6a00", fontSize: 22, margin: 0 }}>OSMO Desktop</h1>
        <span style={{ opacity: 0.6, fontSize: 13 }}>M0 · 播放技术竖切</span>
      </header>

      {report && (
        <div style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap" }}>
          {Object.entries(report).map(([k, v]) => (
            <span key={k} style={{ color: v ? "#6fdd8b" : "#ff5f57" }}>
              {v ? "✓" : "✗"} {k}
            </span>
          ))}
        </div>
      )}

      <PlayerSpike />
    </div>
  );
}

interface CapabilityReport {
  WebGPU: boolean;
  WebCodecs: boolean;
  "HEVC Main10 解码": boolean;
  OffscreenCanvas: boolean;
  "File System Access": boolean;
  "Tauri 环境": boolean;
}

async function probeCapabilities(): Promise<CapabilityReport> {
  let webgpu = false;
  try {
    webgpu = !!navigator.gpu && (await navigator.gpu.requestAdapter()) !== null;
  } catch {
    webgpu = false;
  }

  let hevc10 = false;
  const webcodecs = typeof VideoDecoder !== "undefined";
  if (webcodecs) {
    try {
      // hvc1.2.4.L153 = HEVC Main10 profile, level 5.1 (4K60 class)
      const support = await VideoDecoder.isConfigSupported({
        codec: "hvc1.2.4.L153.B0",
        hardwareAcceleration: "prefer-hardware",
      });
      hevc10 = support.supported === true;
    } catch {
      hevc10 = false;
    }
  }

  return {
    WebGPU: webgpu,
    WebCodecs: webcodecs,
    "HEVC Main10 解码": hevc10,
    OffscreenCanvas: typeof OffscreenCanvas !== "undefined",
    "File System Access": "showDirectoryPicker" in window,
    "Tauri 环境": "__TAURI_INTERNALS__" in window,
  };
}
