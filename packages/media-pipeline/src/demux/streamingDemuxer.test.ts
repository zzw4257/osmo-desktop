import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StreamingDemuxer } from "./streamingDemuxer";

const SAMPLES = join(__dirname, "../../../../samples");

function loadSample(name: string): Blob | null {
  const p = join(SAMPLES, name);
  if (!existsSync(p)) return null;
  const buf = readFileSync(p);
  return new Blob([new Uint8Array(buf)]);
}

// Container parsing runs fine under Node (mp4box + Blob); chunkAt needs
// EncodedVideoChunk which is browser-only, so tests stop at the sample index.
describe("StreamingDemuxer.open", () => {
  it("parses a faststart file (moov first)", async () => {
    const blob = loadSample("ramp_4k_hevc10.mp4");
    if (!blob) return; // samples not generated in this checkout
    const d = await StreamingDemuxer.open(blob);
    expect(d.videoTrack.width).toBe(3840);
    expect(d.videoTrack.height).toBe(2160);
    expect(d.videoTrack.codec.startsWith("hvc1")).toBe(true);
    expect(d.videoTrack.description).not.toBeNull();
    expect(d.samples.length).toBe(d.videoTrack.nbSamples);
    expect(d.samples[0]!.isSync).toBe(true);
    expect(d.samples[0]!.size).toBeGreaterThan(0);
  });

  it("parses a moov-at-end file (DJI in-camera layout)", async () => {
    const blob = loadSample("ramp_moov_at_end.mp4");
    if (!blob) return;
    const d = await StreamingDemuxer.open(blob);
    expect(d.samples.length).toBeGreaterThan(0);
    expect(d.videoTrack.durationUs).toBeGreaterThan(1e6);
  });

  it("keyframeIndexBefore finds the sync sample", async () => {
    const blob = loadSample("ramp_4k_hevc10.mp4");
    if (!blob) return;
    const d = await StreamingDemuxer.open(blob);
    expect(d.keyframeIndexBefore(0)).toBe(0);
    const mid = d.keyframeIndexBefore(1e6);
    expect(d.samples[mid]!.isSync).toBe(true);
    expect(d.samples[mid]!.ctsUs).toBeLessThanOrEqual(1e6);
  });
});
