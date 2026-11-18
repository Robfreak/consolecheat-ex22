import assert from "node:assert/strict";
import test from "node:test";
import { cluesOf } from "./clues.ts";
import { BUILTINS, builtinBitmap, findBuiltin } from "./puzzles.ts";
import { countSolutions } from "./solver.ts";
import { checkPuzzle } from "./unique.ts";

test("built-ins come in 5×5, 10×10 and 15×15 with names in both languages", () => {
  const sizes = new Set(BUILTINS.map((b) => b.art.length));
  assert.deepEqual([...sizes].sort((a, b) => a - b), [5, 10, 15]);
  const ids = new Set<string>();
  for (const b of BUILTINS) {
    assert.ok(!ids.has(b.id), b.id);
    ids.add(b.id);
    assert.ok(b.de && b.en, b.id);
    for (const line of b.art) assert.equal(line.length, b.art.length, b.id);
    assert.match(b.art.join(""), /^[#.]+$/);
  }
  assert.ok(BUILTINS.filter((b) => b.art.length === 5).length >= 3);
  assert.ok(BUILTINS.filter((b) => b.art.length === 10).length >= 3);
  assert.ok(BUILTINS.filter((b) => b.art.length === 15).length >= 3);
  assert.equal(findBuiltin("herz")?.de, "Herz");
});

test("every built-in puzzle is uniquely solvable", () => {
  for (const b of BUILTINS) {
    const bitmap = builtinBitmap(b);
    const result = countSolutions(cluesOf(bitmap), 2, 200000);
    assert.equal(result.count, 1, `${b.id} has ${result.count} solutions`);
    assert.equal(result.exhausted, false, b.id);
    assert.deepEqual(result.solutions[0], [...bitmap.cells], b.id);
    assert.deepEqual(checkPuzzle(bitmap), { ok: true }, b.id);
  }
});
