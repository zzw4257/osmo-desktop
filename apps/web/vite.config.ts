import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { probeSink } from "../../tooling/vite/probeSink";

export default defineConfig({
  plugins: [react(), probeSink()],
  server: {
    port: 5173,
    headers: {
      // SharedArrayBuffer (audio clock, wa-sqlite OPFS) needs cross-origin isolation.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
