import type { Bitmap } from "./bitmap.ts";
import { lineClue, sameClue, type Clues } from "./clues.ts";
import { propagate, UNKNOWN, type Known } from "./solver.ts";

// Player state: 0 blank, 1 filled, 2 marked X.
export type CellState = 0 | 1 | 2;
export const BLANK = 0;
export const FILLED = 1;
export const MARKED = 2;

export type Change = { index: number; before: CellState; after: CellState };
export type History = { undo: Change[][]; redo: Change[][] };
export const HISTORY_LIMIT = 500;

export function emptyHistory(): History {
  return { undo: [], redo: [] };
}

/** Applies one batch (a click or a whole drag). Unchanged cells are dropped; an empty batch is a no-op. */
export function applyBatch(cells: readonly CellState[], history: History, changes: readonly Change[]): { cells: CellState[]; history: History } {
  const real = changes.filter((c) => c.before !== c.after && cells[c.index] === c.before);
  if (real.length === 0) return { cells: [...cells], history };
  const next = [...cells];
  for (const c of real) next[c.index] = c.after;
  return { cells: next, history: { undo: [...history.undo, real].slice(-HISTORY_LIMIT), redo: [] } };
}

export function undo(cells: readonly CellState[], history: History): { cells: CellState[]; history: History; changed: boolean } {
  const batch = history.undo[history.undo.length - 1];
  if (!batch) return { cells: [...cells], history, changed: false };
  const next = [...cells];
  for (const c of batch) next[c.index] = c.before;
  return { cells: next, history: { undo: history.undo.slice(0, -1), redo: [...history.redo, batch] }, changed: true };
}

export function redo(cells: readonly CellState[], history: History): { cells: CellState[]; history: History; changed: boolean } {
  const batch = history.redo[history.redo.length - 1];
  if (!batch) return { cells: [...cells], history, changed: false };
  const next = [...cells];
  for (const c of batch) next[c.index] = c.after;
  return { cells: next, history: { undo: [...history.undo, batch], redo: history.redo.slice(0, -1) }, changed: true };
}

/** Click semantics: fill toggles filled/blank, mark toggles marked/blank, clear blanks. */
export function nextState(current: CellState, action: "fill" | "mark" | "clear"): CellState {
  if (action === "clear") return BLANK;
  if (action === "fill") return current === FILLED ? BLANK : FILLED;
  return current === MARKED ? BLANK : MARKED;
}

/** Solved when the filled cells equal the picture; X marks do not matter. */
export function isSolved(cells: readonly CellState[], solution: Bitmap): boolean {
  for (let i = 0; i < solution.cells.length; i++) if ((cells[i] === FILLED ? 1 : 0) !== solution.cells[i]) return false;
  return true;
}

/** Lines whose filled cells already match their clue (for highlighting the numbers). */
export function satisfiedLines(cells: readonly CellState[], clues: Clues): { rows: boolean[]; cols: boolean[] } {
  const w = clues.cols.length;
  const h = clues.rows.length;
  const rows: boolean[] = [];
  const cols: boolean[] = [];
  for (let y = 0; y < h; y++) {
    const line: number[] = [];
    for (let x = 0; x < w; x++) line.push(cells[y * w + x] === FILLED ? 1 : 0);
    rows.push(sameClue(lineClue(line), clues.rows[y] ?? []));
  }
  for (let x = 0; x < w; x++) {
    const line: number[] = [];
    for (let y = 0; y < h; y++) line.push(cells[y * w + x] === FILLED ? 1 : 0);
    cols.push(sameClue(lineClue(line), clues.cols[x] ?? []));
  }
  return { rows, cols };
}

export type Hint = { index: number; value: 0 | 1; kind: "fix" | "deduced" | "random" };

/**
 * One cell to reveal. A wrong cell (filled but empty in the picture, or X on a filled
 * cell) is corrected first. Otherwise the line solver runs from what the player already
 * has right and reveals the first cell it can deduce that the player has not set; if
 * propagation alone cannot deduce one, a random correct open cell is revealed.
 */
export function findHint(cells: readonly CellState[], solution: Bitmap, clues: Clues, rand: () => number = Math.random): Hint | null {
  const n = solution.cells.length;
  for (let i = 0; i < n; i++) {
    const want = solution.cells[i];
    if (cells[i] === FILLED && want === 0) return { index: i, value: 0, kind: "fix" };
    if (cells[i] === MARKED && want === 1) return { index: i, value: 1, kind: "fix" };
  }
  const known: Known[] = [];
  for (let i = 0; i < n; i++) known.push(cells[i] === FILLED ? 1 : cells[i] === MARKED ? 0 : UNKNOWN);
  const done = (i: number) => (solution.cells[i] === 1 ? cells[i] === FILLED : cells[i] === MARKED);
  const { grid, contradiction } = propagate(clues, known);
  if (!contradiction) {
    // Prefer filled cells: they are more useful than an X.
    for (const value of [1, 0] as const) {
      for (let i = 0; i < n; i++) if (known[i] === UNKNOWN && grid[i] === value && !done(i)) return { index: i, value, kind: "deduced" };
    }
  }
  const open: number[] = [];
  for (let i = 0; i < n; i++) if (!done(i) && solution.cells[i] === 1) open.push(i);
  if (open.length === 0) return null;
  const index = open[Math.min(open.length - 1, Math.floor(rand() * open.length))] ?? open[0]!;
  return { index, value: 1, kind: "random" };
}

/** Player cells as a compact string, one digit per cell. */
export function encodeCells(cells: readonly CellState[]): string {
  return cells.join("");
}

export function decodeCells(text: unknown, count: number): CellState[] | null {
  if (typeof text !== "string" || text.length !== count || !/^[012]*$/.test(text)) return null;
  return [...text].map((c) => Number(c) as CellState);
}

export function moveCursor(index: number, w: number, h: number, dir: "up" | "down" | "left" | "right" | "home" | "end"): number {
  const x = index % w;
  const y = Math.floor(index / w);
  switch (dir) {
    case "up":
      return y > 0 ? index - w : index;
    case "down":
      return y < h - 1 ? index + w : index;
    case "left":
      return x > 0 ? index - 1 : index;
    case "right":
      return x < w - 1 ? index + 1 : index;
    case "home":
      return y * w;
    case "end":
      return y * w + w - 1;
  }
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
