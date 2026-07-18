/**
 * Mimo-accurate dark theme tokens — calibrated against real DJI Mimo App Store
 * screenshots (pixel-sampled): near-pure-black stage, white-pill/black-text for
 * primary actions and selection state, and a gold accent (~#FFD60A, sampled
 * from Mimo's 调色/剪辑 toolbar icons) reserved for color-tool identity —
 * Mimo's own chrome carries no orange at all.
 */
export const tokens = {
  color: {
    bg: "#050505",
    surface: "#18181b",
    surfaceRaised: "#232327",
    surfaceHover: "#2a2a2f",
    border: "#2c2c31",
    borderStrong: "#3a3a40",
    text: "#f5f5f6",
    textDim: "#95959c",
    textFaint: "#616167",
    accent: "#ffd60a",
    accentHover: "#ffe248",
    accentDim: "#b39400",
    accentWash: "rgba(255, 214, 10, 0.14)",
    onLight: "#141410",
    good: "#5fd88a",
    bad: "#ff5f57",
    /** Translucent chrome (headers/panels) — content can be seen/blurred through, per
     * Apple's materials-as-hierarchy guidance rather than flat opaque bars. */
    glass: "rgba(20, 20, 23, 0.68)",
    hairlineLight: "rgba(255,255,255,0.06)",
    hairlineLightStrong: "rgba(255,255,255,0.5)",
  },
  radius: { xs: 4, sm: 8, md: 12, lg: 16, pill: 999 },
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.3)",
    md: "0 4px 16px rgba(0,0,0,0.35)",
    lg: "0 12px 40px rgba(0,0,0,0.45)",
    glow: "0 0 0 3px rgba(255,214,10,0.18)",
    /** Two-layer shadow (tight contact + soft ambient) — a single flat shadow
     * reads cheap; real depth needs both a near shadow and a far one. */
    card: "0 1px 2px rgba(0,0,0,0.4), 0 6px 20px rgba(0,0,0,0.28)",
  },
  blur: {
    glass: "blur(20px) saturate(160%)",
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
