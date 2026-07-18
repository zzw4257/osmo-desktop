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
  const touched = r !== 0 || g !== 0 || b !== 0;
  // Inverse of the forward mapping below: recover disc position from rgb.
  const xUnit = (r - 0.5 * g - 0.5 * b) / (1.5 * range);
  const yUnitUp = (0.866 * (g - b)) / (1.5 * range);
  const px = clamp(xUnit, -1, 1) * (size / 2 - 7);
  const py = -clamp(yUnitUp, -1, 1) * (size / 2 - 7);

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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          color: touched ? tokens.color.text : tokens.color.textDim,
          fontWeight: touched ? 600 : 400,
        }}
      >
        {label}
      </span>
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
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.3), ${tokens.shadow.sm}`,
          // hue ring matching the math: red at +x (0°), green at 120°, blue at 240°
          background:
            "conic-gradient(from 90deg, #ff5252, #ff52ff, #5252ff, #52ffff, #52ff52, #ffff52, #ff5252)",
          filter: "saturate(0.85)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${tokens.color.surface} 32%, transparent 78%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: size / 2 + px - 6,
            top: size / 2 + py - 6,
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: `2px solid ${tokens.color.text}`,
            background: tokens.color.bg,
            boxShadow: "0 1px 4px rgba(0,0,0,0.6)",
            pointerEvents: "none",
            transition: dragging.current ? "none" : `left 0.1s ${tokens.ease.out}, top 0.1s ${tokens.ease.out}`,
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
        className="osmo-slider"
        style={{
          width: size,
          height: 3,
          appearance: "none",
          borderRadius: 2,
          outline: "none",
          cursor: "pointer",
          background: `linear-gradient(to right, ${tokens.color.border} 0%, ${tokens.color.textFaint} 50%, ${tokens.color.border} 100%)`,
        }}
        title={`${label} 主控`}
      />
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 10000) / 10000;
