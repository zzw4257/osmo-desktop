import { useEffect } from "react";
import { EditorScreen } from "./editor/EditorScreen";
import { autoProbeAndReport } from "./spike/autoProbe";

/** Application shell shared by apps/desktop and apps/web. */
export function App() {
  useEffect(() => {
    // Startup pipeline-integrity probe; reports to the dev terminal when a
    // sink is present, silently no-ops in production.
    void autoProbeAndReport();
  }, []);

  return <EditorScreen />;
}
