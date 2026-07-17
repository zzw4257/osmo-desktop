import type { Plugin } from "vite";

/**
 * Dev-only sink: the app POSTs capability/precision probe results here so
 * they land in the terminal — the only way to observe them from inside the
 * Tauri (WKWebView) window without devtools attached.
 */
export function probeSink(): Plugin {
  return {
    name: "osmo-probe-sink",
    configureServer(server) {
      server.middlewares.use("/__probe-result", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString()));
        req.on("end", () => {
          console.log(`\n[PROBE-RESULT] ${body}\n`);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}
