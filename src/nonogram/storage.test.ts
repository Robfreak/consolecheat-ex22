import assert from "node:assert/strict";
import test from "node:test";
import { fromArt } from "./bitmap.ts";
import { AVATAR_KEY, SPRITE_KEY } from "./sources.ts";
import {
  LANG_KEY,
  STORE_KEY,
  THEME_KEY,
  emptyStore,
  loadStore,
  parseStore,
  recordSolve,
  resetStore,
  saveStore,
  serializeStore,
  type Store,
} from "./storage.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(`set:${key}`);
      data.set(key, value);
    },
    removeItem: (key: string) => {
      writes.push(`remove:${key}`);
      data.delete(key);
    },
  };
}

function sample(): Store {
  const bitmap = fromArt(["#....", ".#...", "..#..", "...##", "....#"]);
  return {
    current: { puzzle: { id: "b-test", source: "builtin", title: "Test", bitmap }, cells: [1, 2, 0, 0, 0, ...new Array(20).fill(0)], elapsed: 12345, hints: 2, solved: false },
    solved: { "b-herz": { best: 30000, hints: 0, at: "2026-11-18T21:00:00.000Z", title: "Herz" } },
    mode: "mark",
  };
}

test("the store round-trips the puzzle, grid, time, hints, solved list and mode", () => {
  const local = memory();
  assert.ok(saveStore(local, sample()));
  assert.deepEqual(local.writes, [`set:${STORE_KEY}`]);
  const raw = JSON.parse(local.data.get(STORE_KEY)!);
  assert.equal(raw.schema, "consolecheat-nonogram");
  assert.equal(raw.version, 1);
  const { store, corrupt } = loadStore(local);
  assert.equal(corrupt, false);
  assert.equal(store.mode, "mark");
  assert.equal(store.current?.elapsed, 12345);
  assert.equal(store.current?.hints, 2);
  assert.deepEqual(store.current?.cells.slice(0, 3), [1, 2, 0]);
  assert.deepEqual([...store.current!.puzzle.bitmap.cells], [...sample().current!.puzzle.bitmap.cells]);
  assert.equal(store.solved["b-herz"]?.best, 30000);
  assert.equal(serializeStore(store), serializeStore(sample()));
});

test("corrupt, foreign or partly broken data falls back without crashing", () => {
  assert.deepEqual(parseStore(null), { store: emptyStore(), corrupt: false });
  assert.deepEqual(parseStore("{nope"), { store: emptyStore(), corrupt: true });
  assert.deepEqual(parseStore(JSON.stringify({ schema: "other", version: 1 })), { store: emptyStore(), corrupt: true });
  assert.deepEqual(parseStore(JSON.stringify({ schema: "consolecheat-nonogram", version: 2 })), { store: emptyStore(), corrupt: true });
  assert.deepEqual(parseStore("[]"), { store: emptyStore(), corrupt: true });
  const good = JSON.parse(serializeStore(sample()));
  const broken = { ...good, current: { ...good.current, cells: "9" }, solved: { ...good.solved, bad: { best: -1 } } };
  const result = parseStore(JSON.stringify(broken));
  assert.equal(result.corrupt, true);
  assert.equal(result.store.current, null);
  assert.ok(result.store.solved["b-herz"]);
  assert.equal(result.store.solved.bad, undefined);
  const badBits = { ...good, current: { ...good.current, puzzle: { ...good.current.puzzle, bits: "!!" } } };
  assert.equal(parseStore(JSON.stringify(badBits)).store.current, null);
  const throwing = {
    getItem(): string | null {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadStore(throwing).store, emptyStore());
  assert.equal(saveStore(throwing, sample()), false);
  assert.equal(resetStore(throwing), false);
});

test("reset removes only this tool's key; avatar, sprite, language and theme stay and are never written", () => {
  const others = {
    [AVATAR_KEY]: '{"version":1,"pixels":"4096:0"}',
    [SPRITE_KEY]: '{"version":1,"size":16,"frames":["256:0"],"index":0}',
    [LANG_KEY]: "en",
    [THEME_KEY]: "light",
    "consolecheat-ex6-merkliste-v1": "{}",
  };
  const local = memory(others);
  saveStore(local, sample());
  assert.ok(resetStore(local));
  assert.equal(local.data.has(STORE_KEY), false);
  for (const [key, value] of Object.entries(others)) assert.equal(local.data.get(key), value, key);
  assert.deepEqual(local.writes, [`set:${STORE_KEY}`, `remove:${STORE_KEY}`]);
});

test("solves keep the best time and cap the list", () => {
  let store = emptyStore();
  store = recordSolve(store, "a", "A", 50000, 1, new Date("2026-11-18T20:00:00Z"));
  store = recordSolve(store, "a", "A", 70000, 0, new Date("2026-11-18T21:00:00Z"));
  assert.equal(store.solved.a?.best, 50000);
  assert.equal(store.solved.a?.at, "2026-11-18T21:00:00.000Z");
  store = recordSolve(store, "a", "A", 20000, 3, new Date("2026-11-18T22:00:00Z"));
  assert.equal(store.solved.a?.best, 20000);
  assert.equal(store.solved.a?.hints, 3);
  for (let i = 0; i < 230; i++) store = recordSolve(store, `p${i}`, "P", 1000, 0, new Date());
  assert.equal(Object.keys(store.solved).length, 200);
  assert.equal(store.solved.a, undefined);
});
