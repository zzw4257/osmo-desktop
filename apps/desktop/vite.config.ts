import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { probeSink } from "../../tooling/vite/probeSink";

export default defineConfig({
  plugins: [react(), probeSink()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
