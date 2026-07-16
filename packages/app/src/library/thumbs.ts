import { Mp4Demuxer, VideoDecodeSession } from "@osmo/media-pipeline";
import type { LibraryClip } from "./scanFolder";

/** Skip thumbnailing sources we'd have to slurp fully into memory (the M1
 * demuxer is whole-file; streaming lands in M2). LRF proxies are ~1MB/s so
 * they always pass. */
const MAX_THUMB_SOURCE_BYTES = 256 * 1024 * 1024;

const cache = new Map<string, Promise<string | null>>();

/** First-frame JPEG data URL, decoded from the LRF proxy when available. */
export function thumbnailFor(clip: LibraryClip, width = 320): Promise<string | null> {
  let p = cache.get(clip.key);
  if (!p) {
    p = generate(clip, width).catch(() => null);
    cache.set(clip.key, p);
  }
  return p;
}

async function generate(clip: LibraryClip, width: number): Promise<string | null> {
  const lrf = await clip.getLrf();
  const source = lrf ?? (await clip.getFile());
  if (source.size > MAX_THUMB_SOURCE_BYTES) return null;

  const demuxer = await Mp4Demuxer.open(source);
  const config = demuxer.decoderConfig();
  if (!(await VideoDecodeSession.isSupported(config))) return null;

  const frame = await new Promise<VideoFrame>((resolve, reject) => {
    let done = false;
    const session = new VideoDecodeSession(
      config,
      (f) => {
        if (!done) {
          done = true;
          resolve(f);
        } else {
          f.close();
        }
      },
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
    const scale = width / frame.displayWidth;
    const height = Math.round(frame.displayHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(frame, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    frame.close();
  }
}
