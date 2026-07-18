import type { Cube3dLut, Grade } from "@osmo/color-engine";
import { buildExportPayload, defaultGrade, parseCube } from "@osmo/color-engine";
import { exportBeginNative, exportCancelNative, isTauri, pickSavePathNative } from "@osmo/platform";
import {
  BackIcon,
  Button,
  CheckIcon,
  CloseIcon,
  PauseIcon,
  PlayIcon,
  RedoIcon,
  ScopesIcon,
  StepForwardIcon,
  UndoIcon,
  tokens,
} from "@osmo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { markClipExported } from "../library/libraryStore";
import { AdjustPanel } from "./AdjustPanel";
import { IdbGradeStore, clipKeyForFile } from "./gradeStore";
import { saveBlobAs, webExport } from "./webExport";
import type { LoadedClipInfo } from "./useEditorEngine";
import { useEditorEngine } from "./useEditorEngine";

const gradeStore = new IdbGradeStore();

export interface EditorScreenProps {
  /** Open with this clip (from the library); user can still 打开视频. */
  initialClip?:
    | { file: Blob; key: string; name: string; srcPath: string | null; lrf: Blob | null }
    | undefined;
  onBack?: (() => void) | undefined;
}

interface ExportState {
  jobId: number | null;
  frame: number;
  totalFrames: number;
  status: "running" | "done" | "error";
  message?: string;
  outPath: string;
  /** e.g. "HEVC 10-bit（原生）" / "H.264 8-bit（网页）" — fidelity honesty. */
  note?: string;
}

export function EditorScreen({ initialClip, onBack }: EditorScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const vecRef = useRef<HTMLCanvasElement>(null);
  const engine = useEditorEngine(canvasRef);
  const [grade, setGrade] = useState<Grade>(() => defaultGrade());
  const [clipKey, setClipKey] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showScopes, setShowScopes] = useState(true);
  const [clipInfo, setClipInfo] = useState<LoadedClipInfo | null>(null);
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [inputCube, setInputCube] = useState<Cube3dLut | null>(null);
  const [creativeCube, setCreativeCube] = useState<Cube3dLut | null>(null);
  const [exportState, setExportState] = useState<ExportState | null>(null);
  /** Non-null while the user drags the seek bar (proxy scrub in flight). */
  const [dragUs, setDragUs] = useState<number | null>(null);
  const fileRef = useRef<Blob | null>(null);
  const webCancelRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<Grade[]>([]);
  const futureRef = useRef<Grade[]>([]);
  const lastPushRef = useRef(0);
  const gradeRef = useRef(grade);
  gradeRef.current = grade;

  useEffect(() => {
    if (engine.ready) {
      engine.attachScopes(
        showScopes ? histRef.current : null,
        showScopes ? waveRef.current : null,
        showScopes ? vecRef.current : null,
      );
    }
  }, [engine, engine.ready, showScopes]);

  // Grade → engine + debounced persistence (grade + undo history)
  const persistSoon = useCallback(
    (next: Grade) => {
      if (!clipKey) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void gradeStore.save(clipKey, next);
        void gradeStore.saveHistory(clipKey, historyRef.current);
      }, 400);
    },
    [clipKey],
  );

  const updateGrade = useCallback(
    (next: Grade) => {
      // Coalesce rapid slider drags into one undo step (400ms window)
      const now = performance.now();
      if (now - lastPushRef.current > 400) {
        historyRef.current.push(gradeRef.current);
        if (historyRef.current.length > 40) historyRef.current.shift();
        futureRef.current = [];
      }
      lastPushRef.current = now;
      setGrade(next);
      engine.applyGrade(next);
      persistSoon(next);
    },
    [engine, persistSoon],
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    futureRef.current.push(gradeRef.current);
    lastPushRef.current = 0;
    setGrade(prev);
    engine.applyGrade(prev);
    persistSoon(prev);
  }, [engine, persistSoon]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(gradeRef.current);
    lastPushRef.current = 0;
    setGrade(next);
    engine.applyGrade(next);
    persistSoon(next);
  }, [engine, persistSoon]);

  const openClip = useCallback(
    async (file: Blob, key: string, name: string, src: string | null, lrf: Blob | null) => {
      setFileName(name);
      setClipKey(key);
      setSrcPath(src);
      fileRef.current = file;
      const restored = (await gradeStore.load(key)) ?? defaultGrade();
      historyRef.current = await gradeStore.loadHistory(key);
      futureRef.current = [];
      lastPushRef.current = 0;
      setGrade(restored);
      engine.applyGrade(restored);
      setClipInfo(await engine.loadFile(file));
      await engine.attachScrubProxy(lrf);
    },
    [engine],
  );

  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await openClip(file, clipKeyForFile(file), file.name, null, null);
    },
    [openClip],
  );

  // Clip handed over from the library
  const initialLoaded = useRef(false);
  useEffect(() => {
    if (initialClip && engine.ready && !initialLoaded.current) {
      initialLoaded.current = true;
      void openClip(
        initialClip.file,
        initialClip.key,
        initialClip.name,
        initialClip.srcPath,
        initialClip.lrf,
      );
    }
  }, [initialClip, engine.ready, openClip]);

  const onPickInputLut = useCallback(
    async (file: File) => {
      const cube = parseCube(await file.text());
      setInputCube(cube);
      engine.applyInputLut(cube);
    },
    [engine],
  );

  const onPickCreativeLut = useCallback(
    async (file: File) => {
      const cube = parseCube(await file.text());
      setCreativeCube(cube);
      engine.applyCreativeLut(cube);
    },
    [engine],
  );

  const canNativeExport = isTauri() && srcPath !== null && clipInfo !== null && fileName !== null;
  const canWebExport = !isTauri() && clipInfo !== null && fileName !== null;
  const canExport = canNativeExport || canWebExport;

  const onWebExport = useCallback(async () => {
    const file = fileRef.current;
    if (!file || !clipInfo || !fileName) return;
    webCancelRef.current = false;
    const outName = fileName.replace(/\.\w+$/, "") + "_graded.mp4";
    setExportState({
      jobId: null,
      frame: 0,
      totalFrames: Math.max(1, Math.round((clipInfo.durationUs / 1e6) * clipInfo.fps)),
      status: "running",
      outPath: outName,
      note: "网页端导出 · 10-bit 保真请用桌面版",
    });
    try {
      const result = await webExport(
        file,
        grade,
        inputCube,
        creativeCube,
        (p) => setExportState((s) => (s ? { ...s, frame: p.frame, totalFrames: p.totalFrames } : s)),
        () => webCancelRef.current,
      );
      await saveBlobAs(result.blob, outName);
      setExportState((s) =>
        s
          ? {
              ...s,
              frame: result.frames,
              totalFrames: result.frames,
              status: "done",
              note: `${result.codecLabel}（网页编码）`,
            }
          : s,
      );
      if (clipKey) void markClipExported(clipKey, outName);
    } catch (e) {
      setExportState((s) =>
        s ? { ...s, status: "error", message: e instanceof Error ? e.message : String(e) } : s,
      );
    }
  }, [clipInfo, fileName, grade, inputCube, creativeCube, clipKey]);

  const onExport = useCallback(async () => {
    if (!srcPath || !clipInfo || !fileName) return;
    const outPath = await pickSavePathNative(fileName.replace(/\.\w+$/, "") + "_graded.mp4");
    if (!outPath) return;
    const payload = buildExportPayload(grade, inputCube, creativeCube);
    const totalFrames = Math.max(1, Math.round((clipInfo.durationUs / 1e6) * clipInfo.fps));
    setExportState({ jobId: null, frame: 0, totalFrames, status: "running", outPath });
    try {
      const jobId = await exportBeginNative(
        {
          srcPath,
          outPath,
          width: clipInfo.width,
          height: clipInfo.height,
          fps: clipInfo.fps,
          bitrateMbps: 50,
          ...payload,
        },
        (ev) => {
          if (ev.type === "progress") {
            setExportState((s) => (s ? { ...s, frame: ev.frame } : s));
          } else if (ev.type === "done") {
            setExportState((s) =>
              s ? { ...s, frame: ev.frames, totalFrames: ev.frames, status: "done" } : s,
            );
            if (clipKey) void markClipExported(clipKey, outPath);
          } else {
            setExportState((s) => (s ? { ...s, status: "error", message: ev.message } : s));
          }
        },
      );
      setExportState((s) => (s ? { ...s, jobId } : s));
    } catch (e) {
      setExportState((s) => (s ? { ...s, status: "error", message: String(e) } : s));
    }
  }, [srcPath, clipInfo, fileName, grade, inputCube, creativeCube, clipKey]);

  // Keyboard: space = play/pause, → = step, ⌘Z/⇧⌘Z = undo/redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
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
  }, [engine, undo, redo]);

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
            gap: 14,
            padding: "10px 18px",
            borderBottom: `1px solid ${tokens.color.border}`,
            background: tokens.color.surface,
          }}
        >
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} title="返回素材库">
              <BackIcon size={16} />
            </Button>
          )}
          <h1
            style={{
              color: tokens.color.accent,
              fontSize: 15,
              margin: 0,
              fontWeight: 700,
              letterSpacing: 0.2,
            }}
          >
            OSMO Desktop
          </h1>
          <span
            style={{
              fontSize: 12,
              color: tokens.color.textDim,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 260,
            }}
          >
            {fileName ?? "未加载素材"}
          </span>
          <div style={{ flex: 1 }} />
          {canExport && (
            <Button
              variant="primary"
              onClick={() => void (canNativeExport ? onExport() : onWebExport())}
              disabled={exportState?.status === "running"}
              title={canNativeExport ? "原生管线 · 10-bit 保真" : "浏览器编码 · 8-bit"}
            >
              {exportState?.status === "running"
                ? "导出中…"
                : canNativeExport
                  ? "导出 10-bit"
                  : "导出"}
            </Button>
          )}
          <label style={{ cursor: "pointer" }}>
            <Button as="span" variant={canExport ? "secondary" : "primary"}>
              打开视频
            </Button>
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
              boxShadow: tokens.shadow.lg,
            }}
          />
        </div>

        {/* scopes strip */}
        {showScopes && (
          <div
            className="osmo-fade-in"
            style={{
              display: "flex",
              gap: 12,
              padding: "8px 18px 0",
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
            <figure style={scopeFigure}>
              <canvas ref={vecRef} width={256} height={256} style={{ ...scopeCanvas, width: 110, height: 110 }} />
              <figcaption style={scopeCaption}>矢量 · CbCr</figcaption>
            </figure>
          </div>
        )}

        {/* transport bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px",
            borderTop: `1px solid ${tokens.color.border}`,
            background: tokens.color.surface,
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (playing ? engine.pause() : engine.play())}
            style={{ background: tokens.color.surfaceRaised, border: `1px solid ${tokens.color.border}` }}
          >
            {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            active={showScopes}
            onClick={() => setShowScopes(!showScopes)}
            title="示波器"
          >
            <ScopesIcon size={16} />
          </Button>
          <Button variant="ghost" size="icon" onClick={engine.stepForward} title="逐帧 →">
            <StepForwardIcon size={16} />
          </Button>
          <input
            type="range"
            className="osmo-slider"
            min={0}
            max={Math.max(durationUs, 1)}
            value={dragUs ?? positionUs}
            onChange={(e) => {
              const us = Number(e.target.value);
              setDragUs(us);
              engine.scrub(us);
            }}
            onPointerUp={() => {
              if (dragUs !== null) {
                engine.seek(dragUs);
                setDragUs(null);
              }
            }}
            onKeyUp={() => {
              if (dragUs !== null) {
                engine.seek(dragUs);
                setDragUs(null);
              }
            }}
            style={{
              flex: 1,
              height: 3,
              appearance: "none",
              borderRadius: 2,
              outline: "none",
              cursor: "pointer",
              background: `linear-gradient(to right, ${tokens.color.accent} 0%, ${tokens.color.accent} ${
                (Math.max(dragUs ?? positionUs, 0) / Math.max(durationUs, 1)) * 100
              }%, ${tokens.color.border} 0%)`,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontFamily: tokens.font.mono,
              color: tokens.color.textDim,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtUs(dragUs ?? positionUs)} / {fmtUs(durationUs)}
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: tokens.font.mono,
              color: tokens.color.textFaint,
              fontVariantNumeric: "tabular-nums",
              minWidth: 38,
            }}
          >
            {stats ? `${stats.presentedFps}fps` : ""}
          </span>
        </div>
        {engine.error && (
          <div style={{ color: tokens.color.bad, padding: "6px 18px", fontSize: 12 }}>{engine.error}</div>
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
            padding: "12px 14px",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.2,
            borderBottom: `1px solid ${tokens.color.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>调色</span>
          <Button variant="ghost" size="icon" onClick={undo} title="撤销 ⌘Z" style={{ width: 26, height: 26 }}>
            <UndoIcon size={14} />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} title="重做 ⇧⌘Z" style={{ width: 26, height: 26 }}>
            <RedoIcon size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateGrade({ ...defaultGrade(grade.input.profile) })}
            style={{ borderRadius: tokens.radius.pill, border: `1px solid ${tokens.color.border}` }}
          >
            全部重置
          </Button>
        </div>
        <AdjustPanel
          grade={grade}
          onChange={updateGrade}
          onPickCreativeLut={(f) => void onPickCreativeLut(f)}
          onPickInputLut={(f) => void onPickInputLut(f)}
        />
      </aside>

      {exportState && (
        <div
          className="osmo-fade-in"
          style={{
            position: "fixed",
            right: 316,
            bottom: 16,
            width: 300,
            background: tokens.color.surfaceRaised,
            border: `1px solid ${tokens.color.borderStrong}`,
            borderRadius: tokens.radius.md,
            padding: 16,
            fontSize: 12,
            boxShadow: tokens.shadow.lg,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <strong
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color:
                  exportState.status === "done"
                    ? tokens.color.good
                    : exportState.status === "error"
                      ? tokens.color.bad
                      : tokens.color.text,
              }}
            >
              {exportState.status === "done" && <CheckIcon size={14} />}
              {exportState.status === "running"
                ? "导出中"
                : exportState.status === "done"
                  ? "导出完成"
                  : "导出失败"}
            </strong>
            <button
              onClick={() => {
                if (exportState.status === "running") {
                  if (exportState.jobId !== null) void exportCancelNative(exportState.jobId);
                  webCancelRef.current = true;
                }
                setExportState(null);
              }}
              className="osmo-btn"
              data-variant="ghost"
              style={{
                background: "none",
                border: "none",
                color: tokens.color.textDim,
                cursor: "pointer",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 6px",
                borderRadius: tokens.radius.xs,
              }}
            >
              {exportState.status === "running" ? "取消" : <CloseIcon size={13} />}
            </button>
          </div>
          {exportState.status === "error" ? (
            <div style={{ color: tokens.color.bad, wordBreak: "break-all" }}>
              {exportState.message}
            </div>
          ) : (
            <>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: tokens.color.border,
                  overflow: "hidden",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, (exportState.frame / exportState.totalFrames) * 100)}%`,
                    background:
                      exportState.status === "done" ? tokens.color.good : tokens.color.accent,
                    transition: "width 0.3s",
                  }}
                />
              </div>
              <div style={{ color: tokens.color.textDim }}>
                {exportState.frame}/{exportState.totalFrames} 帧 ·{" "}
                <span style={{ wordBreak: "break-all" }}>{exportState.outPath}</span>
              </div>
              {exportState.note && (
                <div style={{ color: tokens.color.accent, marginTop: 4, fontSize: 11 }}>
                  {exportState.note}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const scopeFigure: React.CSSProperties = { margin: 0 };

const scopeCanvas: React.CSSProperties = {
  width: 200,
  height: 90,
  background: "#000",
  borderRadius: tokens.radius.sm,
  boxShadow: `inset 0 0 0 1px ${tokens.color.border}`,
  display: "block",
};

const scopeCaption: React.CSSProperties = {
  fontSize: 10,
  color: tokens.color.textFaint,
  marginTop: 4,
  letterSpacing: 0.2,
};

function fmtUs(us: number): string {
  const s = Math.floor(us / 1e6);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
