/**
 * Build an ExportArgs job JSON for the headless export-cli, using the exact
 * TS payload packer the app uses. Run with:
 *   node --experimental-strip-types tooling/scripts/gen-export-job.ts \
 *     <src> <out> <width> <height> <fps> <profile> <job.json> [exposure]
 */
import { writeFileSync } from "node:fs";
import { buildExportPayload } from "../../packages/color-engine/src/pipeline/exportPayload.ts";
import { defaultGrade } from "../../packages/color-engine/src/grade/schema.ts";
import type { ColorProfile } from "../../packages/shared/src/types.ts";

const [src, out, width, height, fps, profile, jobPath, exposure] = process.argv.slice(2);
if (!jobPath) {
  console.error("usage: gen-export-job.ts <src> <out> <w> <h> <fps> <profile> <job.json> [exposure]");
  process.exit(1);
}

const grade = defaultGrade(profile as ColorProfile);
if (exposure) grade.ops.tonal.exposure = Number(exposure);

const payload = buildExportPayload(grade, null, null);
const job = {
  srcPath: src,
  outPath: out,
  width: Number(width),
  height: Number(height),
  fps: Number(fps),
  bitrateMbps: 50,
  ...payload,
};
writeFileSync(jobPath!, JSON.stringify(job));
console.log(`job written: ${jobPath} (shader ${payload.shaderWgsl.length} chars)`);
