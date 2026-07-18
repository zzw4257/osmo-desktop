import { Button, CameraDeviceIcon, CheckIcon, FilmIcon, ScopesIcon, tokens } from "@osmo/ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

interface Step {
  icon: ReactNode;
  title: string;
  subtitle: string;
}

const STEPS: Step[] = [
  {
    icon: <FilmIcon size={30} />,
    title: "专业调色，就在桌面",
    subtitle: "为 Pocket 4 打造的桌面调色台 —— 色轮、曲线、HSL 分区、示波器，比手机剪辑更进一步。",
  },
  {
    icon: <CameraDeviceIcon size={30} />,
    title: "连接你的 Pocket 4",
    subtitle: "USB 直连即自动识别素材库；切到网络摄像头模式，还能无线实时监看并同步调色画面。",
  },
  {
    icon: <ScopesIcon size={30} />,
    title: "官方级 D-Log 色彩科学",
    subtitle: "基于 DJI 官方公式的 D-Log / D-Log M / D-Log 2 → Rec.709 精确还原，全程示波器比对，所见即所得。",
  },
  {
    icon: <CheckIcon size={30} />,
    title: "准备就绪",
    subtitle: "关联包含素材的文件夹，或直接连接设备，即可开始。",
  },
];

/** First-launch guided intro, styled after DJI Mimo's marketing screens —
 * bold centered headline, one icon, dot pagination, white pill CTA. */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step]!;

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
          maxWidth: 380,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: tokens.color.accentWash,
            display: "grid",
            placeItems: "center",
            color: tokens.color.accent,
            marginBottom: 24,
          }}
        >
          {current.icon}
        </div>
        <h1
          style={{
            fontSize: 26,
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

      <div style={{ display: "flex", gap: 6, marginTop: 32 }}>
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
          marginTop: 36,
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
