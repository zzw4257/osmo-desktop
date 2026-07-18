/** Mimo-style dark theme tokens: near-black surfaces, DJI orange accent. */
export const tokens = {
  color: {
    bg: "#0a0a0b",
    surface: "#18181b",
    surfaceRaised: "#232327",
    surfaceHover: "#2a2a2f",
    border: "#2c2c31",
    borderStrong: "#3a3a40",
    text: "#f5f5f6",
    textDim: "#95959c",
    textFaint: "#616167",
    accent: "#ff7a1a",
    accentHover: "#ff8b3a",
    accentDim: "#b34a00",
    accentWash: "rgba(255, 122, 26, 0.12)",
    good: "#5fd88a",
    bad: "#ff5f57",
  },
  radius: { xs: 4, sm: 8, md: 12, lg: 16, pill: 999 },
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.3)",
    md: "0 4px 16px rgba(0,0,0,0.35)",
    lg: "0 12px 40px rgba(0,0,0,0.45)",
    glow: "0 0 0 3px rgba(255,122,26,0.18)",
  },
  ease: {
    out: "cubic-bezier(0.16, 1, 0.3, 1)",
    inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  },
  font: {
    family:
      "-apple-system, BlinkMacSystemFont, system-ui, 'PingFang SC', 'Helvetica Neue', sans-serif",
    mono: "'SF Mono', ui-monospace, Menlo, monospace",
  },
} as const;
