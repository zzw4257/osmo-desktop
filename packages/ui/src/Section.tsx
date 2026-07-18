import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronRightIcon, ResetIcon } from "./icons";
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
    <div style={{ borderBottom: `1px solid ${tokens.color.border}` }}>
      <div
        onClick={() => setOpen(!open)}
        className="osmo-section-header"
        data-open={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 14px",
          cursor: "pointer",
          userSelect: "none",
          fontSize: 12.5,
          fontWeight: 600,
          letterSpacing: 0.2,
        }}
      >
        <ChevronRightIcon
          size={11}
          color={tokens.color.textFaint}
          style={{
            transform: open ? "rotate(90deg)" : "none",
            transition: `transform 0.18s ${tokens.ease.out}`,
          }}
        />
        <span style={{ flex: 1 }}>{title}</span>
        {badge && (
          <span
            style={{
              color: tokens.color.accent,
              fontSize: 10,
              fontWeight: 500,
              background: tokens.color.accentWash,
              borderRadius: tokens.radius.pill,
              padding: "2px 8px",
            }}
          >
            {badge}
          </span>
        )}
        {onReset && open && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            className="osmo-btn"
            data-variant="ghost"
            style={{
              color: tokens.color.textFaint,
              cursor: "pointer",
              padding: 4,
              display: "grid",
              placeItems: "center",
              borderRadius: tokens.radius.xs,
              borderWidth: 1,
              borderStyle: "solid",
            }}
            title="重置本区"
          >
            <ResetIcon size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="osmo-fade-in" style={{ padding: "2px 14px 14px" }}>
          {children}
        </div>
      )}
    </div>
  );
}
