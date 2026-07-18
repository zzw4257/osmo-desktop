import { GlobalStyle, tokens } from "@osmo/ui";
import { useCallback, useEffect, useState } from "react";
import { EditorScreen } from "./editor/EditorScreen";
import type { LibraryClip } from "./library/scanFolder";
import { LibraryScreen } from "./library/LibraryScreen";
import { MonitorScreen } from "./monitor/MonitorScreen";
import { hasSeenOnboarding, markOnboardingSeen } from "./onboarding/onboardingStore";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { autoProbeAndReport } from "./spike/autoProbe";

interface ActiveClip {
  file: Blob;
  key: string;
  name: string;
  srcPath: string | null;
  lrf: Blob | null;
}

/** Application shell shared by apps/desktop and apps/web. */
export function App() {
  const [view, setView] = useState<"library" | "editor" | "monitor">("library");
  const [activeClip, setActiveClip] = useState<ActiveClip | undefined>();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    // Startup pipeline-integrity probe; reports to the dev terminal when a
    // sink is present, silently no-ops in production.
    void autoProbeAndReport();
    void hasSeenOnboarding().then(setOnboarded);
  }, []);

  const openClip = useCallback(async (clip: LibraryClip) => {
    const [file, lrf] = await Promise.all([clip.getFile(), clip.getLrf()]);
    setActiveClip({ file, key: clip.key, name: clip.name, srcPath: clip.srcPath, lrf });
    setView("editor");
  }, []);

  const finishOnboarding = useCallback(() => {
    setOnboarded(true);
    void markOnboardingSeen();
  }, []);

  if (onboarded === null) {
    return <div style={{ height: "100vh", background: tokens.color.bg }} />;
  }

  return (
    <>
      <GlobalStyle />
      {!onboarded ? (
        <OnboardingFlow onDone={finishOnboarding} />
      ) : view === "monitor" ? (
        <MonitorScreen onBack={() => setView("library")} />
      ) : view === "editor" ? (
        <EditorScreen initialClip={activeClip} onBack={() => setView("library")} />
      ) : (
        <LibraryScreen
          onOpenClip={(clip) => void openClip(clip)}
          onOpenMonitor={() => setView("monitor")}
        />
      )}
    </>
  );
}
