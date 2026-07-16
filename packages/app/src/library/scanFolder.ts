/// <reference path="./fsAccess.d.ts" />
import { PROXY_EXT, VIDEO_EXTS, parseDjiFileName } from "@osmo/device-core";

export interface LibraryClip {
  key: string;
  name: string;
  /** Directory path within the scanned root, for display. */
  dir: string;
  size: number;
  shotAt: number | null;
  isDji: boolean;
  hasLrf: boolean;
  getFile(): Promise<File>;
  getLrf(): Promise<File | null>;
}

const MAX_DEPTH = 5;

/** Scan a directory handle (File System Access API path, Chrome/Edge). */
export async function scanDirectory(root: FileSystemDirectoryHandle): Promise<LibraryClip[]> {
  const files = new Map<string, FileSystemFileHandle>(); // path → handle
  await walk(root, "", 0, files);
  return buildClips(
    [...files.entries()].map(([path, handle]) => ({
      path,
      name: handle.name,
      size: null,
      open: () => handle.getFile(),
    })),
  );
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  depth: number,
  out: Map<string, FileSystemFileHandle>,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith(".")) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      await walk(entry as FileSystemDirectoryHandle, path, depth + 1, out);
    } else {
      out.set(path, entry as FileSystemFileHandle);
    }
  }
}

/** Fallback path: <input webkitdirectory> FileList (Safari/Firefox). */
export function scanFileList(files: FileList): Promise<LibraryClip[]> {
  return buildClips(
    [...files].map((f) => ({
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      name: f.name,
      size: f.size,
      open: () => Promise.resolve(f),
    })),
  );
}

interface RawEntry {
  path: string;
  name: string;
  size: number | null;
  open(): Promise<File>;
}

async function buildClips(entries: RawEntry[]): Promise<LibraryClip[]> {
  const byPath = new Map(entries.map((e) => [e.path.toLowerCase(), e]));
  const clips: LibraryClip[] = [];

  for (const e of entries) {
    const dot = e.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = e.name.slice(dot + 1).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) continue;

    // Strip ".<ext>" (the dot included) then look up "<stem>.lrf"
    const stemPath = e.path.slice(0, e.path.length - (e.name.length - dot));
    const lrfEntry = byPath.get(`${stemPath}.${PROXY_EXT}`.toLowerCase());
    const parsed = parseDjiFileName(e.name);
    const size = e.size ?? (await e.open()).size;

    clips.push({
      key: `${e.name}:${size}`,
      name: e.name,
      dir: e.path.slice(0, Math.max(0, e.path.length - e.name.length - 1)),
      size,
      shotAt: parsed?.shotAt ?? null,
      isDji: parsed !== null,
      hasLrf: !!lrfEntry,
      getFile: e.open,
      getLrf: lrfEntry ? lrfEntry.open : () => Promise.resolve(null),
    });
  }

  clips.sort((a, b) => (b.shotAt ?? 0) - (a.shotAt ?? 0) || a.name.localeCompare(b.name));
  return clips;
}
