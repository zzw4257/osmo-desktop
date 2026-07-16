import { useEffect, useState } from "react";

/**
 * Application shell shared by apps/desktop and apps/web.
 * M0: capability probe screen — verifies the WebCodecs/WebGPU foundation the
 * whole product stands on, in both shells. The player spike mounts here next.
 */
export function App() {
  const [report, setReport] = useState<CapabilityReport | null>(null);

  useEffect(() => {
    probeCapabilities().then(setReport);
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
        justifyContent: "center",
        gap: 12,
      }}
    >
      <h1 style={{ color: "#ff6a00", fontSize: 24, margin: 0 }}>OSMO Desktop</h1>
      <p style={{ opacity: 0.7, margin: 0 }}>M0 · 平台能力自检</p>
      {report === null ? (
        <p>探测中…</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            {Object.entries(report).map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: "4px 16px", opacity: 0.7 }}>{k}</td>
                <td style={{ padding: "4px 16px", color: v ? "#6fdd8b" : "#ff5f57" }}>
                  {v ? "✓ 可用" : "✗ 不可用"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
