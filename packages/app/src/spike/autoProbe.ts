import { GpuContext, runPrecisionProbe } from "@osmo/color-engine";
import type { PrecisionReport } from "@osmo/color-engine";
import { StreamingDemuxer, decodeFirstFrame } from "@osmo/media-pipeline";

/** Decode the first frame of `file` and run the 10-bit integrity probe. */
export async function probeFile(file: Blob): Promise<PrecisionReport> {
  const gpu = await GpuContext.create();
  const demuxer = await StreamingDemuxer.open(file);
  const frame = await decodeFirstFrame(demuxer);
  try {
    return await runPrecisionProbe(gpu, frame);
  } finally {
    frame.close();
  }
}

/**
 * Dev-only: fetch the bundled ramp sample, probe it, report to the vite
 * terminal via /__probe-result. Runs in every shell (browser tab AND Tauri
 * WKWebView) — that is the point: one code path, per-platform evidence.
 */
export async function autoProbeAndReport(): Promise<void> {
  const shell = "__TAURI_INTERNALS__" in window ? "tauri-wkwebview" : "browser";
  try {
    const res = await fetch("/samples/ramp_4k_hevc10.mp4");
    if (!res.ok) return;
    const report = await probeFile(await res.blob());
    await fetch("/__probe-result", {
      method: "POST",
      body: JSON.stringify({ shell, ua: navigator.userAgent, ...report }),
    });
  } catch (e) {
    await fetch("/__probe-result", {
      method: "POST",
      body: JSON.stringify({ shell, error: String(e) }),
    }).catch(() => {});
  }
}
