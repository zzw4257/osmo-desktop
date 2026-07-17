/**
 * The ONLY package that touches Tauri APIs. Every function is capability-
 * shaped: on the web it either has a browser implementation or reports
 * unavailability — callers branch on `isTauri()` / null returns, never on
 * user-agent sniffing. Tauri modules are imported dynamically so the web
 * bundle never pulls them in.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface NativeMediaEntry {
  path: string;
  name: string;
  relDir: string;
  size: number;
  lrfPath: string | null;
}

/** Native folder picker (desktop). Returns null when cancelled/unavailable. */
export async function pickFolderNative(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "选择素材文件夹" });
  return typeof picked === "string" ? picked : null;
}

/** Native save-path picker. */
export async function pickSavePathNative(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: defaultName,
    filters: [{ name: "MP4 视频", extensions: ["mp4"] }],
  });
  return picked ?? null;
}

export async function scanMediaDirNative(root: string): Promise<NativeMediaEntry[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NativeMediaEntry[]>("scan_media_dir", { root });
}

/** Read a native file into a Blob via the asset protocol (streamed by the
 * webview, not IPC-serialized). */
export async function readNativeFile(path: string): Promise<Blob> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const res = await fetch(convertFileSrc(path));
  if (!res.ok) throw new Error(`读取文件失败 (${res.status}): ${path}`);
  return res.blob();
}

export type ExportEvent =
  | { type: "progress"; frame: number }
  | { type: "done"; frames: number }
  | { type: "error"; message: string };

export interface NativeExportArgs {
  srcPath: string;
  outPath: string;
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  shaderWgsl: string;
  paramsB64: string;
  curvesB64: string;
  inputLutB64: string;
  inputLutSize: number;
  creativeLutB64: string;
  creativeLutSize: number;
}

export async function exportBeginNative(
  args: NativeExportArgs,
  onEvent: (ev: ExportEvent) => void,
): Promise<number> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<ExportEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("export_begin", { args, onEvent: channel });
}

export async function exportCancelNative(jobId: number): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("export_cancel", { jobId });
}
