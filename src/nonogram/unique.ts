import { filledCount, type Bitmap } from "./bitmap.ts";
import { cluesOf } from "./clues.ts";
import { countSolutions, propagate, UNKNOWN } from "./solver.ts";

// Uniqueness checks for every puzzle source, and an auto-fix that flips a few pixels.

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "full" | "multiple" | "unknown" | "size" };

export const CHECK_BUDGET = 20000;

export function checkPuzzle(bitmap: Bitmap, budget = CHECK_BUDGET): CheckResult {
  if (bitmap.w < 2 || bitmap.h < 2 || bitmap.w > 20 || bitmap.h > 20) return { ok: false, reason: "size" };
  const filled = filledCount(bitmap);
  if (filled === 0) return { ok: false, reason: "empty" };
  if (filled === bitmap.cells.length) return { ok: false, reason: "full" };
  const result = countSolutions(cluesOf(bitmap), 2, budget);
  if (result.count >= 2) return { ok: false, reason: "multiple" };
  if (result.exhausted || result.count === 0) return { ok: false, reason: "unknown" };
  return { ok: true };
}

function unknownAfterPropagation(bitmap: Bitmap): number {
  const { grid } = propagate(cluesOf(bitmap));
  let n = 0;
  for (const v of grid) if (v === UNKNOWN) n++;
  return n;
}

export type FixResult = { ok: true; bitmap: Bitmap; flipped: number[] } | { ok: false; bitmap: Bitmap; flipped: number[] };

/**
 * Greedy repair: while the picture has another solution, look at the cells where two
 * solutions differ (or that propagation leaves open) and flip the one pixel that leaves
 * the fewest open cells. Stops after `maxFlips`. The result is verified with the counter.
 */
export function autoFix(input: Bitmap, maxFlips = 12, budget = CHECK_BUDGET): FixResult {
  let bitmap: Bitmap = { w: input.w, h: input.h, cells: new Uint8Array(input.cells) };
  const flipped: number[] = [];
  for (let step = 0; step <= maxFlips; step++) {
    const check = checkPuzzle(bitmap, budget);
    if (check.ok) return { ok: true, bitmap, flipped };
    if (check.reason === "empty" || check.reason === "full" || check.reason === "size") return { ok: false, bitmap, flipped };
    if (step === maxFlips) break;
    const result = countSolutions(cluesOf(bitmap), 2, budget);
    let candidates: number[] = [];
    if (result.solutions.length >= 2) {
      const [a, b] = result.solutions;
      for (let i = 0; i < bitmap.cells.length; i++) if (a?.[i] !== b?.[i]) candidates.push(i);
    } else {
      const { grid } = propagate(cluesOf(bitmap));
      grid.forEach((v, i) => v === UNKNOWN && candidates.push(i));
    }
    if (candidates.length > 32) candidates = candidates.filter((_, n) => n % Math.ceil(candidates.length / 32) === 0);
    let best = -1;
    let bestScore = Infinity;
    for (const index of candidates) {
      const next = new Uint8Array(bitmap.cells);
      next[index] = next[index] ? 0 : 1;
      const trial = { w: bitmap.w, h: bitmap.h, cells: next };
      const filled = filledCount(trial);
      if (filled === 0 || filled === next.length) continue;
      const score = unknownAfterPropagation(trial);
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (best < 0) break;
    const next = new Uint8Array(bitmap.cells);
    next[best] = next[best] ? 0 : 1;
    bitmap = { w: bitmap.w, h: bitmap.h, cells: next };
    flipped.push(best);
  }
  return { ok: false, bitmap, flipped };
}
