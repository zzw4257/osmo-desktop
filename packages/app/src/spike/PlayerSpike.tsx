import type { PrecisionReport } from "@osmo/color-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerStats } from "./spikePlayer";
import { SpikePlayer } from "./spikePlayer";

const panel: React.CSSProperties = {
  background: "#1d1d1f",
  borderRadius: 12,
  padding: 16,
};

export function PlayerSpike() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<SpikePlayer | null>(null);
  const fileRef = useRef<File | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [probe, setProbe] = useState<PrecisionReport | "running" | null>(null);

  useEffect(() => {
    const player = new SpikePlayer(setStats);
    playerRef.current = player;
    if (canvasRef.current) {
      player.init(canvasRef.current).catch((e) => setInitError(String(e)));
    }
    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, []);

  const onPickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !playerRef.current) return;
    fileRef.current = file;
    setProbe(null);
    try {
      await playerRef.current.load(file);
      playerRef.current.play();
    } catch {
      // 状态已通过 stats.state === "error" 反映到 UI
    }
  }, []);

  const onReplay = useCallback(() => playerRef.current?.play(), []);

  const onProbe = useCallback(async () => {
    if (!playerRef.current || !fileRef.current) return;
    setProbe("running");
    try {
      setProbe(await playerRef.current.probePrecision(fileRef.current));
    } catch (e) {
      setProbe(null);
      setInitError(`精度探针失败: ${String(e)}`);
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "min(1100px, 92vw)" }}>
      <div style={{ ...panel, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label
          style={{
            background: "#ff6a00",
            color: "#141414",
            fontWeight: 600,
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
          }}
        >
          选择视频文件
          <input type="file" accept="video/mp4,video/quicktime" onChange={onPickFile} hidden />
        </label>
        <button onClick={onReplay} style={buttonStyle} disabled={!stats || stats.state === "loading"}>
          重新播放
        </button>
        <button onClick={onProbe} style={buttonStyle} disabled={!fileRef.current || probe === "running"}>
          {probe === "running" ? "自检中…" : "10-bit 精度自检"}
        </button>
        {probe !== null && probe !== "running" && (
          <span style={{ color: probe.tenBitIntact ? "#6fdd8b" : "#ff5f57", fontSize: 13 }}>
            {probe.tenBitIntact ? "✓ 10-bit 链路完整" : "✗ 精度被截断"}（{probe.distinctLevels} 级 /
            {probe.sampledWidth}px · 帧格式 {probe.videoFrameFormat ?? "null"} · {probe.path}）
          </span>
        )}
      </div>

      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        style={{ width: "100%", aspectRatio: "16/9", background: "#000", borderRadius: 12 }}
      />

      <div style={{ ...panel, fontSize: 13, display: "flex", gap: 24, flexWrap: "wrap" }}>
        {initError ? (
          <span style={{ color: "#ff5f57" }}>{initError}</span>
        ) : stats === null ? (
          <span style={{ opacity: 0.6 }}>选择一个 4K HEVC 10-bit 样片开始（samples/ 目录）</span>
        ) : (
          <>
            <Stat label="状态" value={stats.error ?? stats.state} />
            <Stat label="编码" value={stats.codec || "—"} />
            <Stat label="分辨率" value={stats.resolution || "—"} />
            <Stat label="呈现帧率" value={`${stats.presentedFps} fps`} />
            <Stat label="已呈现" value={String(stats.presented)} />
            <Stat label="丢帧" value={String(stats.dropped)} />
            <Stat label="解码队列" value={String(stats.decodeQueue)} />
            <Stat label="帧队列" value={String(stats.frameQueue)} />
          </>
        )}
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  background: "#2c2c2e",
  color: "#f2f2f2",
  border: "1px solid #3a3a3c",
  borderRadius: 8,
  padding: "8px 16px",
  cursor: "pointer",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ opacity: 0.55 }}>{label} </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}
