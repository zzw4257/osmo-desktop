import { Button, CameraDeviceIcon, CheckIcon, tokens } from "@osmo/ui";
import { useEffect, useState } from "react";

interface Step {
  preview: () => JSX.Element;
  title: string;
  subtitle: string;
}

const STEPS: Step[] = [
  {
    preview: AdjustPreview,
    title: "专业调色，就在桌面",
    subtitle: "为 Pocket 4 打造的桌面调色台 —— 色轮、曲线、HSL 分区、示波器，比手机剪辑更进一步。",
  },
  {
    preview: ConnectPreview,
    title: "连接你的 Pocket 4",
    subtitle: "USB 直连即自动识别素材库；切到网络摄像头模式，还能无线实时监看并同步调色画面。",
  },
  {
    preview: DlogPreview,
    title: "官方级 D-Log 色彩科学",
    subtitle: "基于 DJI 官方公式的 D-Log / D-Log M / D-Log 2 → Rec.709 精确还原，全程示波器比对，所见即所得。",
  },
  {
    preview: LibraryPreview,
    title: "准备就绪",
    subtitle: "关联包含素材的文件夹，或直接连接设备，即可开始。",
  },
];

/** First-launch guided intro, styled after DJI Mimo's marketing screens —
 * each step previews an actual snippet of the real UI it's describing
 * (mini adjust panel, connection diagram, before/after strip, library grid)
 * rather than a single abstract icon, so the promise is concrete, not generic. */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step]!;
  const Preview = current.preview;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        setStep((s) => (s === STEPS.length - 1 ? s : s + 1));
      } else if (e.code === "Escape") {
        onDone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: tokens.color.bg,
        color: tokens.color.text,
        fontFamily: tokens.font.family,
        padding: 24,
      }}
    >
      <div
        key={step}
        className="osmo-fade-in"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: 400,
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: 28 }}>
          <Preview />
        </div>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            margin: "0 0 12px",
          }}
        >
          {current.title}
        </h1>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.65,
            color: tokens.color.textDim,
            margin: 0,
          }}
        >
          {current.subtitle}
        </p>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 28 }}>
        {STEPS.map((_, i) => (
          <span
            key={i}
            style={{
              width: i === step ? 18 : 6,
              height: 6,
              borderRadius: 999,
              background: i === step ? tokens.color.text : tokens.color.borderStrong,
              transition: `width 0.22s ${tokens.ease.out}, background 0.22s ${tokens.ease.out}`,
            }}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginTop: 32,
        }}
      >
        {!isLast && (
          <Button variant="ghost" onClick={onDone}>
            跳过
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => (isLast ? onDone() : setStep((s) => s + 1))}
          style={{ minWidth: 132 }}
        >
          {isLast ? "开始使用" : "下一步"}
        </Button>
      </div>
    </div>
  );
}

/** Mini adjust-panel snippet: filter chips + three graded sliders. */
function AdjustPreview() {
  const rows: Array<[string, string, number]> = [
    ["曝光", "+0.32 EV", 64],
    ["对比度", "+12", 56],
    ["饱和度", "-8", 42],
  ];
  return (
    <div
      style={{
        width: 300,
        borderRadius: tokens.radius.md,
        background: tokens.color.surfaceRaised,
        border: `1px solid ${tokens.color.border}`,
        boxShadow: tokens.shadow.card,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["原片", "鲜明", "电影感"].map((label, i) => (
          <span
            key={label}
            style={{
              fontSize: 10,
              padding: "3px 9px",
              borderRadius: 999,
              background: i === 0 ? tokens.color.text : "transparent",
              color: i === 0 ? tokens.color.onLight : tokens.color.textDim,
              border: i === 0 ? "none" : `1px solid ${tokens.color.border}`,
              fontWeight: i === 0 ? 700 : 400,
            }}
          >
            {label}
          </span>
        ))}
      </div>
      {rows.map(([label, value, pct]) => (
        <div key={label} style={{ marginBottom: 10 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10.5,
              marginBottom: 4,
              color: tokens.color.textDim,
            }}
          >
            <span>{label}</span>
            <span style={{ color: tokens.color.accent, fontFamily: tokens.font.mono }}>{value}</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: tokens.color.border, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${pct}%`,
                borderRadius: 2,
                background: tokens.color.accent,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `calc(${pct}% - 5px)`,
                top: -3.5,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Device ↔ desktop connection diagram with an animated data pulse. */
function ConnectPreview() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <IconBadge>
        <CameraDeviceIcon size={26} />
      </IconBadge>
      <svg width="88" height="24" viewBox="0 0 88 24" style={{ flexShrink: 0 }}>
        <line x1="4" y1="12" x2="84" y2="12" stroke={tokens.color.border} strokeWidth="2" strokeDasharray="1 6" strokeLinecap="round" />
        <circle r="3" fill={tokens.color.accent}>
          <animateMotion dur="1.6s" repeatCount="indefinite" path="M4,12 L84,12" />
        </circle>
      </svg>
      <IconBadge>
        <DesktopGlyph />
      </IconBadge>
    </div>
  );
}

function DesktopGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </svg>
  );
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 60,
        height: 60,
        borderRadius: "50%",
        background: tokens.color.accentWash,
        display: "grid",
        placeItems: "center",
        color: tokens.color.accent,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

/** D-Log flat-log vs. graded Rec.709 before/after strip, with a waveform hint. */
function DlogPreview() {
  return (
    <div style={{ width: 260 }}>
      <div
        style={{
          height: 90,
          borderRadius: tokens.radius.md,
          overflow: "hidden",
          position: "relative",
          boxShadow: tokens.shadow.card,
          display: "flex",
        }}
      >
        <div style={{ flex: 1, background: "linear-gradient(135deg, #6b6558, #8a7f68)" }} />
        <div style={{ flex: 1, background: "linear-gradient(135deg, #ff9a3c, #2f6fbf)" }} />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 2,
            background: "#fff",
            boxShadow: "0 0 6px rgba(0,0,0,0.5)",
            transform: "translateX(-1px)",
          }}
        />
        <span style={{ position: "absolute", left: 8, bottom: 6, fontSize: 9, color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>
          D-LOG
        </span>
        <span style={{ position: "absolute", right: 8, bottom: 6, fontSize: 9, color: "rgba(255,255,255,0.9)", fontWeight: 700 }}>
          REC.709
        </span>
      </div>
      <svg width="260" height="28" viewBox="0 0 260 28" style={{ marginTop: 8 }}>
        <polyline
          points="0,20 20,18 40,10 60,16 80,6 100,14 120,8 140,18 160,4 180,12 200,9 220,15 240,7 260,13"
          fill="none"
          stroke={tokens.color.accent}
          strokeWidth="1.5"
          style={{ filter: `drop-shadow(0 0 2px ${tokens.color.accent}66)` }}
        />
      </svg>
    </div>
  );
}

/** Mini library grid — a stand-in for "your clips will show up here". */
function LibraryPreview() {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 76,
            height: 54,
            borderRadius: tokens.radius.sm,
            background: `linear-gradient(135deg, ${tokens.color.surfaceRaised}, ${tokens.color.surface})`,
            border: `1px solid ${tokens.color.border}`,
            boxShadow: tokens.shadow.card,
            position: "relative",
          }}
        >
          {i === 1 && (
            <span
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: tokens.color.good,
                color: tokens.color.onLight,
                display: "grid",
                placeItems: "center",
              }}
            >
              <CheckIcon size={10} color={tokens.color.onLight} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
