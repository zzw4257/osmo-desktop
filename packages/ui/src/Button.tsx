import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { tokens } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

interface SharedProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  icon?: ReactNode;
}

export type ButtonProps =
  | ({ as?: "button" } & SharedProps & ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ as: "span" } & SharedProps & HTMLAttributes<HTMLSpanElement>);

/** The one button component every screen should use — variants match the
 * states Mimo distinguishes: primary action, neutral chrome, quiet icon
 * button, destructive. `as="span"` renders non-interactive markup for cases
 * like a <label> wrapper, where a nested <button> would be invalid HTML. */
/** Tracks the pointer position as CSS custom properties so the glass specular
 * highlight (GlobalStyle's `.osmo-btn::after`) can follow the cursor — macOS 26's
 * Liquid Glass controls "dynamically react to movement with specular highlights",
 * not a fixed painted-on sheen. */
function trackSpecular(e: React.PointerEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
  e.currentTarget.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
}

export function Button({
  as = "button",
  variant = "secondary",
  size = "md",
  active = false,
  icon,
  children,
  style,
  className,
  ...rest
}: ButtonProps) {
  const computedStyle = { ...baseStyle(size), ...sharedStyle, ...style };
  const computedClassName = `osmo-btn ${className ?? ""}`;
  const dataVariant = active ? "active" : variant;

  if (as === "span") {
    return (
      <span
        className={computedClassName}
        data-variant={dataVariant}
        style={computedStyle}
        onPointerMove={trackSpecular}
        {...(rest as HTMLAttributes<HTMLSpanElement>)}
      >
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      className={computedClassName}
      data-variant={dataVariant}
      style={computedStyle}
      onPointerMove={trackSpecular}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {icon}
      {children}
    </button>
  );
}

/** Every non-icon size is a capsule (radius = height/2) and icon buttons are
 * true circles — macOS 26's Liquid Glass controls are pill/circle shaped,
 * not rounded rectangles. */
function baseStyle(size: ButtonSize): React.CSSProperties {
  switch (size) {
    case "icon":
      return {
        width: 34,
        height: 34,
        padding: 0,
        borderRadius: tokens.radius.pill,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
      };
    case "sm":
      return {
        height: 28,
        padding: "0 14px",
        borderRadius: tokens.radius.pill,
        fontSize: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      };
    default:
      return {
        height: 34,
        padding: "0 18px",
        borderRadius: tokens.radius.pill,
        fontSize: 13,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
      };
  }
}

/**
 * Colors/background/border-color are intentionally NOT set here — they live in
 * GlobalStyle keyed off `[data-variant]` so :hover can actually take effect.
 * An inline style always wins over a stylesheet rule, so setting them here
 * would silently kill every hover transition (this bit the app once already).
 */
const sharedStyle: React.CSSProperties = {
  fontWeight: 600,
  cursor: "pointer",
  borderWidth: 1,
  borderStyle: "solid",
  whiteSpace: "nowrap",
  position: "relative",
  overflow: "hidden",
};
