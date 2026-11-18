import assert from "node:assert/strict";
import test from "node:test";
import { fromArt, makeBitmap } from "./bitmap.ts";
import { cluesOf, lineClue, sameClue } from "./clues.ts";
import { countSolutions, lineSolvable, overlap, propagate, solveLine, uniqueness, UNKNOWN, type Known } from "./solver.ts";
import { mulberry32 } from "./prng.ts";

const U = UNKNOWN;

test("clues count the filled runs of a line; an empty line has no runs", () => {
  assert.deepEqual(lineClue([1, 1, 0, 1, 0, 1, 1, 1]), [2, 1, 3]);
  assert.deepEqual(lineClue([0, 0, 0]), []);
  assert.deepEqual(lineClue([1, 1, 1, 1, 1]), [5]);
  const clues = cluesOf(fromArt(["##.", ".#.", "#.#"]));
  assert.deepEqual(clues.rows, [[2], [1], [1, 1]]);
  assert.deepEqual(clues.cols, [[1, 1], [2], [1]]);
  assert.ok(sameClue([1, 2], [1, 2]));
  assert.ok(!sameClue([1, 2], [2, 1]));
});

test("overlap finds the cells every placement shares", () => {
  assert.deepEqual(overlap([3], 5), [U, U, 1, U, U]);
  assert.deepEqual(overlap([5], 5), [1, 1, 1, 1, 1]);
  assert.deepEqual(overlap([2, 2], 5), [1, 1, U, 1, 1]);
  assert.equal(overlap([3, 3], 6), null);
});

test("the line solver deduces known cases and reports contradictions", () => {
  assert.deepEqual(solveLine([3], [U, U, U, U, U]), [U, U, 1, U, U]);
  assert.deepEqual(solveLine([2], [0, 1, U, U, U]), [0, 1, 1, 0, 0]);
  assert.deepEqual(solveLine([], [U, U, U]), [0, 0, 0]);
  assert.deepEqual(solveLine([1, 1], [U, U, U]), [1, 0, 1]);
  assert.deepEqual(solveLine([4], [U, U, U, U, 1, U, U, U]), [0, U, U, U, 1, U, U, U]);
  assert.equal(solveLine([3], [1, 0, U, U, U]), null);
  assert.equal(solveLine([], [U, 1]), null);
});

test("the line solver matches brute force on random lines", () => {
  const rand = mulberry32(22);
  for (let round = 0; round < 3000; round++) {
    const n = 1 + Math.floor(rand() * 9);
    const truth = Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0));
    const clue = lineClue(truth);
    const line: Known[] = truth.map((v) => (rand() < 0.3 ? (rand() < 0.15 ? ((1 - v) as Known) : (v as Known)) : U));
    // Brute force: every assignment consistent with the line and the clue.
    let any = false;
    const agree: (number | null)[] = new Array(n).fill(null);
    for (let mask = 0; mask < 1 << n; mask++) {
      const cand = Array.from({ length: n }, (_, i) => (mask >> i) & 1);
      if (cand.some((v, i) => line[i] !== U && line[i] !== v)) continue;
      if (!sameClue(lineClue(cand), clue)) continue;
      for (let i = 0; i < n; i++) agree[i] = !any ? cand[i]! : agree[i] === cand[i] ? agree[i]! : -1;
      any = true;
    }
    const got = solveLine(clue, line);
    if (!any) {
      assert.equal(got, null);
      continue;
    }
    assert.deepEqual(got, agree.map((v) => (v === -1 ? U : v)), `${clue} ${line}`);
  }
});

test("propagation solves a line-solvable puzzle and flags contradictions", () => {
  const bitmap = fromArt(["#.#", "###", "#.#"]);
  const { grid, contradiction } = propagate(cluesOf(bitmap));
  assert.equal(contradiction, false);
  assert.deepEqual(grid, [...bitmap.cells]);
  assert.ok(lineSolvable(cluesOf(bitmap)));
  assert.equal(propagate({ rows: [[2], []], cols: [[1], []] }).contradiction, true);
});

test("solution counting: unique, the non-unique 2×2 diagonal, empty and impossible", () => {
  const diagonal = fromArt(["#.", ".#"]);
  const counted = countSolutions(cluesOf(diagonal));
  assert.equal(counted.count, 2);
  assert.equal(counted.exhausted, false);
  assert.equal(uniqueness(cluesOf(diagonal)), "multiple");
  assert.equal(countSolutions(cluesOf(fromArt(["##", "#."]))).count, 1);
  assert.equal(uniqueness(cluesOf(fromArt(["##", "#."]))), "unique");
  const empty = makeBitmap(3, 2);
  assert.equal(countSolutions(cluesOf(empty)).count, 1);
  assert.equal(uniqueness({ rows: [[2], [2]], cols: [[1], [], [1]] }), "none");
  // A larger puzzle that needs backtracking beyond the line solver.
  const hard = fromArt(["#..#.", ".##..", "#...#", "..#.#", ".#..."]);
  const result = countSolutions(cluesOf(hard));
  assert.ok(result.count >= 1 && result.count <= 2);
});
