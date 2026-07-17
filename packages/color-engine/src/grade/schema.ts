import type { ColorProfile } from "@osmo/shared";

/**
 * Grade document — the persisted/shareable color state of one clip.
 *
 * The op order is FIXED and is part of the schema semantics:
 *   input transform → white balance → tonal → wheels → curves →
 *   hsl → saturation/vibrance → split tone → fade → creative LUT →
 *   grain → vignette → denoise → sharpen
 * Bump `schemaVersion` if that order (or any op's math) changes meaning.
 * Missing keys are filled with defaults on load (forward compatibility).
 */
export const GRADE_SCHEMA_VERSION = 1;

/** RGBA-style wheel value: [r, g, b, master], each typically in [-1, 1]. */
export type WheelValue = [number, number, number, number];

/** Curve control points, x/y in [0,1], sorted by x. Empty = identity. */
export type CurvePoints = Array<[number, number]>;

export interface InputTransform {
  profile: ColorProfile;
  /** Content hash of an input .cube LUT (dlog-m / dlog2 paths); null when
   * the profile is handled mathematically (dlog CST, hlg tone map, rec709). */
  inputLut: string | null;
  /** 0..1 blend between bypass and the transform — Mimo can't do this. */
  strength: number;
}

export interface GradeOps {
  whiteBalance: { temp: number; tint: number };
  tonal: {
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
  };
  wheels: {
    lift: WheelValue;
    gamma: WheelValue;
    gain: WheelValue;
    offset: WheelValue;
  };
  curves: {
    luma: CurvePoints;
    red: CurvePoints;
    green: CurvePoints;
    blue: CurvePoints;
    hueVsHue: CurvePoints;
    hueVsSat: CurvePoints;
  };
  /** 8 fixed hue bands, Lightroom-style color mixer. Values in [-100, 100]. */
  hsl: Record<HslBand, { h: number; s: number; l: number }>;
  saturation: number;
  vibrance: number;
  splitTone: {
    shadowHue: number;
    shadowSat: number;
    highlightHue: number;
    highlightSat: number;
    balance: number;
  };
  fade: number;
  creativeLut: { hash: string; strength: number } | null;
  detail: { sharpen: number; denoise: number; grain: number };
  vignette: { amount: number; midpoint: number; roundness: number; feather: number };
}

export type HslBand =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "aqua"
  | "blue"
  | "purple"
  | "magenta";

export const HSL_BANDS: readonly HslBand[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
];

export interface Grade {
  schemaVersion: number;
  input: InputTransform;
  ops: GradeOps;
  /** Content hashes of every LUT this grade references, for share bundles. */
  lutRefs: string[];
  /** Active built-in filter preset (presets package), null = 原片/custom. */
  presetId: string | null;
}

const neutralWheel = (): WheelValue => [0, 0, 0, 0];

export function defaultOps(): GradeOps {
  return {
    whiteBalance: { temp: 0, tint: 0 },
    tonal: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    wheels: {
      lift: neutralWheel(),
      gamma: neutralWheel(),
      gain: neutralWheel(),
      offset: neutralWheel(),
    },
    curves: { luma: [], red: [], green: [], blue: [], hueVsHue: [], hueVsSat: [] },
    hsl: Object.fromEntries(
      HSL_BANDS.map((band) => [band, { h: 0, s: 0, l: 0 }]),
    ) as GradeOps["hsl"],
    saturation: 0,
    vibrance: 0,
    splitTone: { shadowHue: 0, shadowSat: 0, highlightHue: 0, highlightSat: 0, balance: 0 },
    fade: 0,
    creativeLut: null,
    detail: { sharpen: 0, denoise: 0, grain: 0 },
    vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50 },
  };
}

export function defaultGrade(profile: ColorProfile = "unknown"): Grade {
  return {
    schemaVersion: GRADE_SCHEMA_VERSION,
    input: { profile, inputLut: null, strength: 1 },
    ops: defaultOps(),
    lutRefs: [],
    presetId: null,
  };
}

/** Deep-merge a stored (possibly older/partial) grade over defaults so that
 * new ops added in later schema versions get neutral values. */
export function hydrateGrade(stored: unknown): Grade {
  const base = defaultGrade();
  if (typeof stored !== "object" || stored === null) return base;
  const s = stored as Partial<Grade>;
  const ops = { ...base.ops, ...(s.ops ?? {}) };
  // Nested objects need per-key merging too, or a stored v1 grade written
  // before a nested field existed would drop that field's default.
  for (const key of Object.keys(base.ops) as Array<keyof GradeOps>) {
    const def = base.ops[key];
    const got = (s.ops as Record<string, unknown> | undefined)?.[key];
    if (def !== null && typeof def === "object" && !Array.isArray(def) && got !== undefined) {
      (ops as Record<string, unknown>)[key] =
        got !== null && typeof got === "object" && !Array.isArray(got)
          ? { ...def, ...got }
          : got;
    }
  }
  return {
    schemaVersion: GRADE_SCHEMA_VERSION,
    input: { ...base.input, ...(s.input ?? {}) },
    ops,
    lutRefs: Array.isArray(s.lutRefs) ? s.lutRefs : [],
    presetId: typeof s.presetId === "string" ? s.presetId : null,
  };
}

/** A grade is "neutral" when it would render pixels unchanged (used for the
 * edit_state badge: none vs graded). */
export function isNeutralGrade(grade: Grade): boolean {
  return JSON.stringify(grade.ops) === JSON.stringify(defaultOps()) && grade.input.strength === 1
    ? grade.input.profile === "rec709" || grade.input.profile === "unknown"
    : false;
}
