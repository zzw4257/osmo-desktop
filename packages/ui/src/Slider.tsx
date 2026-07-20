import { useCallback, useId } from "react";
import { tokens } from "./tokens";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

/** Labeled slider, Mimo-style: name left, value right, double-click resets. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  format,
  onChange,
}: SliderProps) {
  const id = useId();
  const reset = useCallback(() => onChange(defaultValue), [onChange, defaultValue]);
  const pct = ((value - min) / (max - min)) * 100;
  const touched = value !== defaultValue;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <label htmlFor={id} style={{ color: touched ? tokens.color.text : tokens.color.textDim }}>
          {label}
        </label>
        <span
          style={{
            color: touched ? tokens.color.accent : tokens.color.textFaint,
            fontFamily: tokens.font.mono,
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {format ? format(value) : formatDefault(value, step)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={reset}
        style={{
          width: "100%",
          height: 3,
          appearance: "none",
          borderRadius: 2,
          outline: "none",
          cursor: "pointer",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.35)",
          background: `linear-gradient(to right, ${tokens.color.accentHover} 0%, ${tokens.color.accent} ${pct}%, ${tokens.color.border} ${pct}%, ${tokens.color.border} 100%)`,
        }}
        className="osmo-slider"
      />
    </div>
  );
}

function formatDefault(v: number, step: number): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const s = v.toFixed(digits);
  return v > 0 && step >= 1 ? `+${s}` : s;
}
