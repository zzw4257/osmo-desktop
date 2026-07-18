import { tokens } from "./tokens";

/**
 * One-time global stylesheet for the things inline styles can't express:
 * custom range-input thumbs, hover/active pseudo-classes, scrollbar theming,
 * and the shared keyframes/transition primitives every screen reaches for.
 * Mount once near the app root.
 */
export function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; }

      ::selection { background: ${tokens.color.accent}; color: ${tokens.color.onLight}; }

      /* Keyboard-only focus ring — a real ring for keyboard nav, invisible on
       * mouse click (:focus-visible), instead of either a mismatched native
       * blue ring or no indicator at all. */
      :focus-visible {
        outline: 2px solid ${tokens.color.accent};
        outline-offset: 2px;
      }
      .osmo-btn:focus-visible, .osmo-chip:focus-visible { outline-offset: 1px; }

      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb {
        background: ${tokens.color.borderStrong};
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      ::-webkit-scrollbar-thumb:hover { background: #4a4a52; background-clip: padding-box; }

      input[type="range"].osmo-slider {
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
      }
      input[type="range"].osmo-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.15);
        cursor: pointer;
        margin-top: 0;
        transition: transform 0.12s ${tokens.ease.out}, box-shadow 0.12s ${tokens.ease.out};
      }
      input[type="range"].osmo-slider:hover::-webkit-slider-thumb {
        transform: scale(1.15);
      }
      input[type="range"].osmo-slider:active::-webkit-slider-thumb {
        transform: scale(1.25);
        box-shadow: 0 1px 4px rgba(0,0,0,0.6), 0 0 0 5px ${tokens.color.accentWash};
      }
      input[type="range"].osmo-slider::-moz-range-thumb {
        width: 13px;
        height: 13px;
        border: none;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.5);
        cursor: pointer;
      }
      input[type="range"].osmo-slider::-moz-range-track {
        background: transparent;
      }

      input[type="checkbox"].osmo-check {
        appearance: none;
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        border: 1.5px solid rgba(255,255,255,0.65);
        background: rgba(0,0,0,0.35);
        cursor: pointer;
        display: grid;
        place-content: center;
        transition: background 0.12s, border-color 0.12s;
      }
      input[type="checkbox"].osmo-check:checked {
        background: ${tokens.color.accent};
        border-color: ${tokens.color.accent};
      }
      input[type="checkbox"].osmo-check:checked::after {
        content: "";
        width: 4px;
        height: 8px;
        border: solid ${tokens.color.onLight};
        border-width: 0 2px 2px 0;
        transform: rotate(45deg) translate(-1px, -1px);
      }

      .osmo-btn {
        transition: background 0.12s ${tokens.ease.out}, color 0.12s, border-color 0.12s,
          transform 0.08s ${tokens.ease.out}, box-shadow 0.12s ${tokens.ease.out};
      }
      .osmo-btn:active { transform: scale(0.96); }
      .osmo-btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; }

      /* Every variant's resting look lives here (not inline) so :hover can win the cascade.
       * Each also gets a subtle inset top highlight — real materials catch light unevenly;
       * a flat single fill reads as painted-on rather than a raised, physical control. */
      .osmo-btn[data-variant="primary"], .osmo-btn[data-variant="active"] {
        background: ${tokens.color.text}; color: ${tokens.color.onLight}; border-color: ${tokens.color.text};
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), ${tokens.shadow.sm};
      }
      .osmo-btn[data-variant="primary"]:hover, .osmo-btn[data-variant="active"]:hover {
        background: #e4e4e6; border-color: #e4e4e6;
      }
      .osmo-btn[data-variant="secondary"] {
        background: ${tokens.color.surfaceRaised}; color: ${tokens.color.text}; border-color: ${tokens.color.border};
        box-shadow: inset 0 1px 0 ${tokens.color.hairlineLight};
      }
      .osmo-btn[data-variant="secondary"]:hover { background: ${tokens.color.surfaceHover}; border-color: ${tokens.color.borderStrong}; }
      .osmo-btn[data-variant="ghost"] {
        background: transparent; color: ${tokens.color.textDim}; border-color: transparent;
      }
      .osmo-btn[data-variant="ghost"]:hover { background: rgba(255,255,255,0.06); color: ${tokens.color.text}; }
      .osmo-btn[data-variant="danger"] {
        background: ${tokens.color.bad}; color: #fff; border-color: transparent;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), ${tokens.shadow.sm};
      }
      .osmo-btn[data-variant="danger"]:hover { background: #ff7169; }

      .osmo-card {
        box-shadow: ${tokens.shadow.card};
        transition: border-color 0.15s ${tokens.ease.out}, transform 0.15s ${tokens.ease.out},
          box-shadow 0.15s ${tokens.ease.out};
      }
      .osmo-card:hover {
        border-color: ${tokens.color.borderStrong};
        transform: translateY(-2px);
        box-shadow: ${tokens.shadow.md};
      }

      /* Translucent chrome — headers/panels read as a floating material layer
       * rather than an opaque painted rectangle. Content scrolls/renders under it. */
      .osmo-glass {
        background: ${tokens.color.glass};
        backdrop-filter: ${tokens.blur.glass};
        -webkit-backdrop-filter: ${tokens.blur.glass};
      }

      .osmo-fade-in { animation: osmo-fade-in 0.18s ${tokens.ease.out}; }
      @keyframes osmo-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes osmo-spin { to { transform: rotate(360deg); } }

      .osmo-chip {
        background: transparent;
        border: 1px solid ${tokens.color.border};
        color: ${tokens.color.textDim};
        transition: background 0.12s ${tokens.ease.out}, border-color 0.12s ${tokens.ease.out},
          color 0.12s ${tokens.ease.out}, transform 0.08s ${tokens.ease.out};
      }
      .osmo-chip:hover { border-color: ${tokens.color.borderStrong}; color: ${tokens.color.text}; }
      .osmo-chip:active { transform: scale(0.95); }

      .osmo-band {
        transition: transform 0.14s ${tokens.ease.out}, box-shadow 0.14s ${tokens.ease.out},
          opacity 0.14s ${tokens.ease.out};
      }
      .osmo-band:hover { transform: scale(1.12); opacity: 1; }
      .osmo-band:active { transform: scale(0.92); }

      select.osmo-select {
        transition: border-color 0.12s ${tokens.ease.out}, background 0.12s ${tokens.ease.out};
        box-shadow: inset 0 1px 0 ${tokens.color.hairlineLight};
      }
      select.osmo-select:hover { border-color: ${tokens.color.borderStrong}; }
      select.osmo-select:focus {
        outline: none;
        border-color: ${tokens.color.accent};
        box-shadow: ${tokens.shadow.glow};
      }

      .osmo-section-header { transition: background 0.12s ${tokens.ease.out}; }
      .osmo-section-header[data-open="true"] { background: ${tokens.color.hairlineLight}; }
      .osmo-section-header:hover { background: rgba(255,255,255,0.045); }
      .osmo-section-header:active { background: rgba(255,255,255,0.02); }

      /* Reduced motion means gentler, not zero — keep opacity/color feedback,
       * drop the movement (translateY, scale) that can trigger motion sickness. */
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }
        .osmo-btn:active, .osmo-chip:active, .osmo-band:active, .osmo-band:hover {
          transform: none !important;
        }
      }
    `}</style>
  );
}
