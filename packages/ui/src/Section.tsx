import type { ReactNode } from "react";
import { useState } from "react";
import { tokens } from "./tokens";

export interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  badge?: string | undefined;
  onReset?: (() => void) | undefined;
  children: ReactNode;
}

/** Collapsible panel section with an optional per-section reset. */
export function Section({ title, defaultOpen = false, badge, onReset, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        borderBottom: `1px solid ${tokens.color.border}`,
        background: tokens.color.surface,
      }}
    >
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          cursor: "pointer",
          userSelect: "none",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
            color: tokens.color.textDim,
            fontSize: 10,
          }}
        >
          ▶
        </span>
        <span style={{ flex: 1 }}>{title}</span>
        {badge && (
          <span style={{ color: tokens.color.accent, fontSize: 10, fontWeight: 400 }}>{badge}</span>
        )}
        {onReset && open && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            style={{
              background: "none",
              border: "none",
              color: tokens.color.textDim,
              fontSize: 11,
              cursor: "pointer",
              padding: 0,
            }}
            title="重置本区"
          >
            ⟲
          </button>
        )}
      </div>
      {open && <div style={{ padding: "2px 12px 12px" }}>{children}</div>}
    </div>
  );
}
