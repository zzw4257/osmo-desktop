import { useCallback, useRef } from "react";
import { tokens } from "./tokens";

export interface ColorWheelProps {
  label: string;
  /** [r, g, b, master] — rgb from the wheel pad, master from the slider */
  value: [number, number, number, number];
  onChange: (v: [number, number, number, number]) => void;
  size?: number;
  /** Wheel radius maps to this much channel offset. */
  range?: number;
}

/**
 * Lift/Gamma/Gain/Offset wheel. Dragging toward a hue pushes a zero-sum RGB
 * offset in that direction (r = A·cosθ, g = A·cos(θ−120°), b = A·cos(θ−240°)),
 * the slider below is the master component. Double-click resets.
 */
export function ColorWheel({ label, value, onChange, size = 96, range = 0.35 }: ColorWheelProps) {
  const discRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const [r, g, b, master] = value;
  // Inverse of the forward mapping below: recover disc position from rgb.
  const xUnit = (r - 0.5 * g - 0.5 * b) / (1.5 * range);
  const yUnitUp = (0.866 * (g - b)) / (1.5 * range);
  const px = clamp(xUnit, -1, 1) * (size / 2 - 6);
  const py = -clamp(yUnitUp, -1, 1) * (size / 2 - 6);

  const applyFromEvent = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = discRef.current!.getBoundingClientRect();
      let dx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2 - 6);
      let dyDown = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2 - 6);
      let len = Math.hypot(dx, dyDown);
      if (len > 1) {
        dx /= len;
        dyDown /= len;
        len = 1;
      }
      const theta = Math.atan2(-dyDown, dx);
      const amount = len * range;
      const nr = amount * Math.cos(theta);
      const ng = amount * Math.cos(theta - (2 * Math.PI) / 3);
      const nb = amount * Math.cos(theta - (4 * Math.PI) / 3);
      onChange([round4(nr), round4(ng), round4(nb), master]);
    },
    [onChange, master, range],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 11, color: tokens.color.textDim }}>{label}</span>
      <div
        ref={discRef}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          applyFromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && applyFromEvent(e)}
        onPointerUp={() => (dragging.current = false)}
        onDoubleClick={() => onChange([0, 0, 0, master])}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          position: "relative",
          cursor: "crosshair",
          touchAction: "none",
          // hue ring matching the math: red at +x (0°), green at 120°, blue at 240°
          background:
            "conic-gradient(from 90deg, #ff4444, #ff44ff, #4444ff, #44ffff, #44ff44, #ffff44, #ff4444)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${tokens.color.surface} 35%, transparent 85%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: size / 2 + px - 5,
            top: size / 2 + py - 5,
            width: 10,
            height: 10,
            borderRadius: "50%",
            border: `2px solid ${tokens.color.text}`,
            background: tokens.color.bg,
            pointerEvents: "none",
          }}
        />
      </div>
      <input
        type="range"
        min={-0.5}
        max={0.5}
        step={0.005}
        value={master}
        onChange={(e) => onChange([r, g, b, Number(e.target.value)])}
        onDoubleClick={() => onChange([r, g, b, 0])}
        style={{ width: size, height: 3, accentColor: tokens.color.accent }}
        title={`${label} 主控`}
      />
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 10000) / 10000;
