import { useCallback, useEffect, useState } from "react";
import { EditorScreen } from "./editor/EditorScreen";
import type { LibraryClip } from "./library/scanFolder";
import { LibraryScreen } from "./library/LibraryScreen";
import { MonitorScreen } from "./monitor/MonitorScreen";
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

  useEffect(() => {
    // Startup pipeline-integrity probe; reports to the dev terminal when a
    // sink is present, silently no-ops in production.
    void autoProbeAndReport();
  }, []);

  const openClip = useCallback(async (clip: LibraryClip) => {
    const [file, lrf] = await Promise.all([clip.getFile(), clip.getLrf()]);
    setActiveClip({ file, key: clip.key, name: clip.name, srcPath: clip.srcPath, lrf });
    setView("editor");
  }, []);

  if (view === "monitor") return <MonitorScreen onBack={() => setView("library")} />;
  if (view === "editor")
    return <EditorScreen initialClip={activeClip} onBack={() => setView("library")} />;
  return (
    <LibraryScreen
      onOpenClip={(clip) => void openClip(clip)}
      onOpenMonitor={() => setView("monitor")}
    />
  );
}
