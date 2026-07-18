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

      ::selection { background: ${tokens.color.accent}; color: #14140f; }

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
        border: solid #14140f;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg) translate(-1px, -1px);
      }

      .osmo-btn {
        transition: background 0.12s ${tokens.ease.out}, color 0.12s, border-color 0.12s,
          transform 0.08s ${tokens.ease.out}, box-shadow 0.12s ${tokens.ease.out};
      }
      .osmo-btn:active { transform: scale(0.96); }
      .osmo-btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; }
      .osmo-btn[data-variant="primary"]:hover { background: ${tokens.color.accentHover}; }
      .osmo-btn[data-variant="secondary"]:hover { background: ${tokens.color.surfaceHover}; border-color: ${tokens.color.borderStrong}; }
      .osmo-btn[data-variant="ghost"]:hover { background: rgba(255,255,255,0.06); color: ${tokens.color.text}; }
      .osmo-btn[data-variant="danger"]:hover { background: #ff7169; }
      .osmo-btn[data-variant="active"]:hover { background: rgba(255,122,26,0.18); }

      .osmo-card {
        transition: border-color 0.15s ${tokens.ease.out}, transform 0.15s ${tokens.ease.out},
          box-shadow 0.15s ${tokens.ease.out};
      }
      .osmo-card:hover {
        border-color: ${tokens.color.borderStrong};
        transform: translateY(-2px);
        box-shadow: ${tokens.shadow.md};
      }

      .osmo-fade-in { animation: osmo-fade-in 0.18s ${tokens.ease.out}; }
      @keyframes osmo-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes osmo-spin { to { transform: rotate(360deg); } }

      .osmo-chip {
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

      select.osmo-select {
        transition: border-color 0.12s ${tokens.ease.out}, background 0.12s ${tokens.ease.out};
      }
      select.osmo-select:hover { border-color: ${tokens.color.borderStrong}; }
      select.osmo-select:focus {
        outline: none;
        border-color: ${tokens.color.accent};
        box-shadow: ${tokens.shadow.glow};
      }
    `}</style>
  );
}
