/**
 * DJI DCIM structure knowledge: filename parsing, folder fingerprinting,
 * LRF proxy pairing. Pure functions — platform layer feeds in listings.
 *
 * Verified facts (research, to be re-checked against the real Pocket 4 in
 * the M2 hardware validation round):
 * - Media lives in DCIM/DJI_001/ (DJI_002… once a folder fills up)
 * - Files are named DJI_YYYYMMDDHHMMSS_NNNN_D.<ext>
 * - Every video has a sibling 720p H.264 .LRF proxy with the same stem
 */

export interface ParsedDjiName {
  shotAt: number; // epoch ms, camera-local time
  sequence: number;
  suffix: string; // trailing token, "D" on Pocket-series files
  ext: string; // lowercase, without dot
}

const DJI_NAME_RE = /^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(\d{4})_([A-Za-z0-9]+)\.([A-Za-z0-9]+)$/;

export function parseDjiFileName(fileName: string): ParsedDjiName | null {
  const m = DJI_NAME_RE.exec(fileName);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, seq, suffix, ext] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  if (Number.isNaN(date.getTime())) return null;
  return {
    shotAt: date.getTime(),
    sequence: Number(seq),
    suffix: suffix!,
    ext: ext!.toLowerCase(),
  };
}

export const VIDEO_EXTS = new Set(["mp4", "mov"]);
export const PHOTO_EXTS = new Set(["jpg", "jpeg", "dng"]);
export const PROXY_EXT = "lrf";

/** DCIM media folder pattern, kept deliberately loose (DJI_001, DJI_002…). */
export const DJI_MEDIA_DIR_RE = /^DJI_\d{3}$/;

export interface FolderFingerprint {
  isDjiDevice: boolean;
  mediaDirs: string[];
  /** Fraction of files in media dirs that match the DJI naming scheme. */
  namingConfidence: number;
}

/**
 * Decide whether a mounted volume looks like a DJI camera/SD card.
 * `listing` maps a relative dir path (e.g. "DCIM/DJI_001") to its file names.
 */
export function fingerprintVolume(listing: Map<string, string[]>): FolderFingerprint {
  const mediaDirs: string[] = [];
  let matched = 0;
  let total = 0;
  for (const [dir, files] of listing) {
    const parts = dir.split("/");
    if (parts.length !== 2 || parts[0] !== "DCIM" || !DJI_MEDIA_DIR_RE.test(parts[1]!)) continue;
    mediaDirs.push(dir);
    for (const f of files) {
      total++;
      if (parseDjiFileName(f)) matched++;
    }
  }
  const namingConfidence = total === 0 ? 0 : matched / total;
  return {
    isDjiDevice: mediaDirs.length > 0 && namingConfidence >= 0.5,
    mediaDirs,
    namingConfidence,
  };
}

/** Pair main videos with their .LRF proxies. Returns fileName → lrfName. */
export function pairLrfProxies(files: string[]): Map<string, string> {
  const byStem = new Map<string, { main?: string; lrf?: string }>();
  for (const f of files) {
    const dot = f.lastIndexOf(".");
    if (dot < 0) continue;
    const stem = f.slice(0, dot);
    const ext = f.slice(dot + 1).toLowerCase();
    const entry = byStem.get(stem) ?? {};
    if (VIDEO_EXTS.has(ext)) entry.main = f;
    else if (ext === PROXY_EXT) entry.lrf = f;
    byStem.set(stem, entry);
  }
  const pairs = new Map<string, string>();
  for (const { main, lrf } of byStem.values()) {
    if (main && lrf) pairs.set(main, lrf);
  }
  return pairs;
}
