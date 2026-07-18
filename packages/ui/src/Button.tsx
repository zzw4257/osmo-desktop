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
  const computedStyle = { ...baseStyle(size), ...variantStyle(variant, active), ...style };
  const computedClassName = `osmo-btn ${className ?? ""}`;
  const dataVariant = active ? "active" : variant;

  if (as === "span") {
    return (
      <span
        className={computedClassName}
        data-variant={dataVariant}
        style={computedStyle}
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
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {icon}
      {children}
    </button>
  );
}

function baseStyle(size: ButtonSize): React.CSSProperties {
  switch (size) {
    case "icon":
      return {
        width: 34,
        height: 34,
        padding: 0,
        borderRadius: tokens.radius.sm,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
      };
    case "sm":
      return {
        height: 28,
        padding: "0 12px",
        borderRadius: tokens.radius.sm,
        fontSize: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      };
    default:
      return {
        height: 34,
        padding: "0 16px",
        borderRadius: tokens.radius.sm,
        fontSize: 13,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
      };
  }
}

function variantStyle(variant: ButtonVariant, active: boolean): React.CSSProperties {
  const shared: React.CSSProperties = {
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid transparent",
    whiteSpace: "nowrap",
  };
  if (active) {
    return {
      ...shared,
      background: tokens.color.accentWash,
      color: tokens.color.accent,
      borderColor: "rgba(255,122,26,0.4)",
    };
  }
  switch (variant) {
    case "primary":
      return { ...shared, background: tokens.color.accent, color: "#14140f" };
    case "danger":
      return { ...shared, background: tokens.color.bad, color: "#fff" };
    case "ghost":
      return {
        ...shared,
        background: "transparent",
        color: tokens.color.textDim,
        border: "1px solid transparent",
      };
    default:
      return {
        ...shared,
        background: tokens.color.surfaceRaised,
        color: tokens.color.text,
        borderColor: tokens.color.border,
      };
  }
}
