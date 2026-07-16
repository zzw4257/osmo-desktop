/** Mimo-style dark theme tokens: near-black surfaces, DJI orange accent. */
export const tokens = {
  color: {
    bg: "#0e0e0f",
    surface: "#1a1a1c",
    surfaceRaised: "#232326",
    border: "#323236",
    text: "#f2f2f3",
    textDim: "#9b9ba1",
    accent: "#ff6a00",
    accentDim: "#b34a00",
    good: "#6fdd8b",
    bad: "#ff5f57",
  },
  radius: { sm: 6, md: 10, lg: 14 },
  font: {
    family: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    mono: "ui-monospace, 'SF Mono', monospace",
  },
} as const;
