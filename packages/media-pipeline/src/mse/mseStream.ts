/// <reference path="../demux/mp4box.d.ts" />
import { createFile } from "mp4box";

/**
 * Attach a live fragmented-MP4 HTTP stream (the RTMP relay's output) to a
 * <video> element via MSE. The codec string is sniffed from the init
 * segment with mp4box, so any H.264/HEVC profile the camera pushes works.
 * Keeps latency low by chasing the live edge. Returns a cleanup function.
 */
export async function attachMseStream(
  video: HTMLVideoElement,
  response: Response,
): Promise<() => void> {
  if (!response.ok || !response.body) {
    throw new Error(`拉流失败 (${response.status})`);
  }
  const reader = response.body.getReader();
  let stopped = false;

  // ---- sniff codec from the init segment ----
  const pending: Uint8Array[] = [];
  const probe = createFile();
  let codec: string | null = null;
  probe.onError = () => {};
  probe.onReady = (info) => {
    codec = info.videoTracks
      .concat(info.audioTracks ?? [])
      .map((t) => t.codec)
      .join(",");
  };
  let offset = 0;
  while (codec === null) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error("流在初始化段前结束");
    pending.push(value);
    const ab = value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer & { fileStart?: number };
    ab.fileStart = offset;
    offset += value.byteLength;
    probe.appendBuffer(ab);
    if (offset > 4 * 1024 * 1024) throw new Error("初始化段过大/不是 fMP4");
  }
  probe.stop();

  const mime = `video/mp4; codecs="${codec}"`;
  if (!("MediaSource" in window) || !MediaSource.isTypeSupported(mime)) {
    throw new Error(`浏览器不支持该流 (${mime})`);
  }

  // ---- MSE plumbing ----
  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  await new Promise<void>((resolve) => {
    ms.addEventListener("sourceopen", () => resolve(), { once: true });
  });
  const sb = ms.addSourceBuffer(mime);
  const queue: Uint8Array[] = [...pending];
  pending.length = 0;

  const pumpQueue = () => {
    if (stopped || sb.updating || queue.length === 0) return;
    const chunk = queue.shift()!;
    try {
      sb.appendBuffer(chunk as BufferSource);
    } catch {
      // QuotaExceeded: drop history and retry on next updateend
      try {
        if (video.buffered.length > 0 && video.currentTime > 10) {
          sb.remove(0, video.currentTime - 5);
        }
      } catch {
        /* ignore */
      }
      queue.unshift(chunk);
    }
  };
  sb.addEventListener("updateend", pumpQueue);

  // network → queue
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || stopped) break;
      if (value) {
        queue.push(value);
        pumpQueue();
      }
    }
    if (!stopped && ms.readyState === "open") {
      try {
        ms.endOfStream();
      } catch {
        /* ignore */
      }
    }
  })();
  pumpQueue();

  // live-edge chase: never lag more than ~1.5s behind
  const chase = setInterval(() => {
    try {
      if (video.buffered.length > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        if (end - video.currentTime > 1.5) video.currentTime = end - 0.3;
        if (video.paused) void video.play().catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, 1000);

  return () => {
    stopped = true;
    clearInterval(chase);
    void reader.cancel().catch(() => {});
    try {
      if (ms.readyState === "open") ms.endOfStream();
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(video.src);
  };
}
