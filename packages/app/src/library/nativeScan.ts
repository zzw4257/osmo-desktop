import { parseDjiFileName } from "@osmo/device-core";
import { readNativeFile, scanMediaDirNative } from "@osmo/platform";
import type { LibraryClip } from "./scanFolder";

/** Desktop path: Rust walks the folder, we interpret DJI naming here. */
export async function scanNativeFolder(root: string): Promise<LibraryClip[]> {
  const entries = await scanMediaDirNative(root);
  const clips: LibraryClip[] = entries.map((e) => {
    const parsed = parseDjiFileName(e.name);
    return {
      key: `${e.name}:${e.size}`,
      name: e.name,
      dir: e.relDir,
      size: e.size,
      shotAt: parsed?.shotAt ?? null,
      isDji: parsed !== null,
      hasLrf: e.lrfPath !== null,
      srcPath: e.path,
      lrfSrcPath: e.lrfPath,
      getFile: () => readNativeFile(e.path),
      getLrf: () => (e.lrfPath ? readNativeFile(e.lrfPath) : Promise.resolve(null)),
    };
  });
  clips.sort((a, b) => (b.shotAt ?? 0) - (a.shotAt ?? 0) || a.name.localeCompare(b.name));
  return clips;
}
