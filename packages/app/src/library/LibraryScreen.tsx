/// <reference path="./fsAccess.d.ts" />
import type { DjiVolume } from "@osmo/platform";
import {
  defaultLibraryDir,
  deleteMediaFilesNative,
  importCopyNative,
  isTauri,
  listDjiVolumes,
  onDjiVolumesChanged,
  pickFolderNative,
} from "@osmo/platform";
import {
  Button,
  CameraDeviceIcon,
  CloseIcon,
  FilmIcon,
  FolderIcon,
  TrashIcon,
  tokens,
} from "@osmo/ui";
import { useCallback, useEffect, useState } from "react";
import { IdbGradeStore } from "../editor/gradeStore";
import {
  ensureFsaPermission,
  loadActiveSource,
  loadExportedKeys,
  saveActiveSource,
} from "./libraryStore";
import { scanNativeFolder } from "./nativeScan";
import type { LibraryClip } from "./scanFolder";
import { scanDirectory, scanFileList } from "./scanFolder";
import { thumbnailFor } from "./thumbs";

export interface LibraryScreenProps {
  onOpenClip: (clip: LibraryClip) => void;
  onOpenMonitor: () => void;
}

const gradeStore = new IdbGradeStore();

export function LibraryScreen({ onOpenClip, onOpenMonitor }: LibraryScreenProps) {
  const [clips, setClips] = useState<LibraryClip[]>([]);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gradedKeys, setGradedKeys] = useState<Set<string>>(new Set());
  const [volumes, setVolumes] = useState<DjiVolume[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteReport, setDeleteReport] = useState<string | null>(null);
  const [exportedKeys, setExportedKeys] = useState<Set<string>>(new Set());
  const supportsPicker = isTauri() || typeof window.showDirectoryPicker === "function";

  useEffect(() => {
    void gradeStore.listKeys().then((keys) => setGradedKeys(new Set(keys)));
    void loadExportedKeys().then(setExportedKeys);
  }, [clips]);

  // Restore the last folder association on launch (both shells).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const source = await loadActiveSource().catch(() => null);
      if (!source || !alive) return;
      try {
        setBusy(true);
        if (source.kind === "native" && isTauri()) {
          setFolderName(source.name);
          setClips(await scanNativeFolder(source.path));
        } else if (source.kind === "fsa" && (await ensureFsaPermission(source.handle))) {
          setFolderName(source.name);
          setClips(await scanDirectory(source.handle));
        }
      } catch {
        // stale association (folder moved / permission denied) — start empty
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // DJI device plug/unplug (desktop only)
  useEffect(() => {
    if (!isTauri()) return;
    let unsub: (() => void) | null = null;
    void listDjiVolumes().then(setVolumes);
    void onDjiVolumesChanged(setVolumes).then((u) => (unsub = u));
    return () => unsub?.();
  }, []);

  const browseVolume = useCallback(async (vol: DjiVolume) => {
    setBusy(true);
    setFolderName(`${vol.name}（DJI 设备）`);
    setClips(await scanNativeFolder(vol.path));
    setSelected(new Set());
    setBusy(false);
  }, []);

  const toggleSelect = useCallback((key: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const importSelected = useCallback(async () => {
    const targets = clips.filter((c) => selected.has(c.key) && c.srcPath);
    if (targets.length === 0) return;
    setBusy(true);
    setDeleteReport(`导入中… 0/${targets.length}`);
    try {
      const destDir = await defaultLibraryDir();
      let handled = 0;
      await new Promise<void>((resolve) => {
        void importCopyNative(
          targets.map((c) => ({ srcPath: c.srcPath!, lrfPath: c.lrfSrcPath })),
          destDir,
          (ev) => {
            if (ev.type === "file") {
              handled++;
              setDeleteReport(`导入中… ${handled} 个文件（${ev.name}: ${ev.status}）`);
            } else {
              setDeleteReport(
                `已导入 ${ev.copied} 个文件（跳过 ${ev.skipped} 个已存在${
                  ev.failed ? `，失败 ${ev.failed} 个` : ""
                }）→ ${ev.destDir}`,
              );
              // Switch the library to the managed folder — clip keys are
              // name:size, so grades/badges follow the copies seamlessly.
              void (async () => {
                setClips(await scanNativeFolder(ev.destDir));
                const name = ev.destDir.split("/").pop() ?? ev.destDir;
                setFolderName(name);
                void saveActiveSource({ kind: "native", path: ev.destDir, name });
                setSelected(new Set());
                resolve();
              })();
            }
          },
        );
      });
    } catch (e) {
      setDeleteReport(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [clips, selected]);

  const deleteSelected = useCallback(async () => {
    const targets = clips.filter((c) => selected.has(c.key) && c.srcPath);
    if (targets.length === 0) return;
    const totalMb = targets.reduce((s, c) => s + c.size, 0) / 1e6;
    const ok = window.confirm(
      `确认从设备删除 ${targets.length} 个视频（${totalMb.toFixed(0)}MB）？\n` +
        `将同时删除配对的 .LRF 代理，此操作不可恢复。\n\n` +
        targets.slice(0, 8).map((c) => `· ${c.name}`).join("\n") +
        (targets.length > 8 ? `\n· …等 ${targets.length} 个` : ""),
    );
    if (!ok) return;
    setBusy(true);
    const results = await deleteMediaFilesNative(
      targets.map((c) => ({ path: c.srcPath!, expectedSize: c.size })),
    );
    const failed = results.filter((r) => !r.ok);
    const okCount = results.length - failed.length;
    setDeleteReport(
      failed.length === 0
        ? `已删除 ${okCount} 个视频`
        : `已删除 ${okCount} 个；${failed.length} 个被跳过：${failed
            .map((f) => f.error)
            .slice(0, 3)
            .join("；")}`,
    );
    const okPaths = new Set(results.filter((r) => r.ok).map((r) => r.path));
    setClips((cs) => cs.filter((c) => !c.srcPath || !okPaths.has(c.srcPath)));
    setSelected(new Set());
    setBusy(false);
  }, [clips, selected]);

  const pickFolder = useCallback(async () => {
    try {
      setBusy(true);
      if (isTauri()) {
        const root = await pickFolderNative();
        if (root) {
          const name = root.split("/").pop() ?? root;
          setFolderName(name);
          setClips(await scanNativeFolder(root));
          void saveActiveSource({ kind: "native", path: root, name });
        }
        return;
      }
      const handle = await window.showDirectoryPicker!({ id: "osmo-library", mode: "read" });
      const name = (handle as unknown as { name?: string }).name ?? "已选文件夹";
      setFolderName(name);
      setClips(await scanDirectory(handle));
      void saveActiveSource({ kind: "fsa", handle, name });
    } catch {
      // user cancelled
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFolderFallback = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setBusy(true);
    setFolderName("已选文件夹");
    setClips(await scanFileList(e.target.files));
    setBusy(false);
  }, []);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: tokens.color.bg,
        color: tokens.color.text,
        fontFamily: tokens.font.family,
      }}
    >
      <header
        className="osmo-glass"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "13px 22px",
          borderBottom: `1px solid ${tokens.color.border}`,
          boxShadow: `0 8px 24px rgba(0,0,0,0.3), inset 0 1px 0 ${tokens.color.hairlineLight}`,
          position: "relative",
          zIndex: 1,
        }}
      >
        <h1 style={{ color: tokens.color.accent, fontSize: 16, margin: 0, fontWeight: 700, letterSpacing: 0.2 }}>
          OSMO Desktop
        </h1>
        <span style={{ fontSize: 12, color: tokens.color.textDim }}>
          素材库{folderName ? ` · ${folderName}` : ""}
          {clips.length > 0 ? ` · ${clips.length} 个视频` : ""}
        </span>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onOpenMonitor} icon={<CameraDeviceIcon size={15} />}
          title="相机网络摄像头模式实时监看（带调色与示波器）">
          监看
        </Button>
        {selected.size > 0 && (
          <>
            <Button variant="primary" onClick={() => void importSelected()} disabled={busy}>
              导入素材库（{selected.size}）
            </Button>
            <Button variant="danger" onClick={() => void deleteSelected()} disabled={busy}
              icon={<TrashIcon size={14} />}>
              删除所选（{selected.size}）
            </Button>
          </>
        )}
        {supportsPicker ? (
          <Button
            variant="primary"
            onClick={pickFolder}
            disabled={busy}
            icon={<FolderIcon size={14} />}
            className={clips.length === 0 && volumes.length === 0 ? "osmo-pulse-cta" : ""}
          >
            {busy ? "扫描中…" : "关联本地文件夹"}
          </Button>
        ) : (
          <label style={{ cursor: "pointer" }}>
            <Button
              as="span"
              variant="primary"
              icon={<FolderIcon size={14} />}
              className={clips.length === 0 && volumes.length === 0 ? "osmo-pulse-cta" : ""}
            >
              关联本地文件夹
            </Button>
            <input
              type="file"
              // @ts-expect-error non-standard but universally supported
              webkitdirectory=""
              multiple
              hidden
              onChange={pickFolderFallback}
            />
          </label>
        )}
      </header>

      {volumes.length > 0 && (
        <div
          className="osmo-fade-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 22px",
            background: tokens.color.accentWash,
            borderBottom: `1px solid ${tokens.color.border}`,
            fontSize: 13,
          }}
        >
          <CameraDeviceIcon size={16} color={tokens.color.accent} />
          <span>
            检测到 DJI 设备：<strong>{volumes.map((v) => v.name).join("、")}</strong>
          </span>
          {volumes.map((v) => (
            <Button key={v.path} variant="primary" size="sm" onClick={() => void browseVolume(v)} disabled={busy}>
              浏览 {v.name}
            </Button>
          ))}
        </div>
      )}
      {deleteReport && (
        <div
          className="osmo-fade-in"
          style={{
            padding: "9px 22px",
            fontSize: 12,
            color: tokens.color.textDim,
            borderBottom: `1px solid ${tokens.color.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{deleteReport}</span>
          <Button variant="ghost" size="icon" onClick={() => setDeleteReport(null)} style={{ width: 24, height: 24 }}>
            <CloseIcon size={13} />
          </Button>
        </div>
      )}

      {clips.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: tokens.color.textDim,
            background: "radial-gradient(ellipse 60% 50% at 50% 45%, #0d0d0f 0%, transparent 70%)",
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: tokens.color.surface,
              boxShadow: `${tokens.shadow.card}, inset 0 1px 0 ${tokens.color.hairlineLight}`,
              marginBottom: 6,
            }}
          >
            <FilmIcon size={30} color={tokens.color.textFaint} />
          </div>
          <p style={{ fontSize: 14, margin: 0, color: tokens.color.text, fontWeight: 500 }}>
            关联包含 DJI 素材的本地文件夹（如 SD 卡的 DCIM）
          </p>
          <p style={{ fontSize: 12, margin: 0, opacity: 0.7 }}>
            识别 DJI 命名的视频并自动配对 .LRF 代理用于快速预览
          </p>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 14,
            padding: 20,
            alignContent: "start",
          }}
        >
          {clips.map((clip, i) => (
            <ClipCard
              key={clip.key}
              clip={clip}
              graded={gradedKeys.has(clip.key)}
              exported={exportedKeys.has(clip.key)}
              selected={selected.has(clip.key)}
              selectable={clip.srcPath !== null && isTauri()}
              onToggleSelect={() => toggleSelect(clip.key)}
              onOpen={() => onOpenClip(clip)}
              staggerMs={Math.min(i, 12) * 30}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClipCard({
  clip,
  graded,
  exported,
  selected,
  selectable,
  onToggleSelect,
  onOpen,
  staggerMs,
}: {
  clip: LibraryClip;
  graded: boolean;
  exported: boolean;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  staggerMs: number;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void thumbnailFor(clip).then((t) => alive && setThumb(t));
    return () => {
      alive = false;
    };
  }, [clip]);

  return (
    <div
      onClick={onOpen}
      className="osmo-card osmo-fade-in"
      style={{
        background: tokens.color.surface,
        borderRadius: tokens.radius.md,
        overflow: "hidden",
        cursor: "pointer",
        border: `1px solid ${tokens.color.border}`,
        animationDelay: `${staggerMs}ms`,
        animationFillMode: "backwards",
      }}
    >
      <div style={{ aspectRatio: "16/9", background: "#000", position: "relative" }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: tokens.color.textFaint,
            }}
          >
            <FilmIcon size={22} />
          </div>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 30%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "absolute", top: 7, left: 7, display: "flex", gap: 4 }}>
          {clip.isDji && <Badge text="DJI" color={tokens.color.accent} />}
          {clip.hasLrf && <Badge text="LRF" color="#5cb2ff" />}
          {graded && <Badge text="已调色" color={tokens.color.good} />}
          {exported && <Badge text="已导出" color="#c894ff" />}
        </div>
        {selectable && (
          <input
            type="checkbox"
            className="osmo-check"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggleSelect}
            title="选择以删除"
            style={{ position: "absolute", top: 7, right: 7 }}
          />
        )}
      </div>
      <div style={{ padding: "9px 11px" }}>
        <div
          style={{
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontWeight: 500,
          }}
          title={clip.name}
        >
          {clip.name}
        </div>
        <div style={{ fontSize: 10.5, color: tokens.color.textFaint, marginTop: 3 }}>
          {clip.shotAt ? new Date(clip.shotAt).toLocaleString("zh-CN") : "—"} ·{" "}
          {(clip.size / 1e6).toFixed(0)}MB
        </div>
      </div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        background: "rgba(10,10,11,0.72)",
        backdropFilter: "blur(4px)",
        color,
        fontSize: 9,
        fontWeight: 700,
        borderRadius: 4,
        padding: "2.5px 6px",
        letterSpacing: 0.4,
      }}
    >
      {text}
    </span>
  );
}
