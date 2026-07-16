/** DJI log/color profiles this app understands. Extensible enum — new DJI
 * cameras keep introducing profiles (D-Log M → D-Log → D-Log 2). */
export type ColorProfile =
  | "dlog" // Pocket 4 standard: true D-Log, official white-paper math
  | "dlog-m" // Pocket 3 / Action series: no official math, official .cube LUTs only
  | "dlog2" // Pocket 4P: D-Gamut2 covers BT.2020, community-reverse-engineered
  | "hlg" // BT.2100 HLG in Rec.2020 container
  | "rec709" // "Normal" mode, baked look
  | "unknown";

export type ClipStatus = "online" | "offline" | "deleted_on_device";
export type EditState = "none" | "graded" | "exported";
export type DeviceKind = "usb" | "sd" | "folder" | "rtmp";

export interface ClipMeta {
  id: string;
  contentHash: string;
  deviceId: string | null;
  importSessionId: string | null;
  fileName: string;
  /** Absolute path on the source device/folder (link mode) */
  srcPath: string | null;
  /** Path inside our managed library (copy mode) */
  libraryPath: string | null;
  /** Sibling .LRF 720p proxy, if paired */
  lrfPath: string | null;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  bitDepth: 8 | 10 | null;
  colorProfile: ColorProfile;
  /** Parsed from DJI_YYYYMMDDHHMMSS_xxxx filename, epoch ms */
  shotAt: number | null;
  importedAt: number;
  status: ClipStatus;
  editState: EditState;
  rating: number | null;
  tags: string[];
}

export interface DeviceInfo {
  id: string;
  kind: DeviceKind;
  modelHint: string | null;
  volumeUuid: string | null;
  label: string;
  rootPath: string;
  firstSeen: number;
  lastSeen: number;
}

/** Discriminated result type used across package boundaries instead of throw. */
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface AppError {
  code: string;
  message: string;
  cause?: unknown;
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = (code: string, message: string, cause?: unknown): Result<never> => ({
  ok: false,
  error: { code, message, ...(cause === undefined ? {} : { cause }) },
});
