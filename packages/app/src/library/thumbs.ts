import { StreamingDemuxer, VideoDecodeSession, decodeFirstFrame } from "@osmo/media-pipeline";
import type { LibraryClip } from "./scanFolder";

const cache = new Map<string, Promise<string | null>>();

/** First-frame JPEG data URL, decoded from the LRF proxy when available.
 * The streaming demuxer reads only moov + the first samples, so even
 * proxy-less multi-GB clips thumbnail cheaply. */
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

  const demuxer = await StreamingDemuxer.open(source);
  if (!(await VideoDecodeSession.isSupported(demuxer.decoderConfig()))) return null;
  const frame = await decodeFirstFrame(demuxer);

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
