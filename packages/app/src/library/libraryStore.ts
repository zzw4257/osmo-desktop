import { STORE_LIBRARY, idbGet, idbPut } from "../store/idb";

/**
 * Library persistence shared by both shells: the active folder association
 * (so the library survives restarts) and per-clip lifecycle state (graded →
 * exported badges driven from one place).
 */
export type LibrarySource =
  | { kind: "native"; path: string; name: string }
  | { kind: "fsa"; handle: FileSystemDirectoryHandle; name: string };

export type ClipLifecycle = "exported";

const SOURCE_KEY = "activeSource";
const CLIP_PREFIX = "clip:";

export async function saveActiveSource(source: LibrarySource): Promise<void> {
  // FileSystemDirectoryHandle is structured-clonable — persists fine.
  await idbPut(STORE_LIBRARY, SOURCE_KEY, source);
}

export async function loadActiveSource(): Promise<LibrarySource | null> {
  return idbGet<LibrarySource>(STORE_LIBRARY, SOURCE_KEY);
}

export async function markClipExported(clipKey: string, outPath: string): Promise<void> {
  await idbPut(STORE_LIBRARY, CLIP_PREFIX + clipKey, {
    state: "exported" satisfies ClipLifecycle,
    outPath,
    at: Date.now(),
  });
}

export async function loadExportedKeys(): Promise<Set<string>> {
  const { idbKeys } = await import("../store/idb");
  const keys = await idbKeys(STORE_LIBRARY);
  return new Set(
    keys.filter((k) => k.startsWith(CLIP_PREFIX)).map((k) => k.slice(CLIP_PREFIX.length)),
  );
}

/** Re-request read permission on a persisted FSA handle (Chrome shows a
 * lightweight prompt; returns false when the user declines). */
export async function ensureFsaPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?(d: { mode: string }): Promise<string>;
    requestPermission?(d: { mode: string }): Promise<string>;
  };
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "read" })) === "granted") return true;
  return (await h.requestPermission?.({ mode: "read" })) === "granted";
}
