import { MAX_SIDE, MIN_SIDE, type Bitmap } from "./bitmap.ts";
import { decodeCells, type CellState } from "./game.ts";
import { base64UrlToBits, bitsToBase64Url } from "./share.ts";

// Own progress under one key. The avatar and sprite drafts are read elsewhere and never written.

export const STORE_KEY = "consolecheat-nonogram-v1";
export const LANG_KEY = "consolecheat-lang";
export const THEME_KEY = "consolecheat-theme";
export const SCHEMA = "consolecheat-nonogram";
export const VERSION = 1;
export const SOLVED_MAX = 200;
export const MAX_ELAPSED = 1000 * 60 * 60 * 100;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PuzzleSource = "builtin" | "image" | "avatar" | "sprite" | "link";
export type PuzzleRef = { id: string; source: PuzzleSource; title: string; bitmap: Bitmap };
export type Current = { puzzle: PuzzleRef; cells: CellState[]; elapsed: number; hints: number; solved: boolean };
export type SolvedEntry = { best: number; hints: number; at: string; title: string };
export type Mode = "fill" | "mark";
export type Store = { current: Current | null; solved: Record<string, SolvedEntry>; mode: Mode };
export type LoadResult = { store: Store; corrupt: boolean };

const SOURCES: readonly PuzzleSource[] = ["builtin", "image", "avatar", "sprite", "link"];

export function emptyStore(): Store {
  return { current: null, solved: {}, mode: "fill" };
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_ELAPSED;
}

function parsePuzzle(value: unknown): PuzzleRef | null {
  if (!plain(value)) return null;
  const { id, source, title, w, h, bits } = value;
  if (typeof id !== "string" || id.length > 80 || typeof title !== "string" || title.length > 80) return null;
  if (!SOURCES.includes(source as PuzzleSource)) return null;
  if (typeof w !== "number" || typeof h !== "number" || !Number.isInteger(w) || !Number.isInteger(h)) return null;
  if (w < MIN_SIDE || h < MIN_SIDE || w > MAX_SIDE || h > MAX_SIDE || typeof bits !== "string") return null;
  const cells = base64UrlToBits(bits, w * h);
  if (!cells) return null;
  return { id, source: source as PuzzleSource, title, bitmap: { w, h, cells } };
}

function parseCurrent(value: unknown): Current | null {
  if (!plain(value)) return null;
  const puzzle = parsePuzzle(value.puzzle);
  if (!puzzle) return null;
  const cells = decodeCells(value.cells, puzzle.bitmap.w * puzzle.bitmap.h);
  if (!cells || !validTime(value.elapsed)) return null;
  const hints = value.hints;
  if (typeof hints !== "number" || !Number.isInteger(hints) || hints < 0 || hints > 10000) return null;
  return { puzzle, cells, elapsed: value.elapsed, hints, solved: value.solved === true };
}

function parseSolved(value: unknown): SolvedEntry | null {
  if (!plain(value)) return null;
  const { best, hints, at, title } = value;
  if (!validTime(best) || typeof hints !== "number" || !Number.isInteger(hints) || hints < 0) return null;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || typeof title !== "string" || title.length > 80) return null;
  return { best, hints, at, title };
}

/** Never throws. Broken JSON, another schema or version: empty store, flagged. Bad parts are skipped. */
export function parseStore(raw: string | null): LoadResult {
  if (raw === null) return { store: emptyStore(), corrupt: false };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { store: emptyStore(), corrupt: true };
  }
  if (!plain(data) || data.schema !== SCHEMA || data.version !== VERSION) return { store: emptyStore(), corrupt: true };
  const store = emptyStore();
  let corrupt = false;
  if (data.current != null) {
    store.current = parseCurrent(data.current);
    if (!store.current) corrupt = true;
  }
  if (plain(data.solved)) {
    for (const [id, value] of Object.entries(data.solved).slice(0, SOLVED_MAX)) {
      const entry = id.length <= 80 ? parseSolved(value) : null;
      if (entry) store.solved[id] = entry;
      else corrupt = true;
    }
  } else if (data.solved !== undefined) corrupt = true;
  if (data.mode === "fill" || data.mode === "mark") store.mode = data.mode;
  else if (data.mode !== undefined) corrupt = true;
  return { store, corrupt };
}

export function serializeStore(store: Store): string {
  const current = store.current
    ? {
        puzzle: {
          id: store.current.puzzle.id,
          source: store.current.puzzle.source,
          title: store.current.puzzle.title,
          w: store.current.puzzle.bitmap.w,
          h: store.current.puzzle.bitmap.h,
          bits: bitsToBase64Url(store.current.puzzle.bitmap.cells),
        },
        cells: store.current.cells.join(""),
        elapsed: Math.round(store.current.elapsed),
        hints: store.current.hints,
        solved: store.current.solved,
      }
    : null;
  return JSON.stringify({ schema: SCHEMA, version: VERSION, current, solved: store.solved, mode: store.mode });
}

export function loadStore(local: StorageLike): LoadResult {
  try {
    return parseStore(local.getItem(STORE_KEY));
  } catch {
    return { store: emptyStore(), corrupt: false };
  }
}

/** Writes only STORE_KEY. */
export function saveStore(local: StorageLike, store: Store): boolean {
  try {
    local.setItem(STORE_KEY, serializeStore(store));
    return true;
  } catch {
    return false;
  }
}

/** Removes only this tool's key; avatar, sprite, language and theme stay. */
export function resetStore(local: StorageLike): boolean {
  try {
    local.removeItem(STORE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Records a solve; keeps the best (fastest) time. Oldest entries drop beyond the cap. */
export function recordSolve(store: Store, id: string, title: string, elapsed: number, hints: number, at: Date): Store {
  const before = store.solved[id];
  const better = !before || elapsed < before.best;
  const entry: SolvedEntry = better ? { best: Math.round(elapsed), hints, at: at.toISOString(), title } : { ...before, at: at.toISOString() };
  const solved = { ...store.solved };
  delete solved[id];
  solved[id] = entry;
  const ids = Object.keys(solved);
  while (ids.length > SOLVED_MAX) delete solved[ids.shift() as string];
  return { ...store, solved };
}
