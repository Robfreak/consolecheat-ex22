import type { Clue, Clues } from "./clues.ts";

// Cell knowledge: -1 unknown, 0 empty, 1 filled.
export type Known = -1 | 0 | 1;
export const UNKNOWN = -1;

/**
 * Leftmost and rightmost placement of the blocks in an empty line; cells covered by
 * the same block in both are certainly filled (the classic overlap rule).
 * Returns null if the clue does not fit.
 */
export function overlap(clue: Clue, length: number): Known[] | null {
  const need = clue.reduce((a, b) => a + b, 0) + Math.max(0, clue.length - 1);
  if (need > length) return null;
  const out: Known[] = Array(length).fill(UNKNOWN);
  if (clue.length === 0) return out.fill(0);
  const slack = length - need;
  let start = 0;
  for (const block of clue) {
    for (let i = start + slack; i < start + block; i++) out[i] = 1;
    start += block + 1;
  }
  return out;
}

/**
 * Exact line solver: every placement of the clue that agrees with the known cells,
 * merged. A cell is fixed when all placements agree. Dynamic programming, O(n·k).
 * Returns null when no placement fits (a contradiction).
 */
export function solveLine(clue: Clue, line: readonly Known[]): Known[] | null {
  const n = line.length;
  const k = clue.length;
  // canEmpty[i]: cells i..n-1 can all be empty.
  const canEmpty: boolean[] = Array(n + 1).fill(false);
  canEmpty[n] = true;
  for (let i = n - 1; i >= 0; i--) canEmpty[i] = canEmpty[i + 1] === true && line[i] !== 1;
  // fit[j][i]: blocks j..k-1 can be placed in cells i..n-1 (cell i may be the start of block j or empty).
  const fit: boolean[][] = Array.from({ length: k + 1 }, () => Array(n + 2).fill(false));
  for (let i = 0; i <= n + 1; i++) fit[k]![i] = i >= n ? true : canEmpty[i] === true;
  const blockFits = (j: number, i: number): boolean => {
    const len = clue[j] ?? 0;
    if (i + len > n) return false;
    for (let t = i; t < i + len; t++) if (line[t] === 0) return false;
    if (i + len < n && line[i + len] === 1) return false;
    return true;
  };
  for (let j = k - 1; j >= 0; j--) {
    const len = clue[j] ?? 0;
    for (let i = n; i >= 0; i--) {
      let ok = false;
      // Cell i empty, continue at i+1.
      if (i < n && line[i] !== 1 && fit[j]![i + 1]) ok = true;
      // Block j starts at i, then a gap (or the end).
      if (!ok && blockFits(j, i)) {
        const end = i + len;
        ok = end === n ? j === k - 1 : fit[j + 1]![end + 1] === true;
      }
      fit[j]![i] = ok;
    }
  }
  if (!fit[0]![0]) return null;
  // Forward pass: which (block, start) states are reachable, collect possible values.
  const canBe1: boolean[] = Array(n).fill(false);
  const canBe0: boolean[] = Array(n).fill(false);
  // reach[j][i]: we are at cell i with blocks j.. still to place, consistent so far.
  const reach: boolean[][] = Array.from({ length: k + 1 }, () => Array(n + 2).fill(false));
  reach[0]![0] = true;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= k; j++) {
      if (!reach[j]![i] || !fit[j]![i]) continue;
      if (j === k) {
        for (let t = i; t < n; t++) canBe0[t] = true;
        continue;
      }
      if (i >= n) continue;
      // Empty at i.
      if (line[i] !== 1 && fit[j]![i + 1]) {
        canBe0[i] = true;
        reach[j]![i + 1] = true;
      }
      // Block j at i.
      const len = clue[j] ?? 0;
      if (blockFits(j, i)) {
        const end = i + len;
        const next = end < n ? end + 1 : end;
        const restOk = j + 1 === k ? end >= n || canEmpty[end] === true : end < n && fit[j + 1]![end + 1] === true;
        if (restOk) {
          for (let t = i; t < end; t++) canBe1[t] = true;
          if (end < n) canBe0[end] = true;
          reach[j + 1]![next] = true;
        }
      }
    }
  }
  const out: Known[] = [];
  for (let i = 0; i < n; i++) {
    if (canBe1[i] && canBe0[i]) out.push(UNKNOWN);
    else if (canBe1[i]) out.push(1);
    else if (canBe0[i]) out.push(0);
    else return null;
  }
  return out;
}

export type PropagateResult = { grid: Known[]; contradiction: boolean };

/** Line-by-line propagation until nothing changes. */
export function propagate(clues: Clues, start?: readonly Known[]): PropagateResult {
  const w = clues.cols.length;
  const h = clues.rows.length;
  const grid: Known[] = start ? [...start] : Array(w * h).fill(UNKNOWN);
  const dirtyRows = new Set(Array.from({ length: h }, (_, y) => y));
  const dirtyCols = new Set(Array.from({ length: w }, (_, x) => x));
  while (dirtyRows.size || dirtyCols.size) {
    for (const y of [...dirtyRows]) {
      dirtyRows.delete(y);
      const line = grid.slice(y * w, (y + 1) * w);
      const solved = solveLine(clues.rows[y] ?? [], line);
      if (!solved) return { grid, contradiction: true };
      for (let x = 0; x < w; x++) {
        if (line[x] === UNKNOWN && solved[x] !== UNKNOWN) {
          grid[y * w + x] = solved[x] as Known;
          dirtyCols.add(x);
        }
      }
    }
    for (const x of [...dirtyCols]) {
      dirtyCols.delete(x);
      const line: Known[] = [];
      for (let y = 0; y < h; y++) line.push(grid[y * w + x] as Known);
      const solved = solveLine(clues.cols[x] ?? [], line);
      if (!solved) return { grid, contradiction: true };
      for (let y = 0; y < h; y++) {
        if (line[y] === UNKNOWN && solved[y] !== UNKNOWN) {
          grid[y * w + x] = solved[y] as Known;
          dirtyRows.add(y);
        }
      }
    }
  }
  return { grid, contradiction: false };
}

export type CountResult = {
  /** 0, 1, or 2 (meaning "two or more"). */
  count: number;
  /** True when the node budget ran out before an answer: treat as not verified. */
  exhausted: boolean;
  /** Up to two solutions found (filled = 1). */
  solutions: Known[][];
  nodes: number;
};

/**
 * Counts solutions up to `limit` (default 2) with propagation plus bounded backtracking.
 * Branches on the unknown cell with the most known neighbours in its lines.
 */
export function countSolutions(clues: Clues, limit = 2, budget = 20000): CountResult {
  const w = clues.cols.length;
  const solutions: Known[][] = [];
  let nodes = 0;
  let exhausted = false;
  const search = (start: readonly Known[] | undefined) => {
    if (solutions.length >= limit || exhausted) return;
    nodes++;
    if (nodes > budget) {
      exhausted = true;
      return;
    }
    const { grid, contradiction } = propagate(clues, start);
    if (contradiction) return;
    const unknown = grid.indexOf(UNKNOWN);
    if (unknown < 0) {
      solutions.push(grid);
      return;
    }
    // Pick the first unknown cell in the row with the fewest unknowns.
    let best = unknown;
    let bestCount = Infinity;
    for (let y = 0; y < clues.rows.length; y++) {
      let count = 0;
      let first = -1;
      for (let x = 0; x < w; x++) {
        if (grid[y * w + x] === UNKNOWN) {
          count++;
          if (first < 0) first = y * w + x;
        }
      }
      if (count > 0 && count < bestCount) {
        bestCount = count;
        best = first;
      }
    }
    for (const value of [1, 0] as const) {
      const next = [...grid];
      next[best] = value;
      search(next);
      if (solutions.length >= limit || exhausted) return;
    }
  };
  search(undefined);
  return { count: solutions.length, exhausted, solutions, nodes };
}

export type Uniqueness = "unique" | "multiple" | "none" | "unknown";

export function uniqueness(clues: Clues, budget?: number): Uniqueness {
  const result = countSolutions(clues, 2, budget);
  if (result.count >= 2) return "multiple";
  if (result.exhausted) return "unknown";
  return result.count === 1 ? "unique" : "none";
}

/** True when line propagation alone solves the puzzle (no guessing needed). */
export function lineSolvable(clues: Clues): boolean {
  const { grid, contradiction } = propagate(clues);
  return !contradiction && !grid.includes(UNKNOWN);
}
