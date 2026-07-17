import type { StreamingDemuxer } from "../demux/streamingDemuxer";
import { VideoDecodeSession } from "./decodeSession";

/**
 * Decode just the first displayable frame (thumbnails, probes). Reads only
 * the samples it needs — cheap even on multi-GB files. Caller owns the
 * returned frame and must close() it.
 */
export function decodeFirstFrame(demuxer: StreamingDemuxer): Promise<VideoFrame> {
  const config = demuxer.decoderConfig();
  return new Promise((resolve, reject) => {
    let got = false;
    const session = new VideoDecodeSession(
      config,
      (f) => {
        if (!got) {
          got = true;
          resolve(f);
        } else {
          f.close();
        }
      },
      (e) => {
        if (!got) reject(e);
      },
    );
    (async () => {
      const max = Math.min(demuxer.samples.length, 120);
      for (let i = 0; i < max && !got; i++) {
        if (session.state !== "configured") break;
        session.decode(await demuxer.chunkAt(i));
      }
      await session.flush().catch(() => {});
      session.close();
      if (!got) reject(new Error("未能解出首帧"));
    })().catch((e) => {
      if (!got) reject(e);
    });
  });
}
