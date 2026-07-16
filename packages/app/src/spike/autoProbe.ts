import { GpuContext, runPrecisionProbe } from "@osmo/color-engine";
import type { PrecisionReport } from "@osmo/color-engine";
import { Mp4Demuxer, VideoDecodeSession } from "@osmo/media-pipeline";

/** Decode the first frame of `file` and run the 10-bit integrity probe. */
export async function probeFile(file: Blob): Promise<PrecisionReport> {
  const gpu = await GpuContext.create();
  const demuxer = await Mp4Demuxer.open(file);
  const config = demuxer.decoderConfig();
  const frame = await new Promise<VideoFrame>((resolve, reject) => {
    const session = new VideoDecodeSession(
      config,
      (f) => resolve(f),
      reject,
    );
    demuxer
      .extractAll((c) => {
        if (session.state === "configured") session.decode(c.chunk);
      })
      .then(() => session.flush())
      .catch(reject);
  });
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
