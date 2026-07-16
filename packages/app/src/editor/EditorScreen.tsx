import type { Grade } from "@osmo/color-engine";
import { defaultGrade } from "@osmo/color-engine";
import { tokens } from "@osmo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdjustPanel } from "./AdjustPanel";
import { IdbGradeStore, clipKeyForFile } from "./gradeStore";
import { useEditorEngine } from "./useEditorEngine";

const gradeStore = new IdbGradeStore();

export interface EditorScreenProps {
  /** Open with this clip (from the library); user can still 打开视频. */
  initialClip?: { file: File; key: string; name: string } | undefined;
  onBack?: (() => void) | undefined;
}

export function EditorScreen({ initialClip, onBack }: EditorScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const engine = useEditorEngine(canvasRef);
  const [grade, setGrade] = useState<Grade>(() => defaultGrade());
  const [clipKey, setClipKey] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showScopes, setShowScopes] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (engine.ready) {
      engine.attachScopes(showScopes ? histRef.current : null, showScopes ? waveRef.current : null);
    }
  }, [engine, engine.ready, showScopes]);

  // Grade → engine + debounced persistence
  const updateGrade = useCallback(
    (next: Grade) => {
      setGrade(next);
      engine.applyGrade(next);
      if (clipKey) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void gradeStore.save(clipKey, next), 400);
      }
    },
    [engine, clipKey],
  );

  const openClip = useCallback(
    async (file: File, key: string, name: string) => {
      setFileName(name);
      setClipKey(key);
      const restored = (await gradeStore.load(key)) ?? defaultGrade();
      setGrade(restored);
      engine.applyGrade(restored);
      await engine.loadFile(file);
    },
    [engine],
  );

  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await openClip(file, clipKeyForFile(file), file.name);
    },
    [openClip],
  );

  // Clip handed over from the library
  const initialLoaded = useRef(false);
  useEffect(() => {
    if (initialClip && engine.ready && !initialLoaded.current) {
      initialLoaded.current = true;
      void openClip(initialClip.file, initialClip.key, initialClip.name);
    }
  }, [initialClip, engine.ready, openClip]);

  // Keyboard transport: space = play/pause, arrows = step/seek
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (engine.stats?.state === "playing") engine.pause();
        else engine.play();
      } else if (e.code === "ArrowRight") {
        engine.stepForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  const stats = engine.stats;
  const playing = stats?.state === "playing";
  const durationUs = stats?.durationUs ?? 0;
  const positionUs = stats?.positionUs ?? 0;

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: tokens.color.bg,
        color: tokens.color.text,
        fontFamily: tokens.font.family,
        overflow: "hidden",
      }}
    >
      {/* main viewer column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            borderBottom: `1px solid ${tokens.color.border}`,
          }}
        >
          {onBack && (
            <button onClick={onBack} style={transportBtn} title="返回素材库">
              ←
            </button>
          )}
          <h1 style={{ color: tokens.color.accent, fontSize: 16, margin: 0, fontWeight: 700 }}>
            OSMO Desktop
          </h1>
          <span style={{ fontSize: 12, color: tokens.color.textDim }}>
            {fileName ?? "未加载素材"}
          </span>
          <div style={{ flex: 1 }} />
          <label
            style={{
              background: tokens.color.accent,
              color: "#141414",
              fontWeight: 600,
              borderRadius: tokens.radius.sm,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            打开视频
            <input type="file" accept="video/mp4,video/quicktime" hidden onChange={onPickFile} />
          </label>
        </header>

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            minHeight: 0,
          }}
        >
          <canvas
            ref={canvasRef}
            width={1920}
            height={1080}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              aspectRatio: "16/9",
              background: "#000",
              borderRadius: tokens.radius.md,
            }}
          />
        </div>

        {/* scopes strip */}
        {showScopes && (
          <div
            style={{
              display: "flex",
              gap: 12,
              padding: "8px 16px 0",
              alignItems: "flex-end",
            }}
          >
            <figure style={scopeFigure}>
              <canvas ref={histRef} width={256} height={110} style={scopeCanvas} />
              <figcaption style={scopeCaption}>直方图 RGB</figcaption>
            </figure>
            <figure style={scopeFigure}>
              <canvas ref={waveRef} width={512} height={110} style={{ ...scopeCanvas, width: 320 }} />
              <figcaption style={scopeCaption}>波形 · 亮度</figcaption>
            </figure>
          </div>
        )}

        {/* transport bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            borderTop: `1px solid ${tokens.color.border}`,
          }}
        >
          <button onClick={() => (playing ? engine.pause() : engine.play())} style={transportBtn}>
            {playing ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => setShowScopes(!showScopes)}
            style={{ ...transportBtn, color: showScopes ? tokens.color.accent : tokens.color.textDim }}
            title="示波器"
          >
            📊
          </button>
          <button onClick={engine.stepForward} style={transportBtn} title="逐帧 →">
            ⏭
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(durationUs, 1)}
            value={positionUs}
            onChange={(e) => engine.seek(Number(e.target.value))}
            style={{ flex: 1, accentColor: tokens.color.accent }}
          />
          <span style={{ fontSize: 11, fontFamily: tokens.font.mono, color: tokens.color.textDim }}>
            {fmtUs(positionUs)} / {fmtUs(durationUs)}
          </span>
          <span style={{ fontSize: 11, fontFamily: tokens.font.mono, color: tokens.color.textDim }}>
            {stats ? `${stats.presentedFps}fps` : ""}
          </span>
        </div>
        {engine.error && (
          <div style={{ color: tokens.color.bad, padding: "4px 16px", fontSize: 12 }}>{engine.error}</div>
        )}
      </div>

      {/* right adjust panel */}
      <aside
        style={{
          width: 300,
          borderLeft: `1px solid ${tokens.color.border}`,
          display: "flex",
          flexDirection: "column",
          background: tokens.color.surface,
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 700,
            borderBottom: `1px solid ${tokens.color.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          调色
          <button
            onClick={() => updateGrade({ ...defaultGrade(grade.input.profile) })}
            style={{
              background: "none",
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.textDim,
              borderRadius: 999,
              fontSize: 11,
              padding: "2px 10px",
              cursor: "pointer",
            }}
          >
            全部重置
          </button>
        </div>
        <AdjustPanel
          grade={grade}
          onChange={updateGrade}
          onPickCreativeLut={(f) => void engine.loadCreativeLut(f)}
          onPickInputLut={(f) => void engine.loadInputLut(f)}
        />
      </aside>
    </div>
  );
}

const scopeFigure: React.CSSProperties = { margin: 0 };

const scopeCanvas: React.CSSProperties = {
  width: 200,
  height: 90,
  background: "#000",
  borderRadius: 6,
  border: `1px solid ${tokens.color.border}`,
  display: "block",
};

const scopeCaption: React.CSSProperties = {
  fontSize: 10,
  color: tokens.color.textDim,
  marginTop: 2,
};

const transportBtn: React.CSSProperties = {
  background: tokens.color.surfaceRaised,
  color: tokens.color.text,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.sm,
  width: 36,
  height: 30,
  cursor: "pointer",
  fontSize: 14,
};

function fmtUs(us: number): string {
  const s = Math.floor(us / 1e6);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
