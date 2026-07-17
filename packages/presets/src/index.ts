import type { GradeOps } from "@osmo/color-engine";
import { defaultOps } from "@osmo/color-engine";

/**
 * Built-in filter presets, Mimo 大师滤镜-style — expressed purely in grade
 * parameters (no LUT files), so they stay editable after applying and
 * portable through the same grade JSON as everything else.
 *
 * A preset owns only the LOOK fields below; the user's corrections (input
 * transform, white balance, exposure, sharpen/denoise) are never touched.
 */
export interface FilterPreset {
  id: string;
  name: string;
  /** Overrides applied over neutral look fields. */
  ops: Partial<GradeOps>;
}

/** The fields a preset owns — reset to neutral before applying overrides so
 * switching presets never accumulates. */
const LOOK_FIELDS = [
  "saturation",
  "vibrance",
  "splitTone",
  "fade",
  "hsl",
  "vignette",
  "wheels",
] as const;

export function applyPreset(current: GradeOps, preset: FilterPreset): GradeOps {
  const neutral = defaultOps();
  const next: GradeOps = { ...current };
  for (const f of LOOK_FIELDS) {
    (next as unknown as Record<string, unknown>)[f] = neutral[f];
  }
  next.tonal = { ...current.tonal, contrast: 0 };
  next.detail = { ...current.detail, grain: 0 };
  const o = preset.ops;
  return {
    ...next,
    ...o,
    tonal: { ...next.tonal, ...(o.tonal ?? {}) },
    detail: { ...next.detail, ...(o.detail ?? {}) },
    splitTone: { ...next.splitTone, ...(o.splitTone ?? {}) },
    vignette: { ...next.vignette, ...(o.vignette ?? {}) },
    hsl: { ...next.hsl, ...(o.hsl ?? {}) },
    wheels: { ...next.wheels, ...(o.wheels ?? {}) },
  };
}

const desatBand = { h: 0, s: -100, l: 0 };

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "none", name: "原片", ops: {} },
  {
    id: "vivid",
    name: "鲜明",
    ops: { saturation: 22, vibrance: 12, tonal: { ...defaultOps().tonal, contrast: 14 } },
  },
  {
    id: "soft",
    name: "柔和",
    ops: { saturation: -10, fade: 18, tonal: { ...defaultOps().tonal, contrast: -12 } },
  },
  {
    id: "cinematic",
    name: "电影感",
    ops: {
      tonal: { ...defaultOps().tonal, contrast: 12, blacks: -8 },
      splitTone: { shadowHue: 205, shadowSat: 32, highlightHue: 32, highlightSat: 22, balance: 0 },
      saturation: -6,
      vignette: { amount: -12, midpoint: 55, roundness: 0, feather: 70 },
    },
  },
  {
    id: "film",
    name: "胶片",
    ops: {
      fade: 24,
      saturation: -8,
      detail: { sharpen: 0, denoise: 0, grain: 32 },
      splitTone: { shadowHue: 180, shadowSat: 10, highlightHue: 45, highlightSat: 14, balance: 10 },
    },
  },
  {
    id: "blackgold",
    name: "黑金",
    ops: {
      tonal: { ...defaultOps().tonal, contrast: 16 },
      hsl: {
        ...defaultOps().hsl,
        red: { h: 10, s: -35, l: 0 },
        green: desatBand,
        aqua: desatBand,
        blue: desatBand,
        purple: desatBand,
        magenta: desatBand,
        yellow: { h: 12, s: -10, l: 0 },
        orange: { h: 0, s: 10, l: 0 },
      },
      vignette: { amount: -18, midpoint: 50, roundness: 0, feather: 60 },
    },
  },
  {
    id: "fresh",
    name: "清新",
    ops: {
      vibrance: 18,
      tonal: { ...defaultOps().tonal, contrast: -6, shadows: 14 },
      splitTone: { shadowHue: 190, shadowSat: 8, highlightHue: 0, highlightSat: 0, balance: 0 },
      fade: 8,
    },
  },
  {
    id: "retro",
    name: "复古",
    ops: {
      fade: 28,
      saturation: -12,
      detail: { sharpen: 0, denoise: 0, grain: 24 },
      splitTone: { shadowHue: 250, shadowSat: 12, highlightHue: 40, highlightSat: 24, balance: -10 },
      vignette: { amount: -24, midpoint: 45, roundness: 0, feather: 55 },
    },
  },
  {
    id: "mono",
    name: "黑白",
    ops: {
      saturation: -100,
      tonal: { ...defaultOps().tonal, contrast: 18 },
      detail: { sharpen: 0, denoise: 0, grain: 14 },
    },
  },
  {
    id: "quiet",
    name: "静谧",
    ops: {
      tonal: { ...defaultOps().tonal, contrast: -4, highlights: -12 },
      splitTone: { shadowHue: 215, shadowSat: 20, highlightHue: 200, highlightSat: 8, balance: 0 },
      saturation: -14,
      vibrance: 6,
    },
  },
];
