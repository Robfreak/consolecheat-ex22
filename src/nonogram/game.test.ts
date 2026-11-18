import assert from "node:assert/strict";
import test from "node:test";
import { fromArt } from "./bitmap.ts";
import { cluesOf } from "./clues.ts";
import {
  applyBatch,
  decodeCells,
  emptyHistory,
  encodeCells,
  findHint,
  formatTime,
  isSolved,
  moveCursor,
  nextState,
  redo,
  satisfiedLines,
  undo,
  type CellState,
} from "./game.ts";
import { builtinBitmap, BUILTINS } from "./puzzles.ts";

const blank = (n: number) => new Array<CellState>(n).fill(0);

test("cell actions toggle fill and X, clear empties", () => {
  assert.equal(nextState(0, "fill"), 1);
  assert.equal(nextState(1, "fill"), 0);
  assert.equal(nextState(2, "fill"), 1);
  assert.equal(nextState(0, "mark"), 2);
  assert.equal(nextState(2, "mark"), 0);
  assert.equal(nextState(1, "clear"), 0);
});

test("undo and redo step through batches; a drag is one step", () => {
  let cells = blank(9);
  let history = emptyHistory();
  ({ cells, history } = applyBatch(cells, history, [{ index: 0, before: 0, after: 1 }]));
  ({ cells, history } = applyBatch(cells, history, [
    { index: 1, before: 0, after: 1 },
    { index: 2, before: 0, after: 1 },
  ]));
  assert.equal(encodeCells(cells), "111000000");
  assert.equal(history.undo.length, 2);
  let step = undo(cells, history);
  assert.ok(step.changed);
  assert.equal(encodeCells(step.cells), "100000000");
  step = undo(step.cells, step.history);
  assert.equal(encodeCells(step.cells), "000000000");
  assert.equal(undo(step.cells, step.history).changed, false);
  step = redo(step.cells, step.history);
  assert.equal(encodeCells(step.cells), "100000000");
  // A new change clears the redo stack.
  const branched = applyBatch(step.cells, step.history, [{ index: 8, before: 0, after: 2 }]);
  assert.equal(branched.history.redo.length, 0);
  assert.equal(encodeCells(branched.cells), "100000002");
  assert.equal(redo(branched.cells, branched.history).changed, false);
  // No-op batches add nothing.
  const same = applyBatch(branched.cells, branched.history, [{ index: 0, before: 1, after: 1 }]);
  assert.equal(same.history, branched.history);
});

test("solved means the filled cells match; X marks do not matter", () => {
  const solution = fromArt(["#.", ".#"]);
  assert.ok(isSolved([1, 0, 0, 1], solution));
  assert.ok(isSolved([1, 2, 2, 1], solution));
  assert.ok(!isSolved([1, 1, 0, 1], solution));
  assert.ok(!isSolved([2, 0, 0, 1], solution));
});

test("satisfied lines light up when their filled cells match the clue", () => {
  const solution = fromArt(["##.", "...", "#.#"]);
  const clues = cluesOf(solution);
  const state = satisfiedLines([1, 1, 0, 0, 0, 0, 0, 0, 0], clues);
  assert.deepEqual(state.rows, [true, true, false]);
  assert.deepEqual(state.cols, [false, true, false]);
  const done = satisfiedLines([...solution.cells] as CellState[], clues);
  assert.ok(done.rows.every(Boolean) && done.cols.every(Boolean));
});

test("hints reveal a correct cell and fix wrong ones first", () => {
  for (const b of BUILTINS) {
    const solution = builtinBitmap(b);
    const clues = cluesOf(solution);
    let cells = blank(solution.cells.length);
    let count = 0;
    while (!isSolved(cells, solution)) {
      const hint = findHint(cells, solution, clues, () => 0.5);
      assert.ok(hint, b.id);
      assert.equal(hint.value, solution.cells[hint.index], `${b.id} hint ${hint.index}`);
      cells = [...cells];
      cells[hint.index] = hint.value === 1 ? 1 : 2;
      assert.ok(++count <= solution.cells.length, `${b.id} terminates`);
    }
  }
  const solution = fromArt(["#.", ".#"]);
  const wrong = findHint([1, 1, 0, 0], solution, cluesOf(solution));
  assert.deepEqual(wrong, { index: 1, value: 0, kind: "fix" });
  const wrongX = findHint([2, 0, 0, 0], solution, cluesOf(solution));
  assert.deepEqual(wrongX, { index: 0, value: 1, kind: "fix" });
  const heart = builtinBitmap(BUILTINS[0]!);
  const first = findHint(blank(25), heart, cluesOf(heart));
  assert.equal(first?.kind, "deduced");
  assert.equal(findHint([...heart.cells].map((v) => (v ? 1 : 2)) as CellState[], heart, cluesOf(heart)), null);
});

test("hints fall back to a random correct cell when nothing can be deduced", () => {
  const solution = fromArt(["#.", ".#"]); // two solutions, so propagation deduces nothing
  const hint = findHint([0, 0, 0, 0], solution, cluesOf(solution), () => 0.99);
  assert.equal(hint?.kind, "random");
  assert.equal(solution.cells[hint!.index], 1);
});

test("cells encode, the cursor moves inside the grid, and time formats", () => {
  assert.deepEqual(decodeCells("0120", 4), [0, 1, 2, 0]);
  assert.equal(decodeCells("013", 3), null);
  assert.equal(decodeCells("01", 3), null);
  assert.equal(decodeCells(5, 1), null);
  assert.equal(moveCursor(0, 5, 5, "up"), 0);
  assert.equal(moveCursor(0, 5, 5, "down"), 5);
  assert.equal(moveCursor(4, 5, 5, "right"), 4);
  assert.equal(moveCursor(7, 5, 5, "home"), 5);
  assert.equal(moveCursor(7, 5, 5, "end"), 9);
  assert.equal(moveCursor(24, 5, 5, "down"), 24);
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(61_500), "1:01");
  assert.equal(formatTime(3_725_000), "1:02:05");
});
