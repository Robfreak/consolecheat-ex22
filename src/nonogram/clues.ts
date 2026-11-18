import { column, row, type Bitmap } from "./bitmap.ts";

export type Clue = number[];
export type Clues = { rows: Clue[]; cols: Clue[] };

/** Run lengths of filled cells; an empty line has the clue [] (shown as 0). */
export function lineClue(line: ArrayLike<number>): Clue {
  const out: number[] = [];
  let run = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === 1) run++;
    else if (run > 0) {
      out.push(run);
      run = 0;
    }
  }
  if (run > 0) out.push(run);
  return out;
}

export function cluesOf(bitmap: Bitmap): Clues {
  const rows: Clue[] = [];
  const cols: Clue[] = [];
  for (let y = 0; y < bitmap.h; y++) rows.push(lineClue(row(bitmap, y)));
  for (let x = 0; x < bitmap.w; x++) cols.push(lineClue(column(bitmap, x)));
  return { rows, cols };
}

export function sameClue(a: Clue, b: Clue): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
