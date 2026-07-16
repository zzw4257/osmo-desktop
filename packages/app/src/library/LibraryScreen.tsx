/// <reference path="./fsAccess.d.ts" />
import { tokens } from "@osmo/ui";
import { useCallback, useEffect, useState } from "react";
import { IdbGradeStore } from "../editor/gradeStore";
import type { LibraryClip } from "./scanFolder";
import { scanDirectory, scanFileList } from "./scanFolder";
import { thumbnailFor } from "./thumbs";

export interface LibraryScreenProps {
  onOpenClip: (clip: LibraryClip) => void;
}

const gradeStore = new IdbGradeStore();

export function LibraryScreen({ onOpenClip }: LibraryScreenProps) {
  const [clips, setClips] = useState<LibraryClip[]>([]);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gradedKeys, setGradedKeys] = useState<Set<string>>(new Set());
  const supportsFsAccess = typeof window.showDirectoryPicker === "function";

  useEffect(() => {
    void gradeStore.listKeys().then((keys) => setGradedKeys(new Set(keys)));
  }, [clips]);

  const pickFolder = useCallback(async () => {
    try {
      setBusy(true);
      const handle = await window.showDirectoryPicker!({ id: "osmo-library", mode: "read" });
      setFolderName((handle as unknown as { name?: string }).name ?? "已选文件夹");
      setClips(await scanDirectory(handle));
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 20px",
          borderBottom: `1px solid ${tokens.color.border}`,
        }}
      >
        <h1 style={{ color: tokens.color.accent, fontSize: 17, margin: 0, fontWeight: 700 }}>
          OSMO Desktop
        </h1>
        <span style={{ fontSize: 12, color: tokens.color.textDim }}>
          素材库{folderName ? ` · ${folderName}` : ""}
          {clips.length > 0 ? ` · ${clips.length} 个视频` : ""}
        </span>
        <div style={{ flex: 1 }} />
        {supportsFsAccess ? (
          <button onClick={pickFolder} style={primaryBtn} disabled={busy}>
            {busy ? "扫描中…" : "关联本地文件夹"}
          </button>
        ) : (
          <label style={primaryBtn}>
            关联本地文件夹
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

      {clips.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: tokens.color.textDim,
          }}
        >
          <span style={{ fontSize: 40 }}>🎞</span>
          <p style={{ fontSize: 14, margin: 0 }}>关联包含 DJI 素材的本地文件夹（如 SD 卡的 DCIM）</p>
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
          {clips.map((clip) => (
            <ClipCard
              key={clip.key}
              clip={clip}
              graded={gradedKeys.has(clip.key)}
              onOpen={() => onOpenClip(clip)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClipCard({ clip, graded, onOpen }: { clip: LibraryClip; graded: boolean; onOpen: () => void }) {
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
      style={{
        background: tokens.color.surface,
        borderRadius: tokens.radius.md,
        overflow: "hidden",
        cursor: "pointer",
        border: `1px solid ${tokens.color.border}`,
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
              color: tokens.color.textDim,
              fontSize: 20,
            }}
          >
            ▶
          </div>
        )}
        <div style={{ position: "absolute", top: 6, left: 6, display: "flex", gap: 4 }}>
          {clip.isDji && <Badge text="DJI" color={tokens.color.accent} />}
          {clip.hasLrf && <Badge text="LRF" color="#5cb2ff" />}
          {graded && <Badge text="已调色" color={tokens.color.good} />}
        </div>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={clip.name}
        >
          {clip.name}
        </div>
        <div style={{ fontSize: 10, color: tokens.color.textDim, marginTop: 2 }}>
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
        background: "rgba(0,0,0,0.65)",
        color,
        fontSize: 9,
        fontWeight: 700,
        borderRadius: 4,
        padding: "2px 5px",
        letterSpacing: 0.5,
      }}
    >
      {text}
    </span>
  );
}

const primaryBtn: React.CSSProperties = {
  background: tokens.color.accent,
  color: "#141414",
  fontWeight: 600,
  borderRadius: tokens.radius.sm,
  padding: "7px 16px",
  cursor: "pointer",
  fontSize: 13,
  border: "none",
};
