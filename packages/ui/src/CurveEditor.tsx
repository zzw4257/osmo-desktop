import { useCallback, useMemo, useRef, useState } from "react";
import { tokens } from "./tokens";

export type CurvePts = Array<[number, number]>;

export interface CurveEditorProps {
  points: CurvePts;
  onChange: (pts: CurvePts) => void;
  /** Bake function so the editor draws the exact spline the shader uses. */
  bake: (pts: CurvePts, size: number) => Float32Array;
  width?: number;
  height?: number;
  accent?: string;
  /** "diagonal" for tone curves, "zero" for hue offset curves. */
  identity?: "diagonal" | "zero";
}

const PREVIEW_N = 128;

/**
 * Curve editor: click to add a point, drag to move, double-click a point to
 * remove it. y is displayed bottom-up. The rendered curve is baked with the
 * same spline code the GPU LUT uses — what you see is what grades.
 */
export function CurveEditor({
  points,
  onChange,
  bake,
  width = 240,
  height = 160,
  accent = tokens.color.accent,
  identity = "diagonal",
}: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const path = useMemo(() => {
    const lut = bake(points, PREVIEW_N);
    let d = "";
    for (let i = 0; i < PREVIEW_N; i++) {
      const x = (i / (PREVIEW_N - 1)) * width;
      const yNorm = identity === "zero" ? lut[i]! * 0.5 + 0.5 : lut[i]!;
      const y = height - clamp01(yNorm) * height;
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }
    return d;
  }, [points, bake, width, height, identity]);

  const toLocal = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] => {
      const rect = svgRef.current!.getBoundingClientRect();
      const x = clamp01((e.clientX - rect.left) / rect.width);
      let y = clamp01(1 - (e.clientY - rect.top) / rect.height);
      if (identity === "zero") y = y * 2 - 1;
      return [x, y];
    },
    [identity],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const [x, y] = toLocal(e);
      // near an existing point → start dragging it
      const idx = points.findIndex((p) => Math.abs(p[0] - x) < 0.04);
      if (idx >= 0) {
        setDragIndex(idx);
      } else {
        const added: [number, number] = [x, y];
        const next: CurvePts = [...points, added].sort((a, b) => a[0] - b[0]);
        onChange(next);
        setDragIndex(next.findIndex((p) => p[0] === x && p[1] === y));
      }
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [points, onChange, toLocal],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIndex === null) return;
      const [x, y] = toLocal(e);
      const next: CurvePts = points.map((p, i): [number, number] =>
        i === dragIndex ? [x, y] : [p[0], p[1]],
      );
      onChange(next);
    },
    [dragIndex, points, onChange, toLocal],
  );

  const onPointerUp = useCallback(() => {
    if (dragIndex !== null) {
      onChange([...points].sort((a, b) => a[0] - b[0]));
      setDragIndex(null);
    }
  }, [dragIndex, points, onChange]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const [x] = toLocal(e);
      const idx = points.findIndex((p) => Math.abs(p[0] - x) < 0.04);
      if (idx >= 0) onChange(points.filter((_, i) => i !== idx));
    },
    [points, onChange, toLocal],
  );

  const midY = identity === "zero" ? height / 2 : undefined;
  const fillId = useMemo(() => `curve-fill-${Math.random().toString(36).slice(2)}`, []);
  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        background: tokens.color.bg,
        borderRadius: tokens.radius.sm,
        boxShadow: `inset 0 0 0 1px ${tokens.color.border}`,
        cursor: "crosshair",
        touchAction: "none",
        display: "block",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
          <stop offset="100%" stopColor={accent} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* grid */}
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} stroke={tokens.color.border} strokeWidth={0.5}>
          <line x1={g * width} y1={0} x2={g * width} y2={height} />
          <line x1={0} y1={g * height} x2={width} y2={g * height} />
        </g>
      ))}
      {midY === undefined ? (
        <line x1={0} y1={height} x2={width} y2={0} stroke={tokens.color.border} strokeWidth={1} strokeDasharray="2 3" />
      ) : (
        <line x1={0} y1={midY} x2={width} y2={midY} stroke={tokens.color.border} strokeWidth={1} strokeDasharray="2 3" />
      )}
      <path d={areaPath} fill={`url(#${fillId})`} stroke="none" />
      <path d={path} stroke={accent} strokeWidth={1.75} fill="none" strokeLinecap="round" />
      {points.map(([x, y], i) => {
        const yNorm = identity === "zero" ? y * 0.5 + 0.5 : y;
        const isDrag = i === dragIndex;
        return (
          <circle
            key={i}
            cx={x * width}
            cy={height - clamp01(yNorm) * height}
            r={isDrag ? 5.5 : 4}
            fill={isDrag ? accent : tokens.color.bg}
            stroke={accent}
            strokeWidth={1.75}
            style={{ transition: `r 0.1s ${tokens.ease.out}` }}
          />
        );
      })}
    </svg>
  );
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
