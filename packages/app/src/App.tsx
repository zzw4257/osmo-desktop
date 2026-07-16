import { useCallback, useEffect, useState } from "react";
import { EditorScreen } from "./editor/EditorScreen";
import type { LibraryClip } from "./library/scanFolder";
import { LibraryScreen } from "./library/LibraryScreen";
import { autoProbeAndReport } from "./spike/autoProbe";

interface ActiveClip {
  file: File;
  key: string;
  name: string;
}

/** Application shell shared by apps/desktop and apps/web. */
export function App() {
  const [view, setView] = useState<"library" | "editor">("library");
  const [activeClip, setActiveClip] = useState<ActiveClip | undefined>();

  useEffect(() => {
    // Startup pipeline-integrity probe; reports to the dev terminal when a
    // sink is present, silently no-ops in production.
    void autoProbeAndReport();
  }, []);

  const openClip = useCallback(async (clip: LibraryClip) => {
    const file = await clip.getFile();
    setActiveClip({ file, key: clip.key, name: clip.name });
    setView("editor");
  }, []);

  return view === "library" ? (
    <LibraryScreen onOpenClip={(clip) => void openClip(clip)} />
  ) : (
    <EditorScreen initialClip={activeClip} onBack={() => setView("library")} />
  );
}
