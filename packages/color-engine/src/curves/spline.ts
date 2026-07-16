import type { CurvePoints } from "../grade/schema";

/**
 * Monotone cubic interpolation (Fritsch–Carlson), the standard for tone
 * curves: passes through every control point without overshoot/ringing.
 * Empty/1-point input yields identity. Output is baked into 1D LUTs that
 * the shader samples.
 */
export function bakeCurveLut(points: CurvePoints, size = 1024, identity: "diagonal" | "zero" = "diagonal"): Float32Array {
  const out = new Float32Array(size);
  if (points.length === 0) {
    for (let i = 0; i < size; i++) out[i] = identity === "diagonal" ? i / (size - 1) : 0;
    return out;
  }
  const pts = normalizePoints(points, identity);
  const evalAt = buildMonotoneSpline(pts);
  for (let i = 0; i < size; i++) {
    out[i] = evalAt(i / (size - 1));
  }
  return out;
}

/** Sort by x, dedupe, and pin virtual endpoints so the curve covers [0,1]. */
function normalizePoints(points: CurvePoints, identity: "diagonal" | "zero"): CurvePoints {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const deduped: CurvePoints = [];
  for (const p of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6) deduped[deduped.length - 1] = p;
    else deduped.push(p);
  }
  const first = deduped[0]!;
  const last = deduped[deduped.length - 1]!;
  const endpointY = (x: number): number => (identity === "diagonal" ? x : 0);
  if (first[0] > 1e-6) deduped.unshift([0, deduped.length === 1 ? endpointY(0) : first[1]]);
  if (last[0] < 1 - 1e-6) deduped.push([1, deduped.length === 1 ? endpointY(1) : last[1]]);
  if (deduped.length === 1) {
    const [x, y] = deduped[0]!;
    return [
      [0, y - (identity === "diagonal" ? x : 0)],
      [1, y + (identity === "diagonal" ? 1 - x : 0)],
    ];
  }
  return deduped;
}

function buildMonotoneSpline(pts: CurvePoints): (x: number) => number {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);

  const dx: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1]! - xs[i]!;
    dx.push(h);
    slopes.push((ys[i + 1]! - ys[i]!) / h);
  }

  // Fritsch–Carlson tangents
  const m: number[] = [slopes[0]!];
  for (let i = 1; i < n - 1; i++) {
    const s0 = slopes[i - 1]!;
    const s1 = slopes[i]!;
    if (s0 * s1 <= 0) {
      m.push(0);
    } else {
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      m.push((w1 + w2) / (w1 / s0 + w2 / s1));
    }
  }
  m.push(slopes[n - 2]!);

  return (x: number): number => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid]! <= x) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const h = dx[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[i]! + h10 * h * m[i]! + h01 * ys[i + 1]! + h11 * h * m[i + 1]!;
  };
}
