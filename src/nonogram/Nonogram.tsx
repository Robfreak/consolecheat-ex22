import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bitmapId, MAX_SIDE, MIN_SIDE, type Bitmap } from "./bitmap.ts";
import { cluesOf } from "./clues.ts";
import {
  applyBatch,
  BLANK,
  emptyHistory,
  FILLED,
  findHint,
  formatTime,
  isSolved,
  MARKED,
  moveCursor,
  nextState,
  redo as redoBatch,
  satisfiedLines,
  undo as undoBatch,
  type CellState,
  type Change,
  type History,
} from "./game.ts";
import { DEFAULT_SIZE, SIZE_PRESETS, convertImage, type InkMode } from "./image.ts";
import { fill, type Copy, type Lang } from "./messages.ts";
import { BUILTINS, builtinBitmap, findBuiltin } from "./puzzles.ts";
import { decodeShare, encodeShare } from "./share.ts";
import { AVATAR_KEY, SPRITE_KEY, readAvatar, readSprite, type PixelImage } from "./sources.ts";
import { createPadPoller, isTypingTarget, keyAction, shortcutAllowed, type Action } from "./input.ts";
import { autoFix, checkPuzzle, type CheckResult } from "./unique.ts";
import { loadStore, recordSolve, saveStore, type Current, type Mode, type PuzzleRef, type StorageLike, type Store } from "./storage.ts";

const LONG_PRESS_MS = 450;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_SIDE = 512;

function browserStorage(): StorageLike | null {
  try {
    localStorage.getItem("consolecheat-theme");
    return localStorage;
  } catch {
    return null;
  }
}

function builtinRef(id: string, lang: Lang): PuzzleRef | null {
  const puzzle = findBuiltin(id);
  if (!puzzle) return null;
  return { id: `b-${puzzle.id}`, source: "builtin", title: lang === "de" ? puzzle.de : puzzle.en, bitmap: builtinBitmap(puzzle) };
}

function titleOf(ref: PuzzleRef, lang: Lang): string {
  if (ref.source === "builtin") {
    const found = findBuiltin(ref.id.replace(/^b-/, ""));
    if (found) return lang === "de" ? found.de : found.en;
  }
  return ref.title;
}

function freshCurrent(puzzle: PuzzleRef): Current {
  return { puzzle, cells: new Array<CellState>(puzzle.bitmap.w * puzzle.bitmap.h).fill(BLANK), elapsed: 0, hints: 0, solved: false };
}

type ImportSource = { kind: "image" | "avatar" | "sprite"; image: PixelImage; label: string; title: string };

function hasTransparency(image: PixelImage): boolean {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i]! < 250) return true;
  return false;
}

async function readPng(file: File): Promise<PixelImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(img, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function MiniGrid({ bitmap, flipped, label }: { bitmap: Bitmap; flipped?: readonly number[]; label: string }) {
  const size = Math.max(5, Math.min(12, Math.floor(180 / Math.max(bitmap.w, bitmap.h))));
  const flips = new Set(flipped ?? []);
  return (
    <div
      className="mini"
      role="img"
      aria-label={label}
      data-testid="preview"
      style={{ gridTemplateColumns: `repeat(${bitmap.w}, ${size}px)`, gridAutoRows: `${size}px` }}
    >
      {Array.from(bitmap.cells, (on, i) => (
        <span key={i} data-on={on} data-flip={flips.has(i) ? 1 : 0} />
      ))}
    </div>
  );
}

export function Nonogram({ text, lang }: { text: Copy; lang: Lang }) {
  const storage = useMemo(browserStorage, []);
  const initial = useMemo(() => (storage ? loadStore(storage) : { store: { current: null, solved: {}, mode: "fill" as Mode }, corrupt: false }), [storage]);
  const [store, setStore] = useState<Store>(initial.store);
  const [current, setCurrent] = useState<Current>(() => initial.store.current ?? freshCurrent(builtinRef("herz", lang)!));
  const [history, setHistory] = useState<History>(emptyHistory);
  const [mode, setMode] = useState<Mode>(initial.store.mode);
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "bad" | "info" } | null>(
    initial.corrupt ? { text: text.storeCorrupt, tone: "bad" } : null,
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const [started, setStarted] = useState(() => (initial.store.current?.elapsed ?? 0) > 0);
  const [tab, setTab] = useState<"builtin" | "import">("builtin");
  const [shareUrl, setShareUrl] = useState("");
  const [shareNote, setShareNote] = useState("");

  // Import controls.
  const [source, setSource] = useState<ImportSource | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [width, setWidth] = useState(DEFAULT_SIZE);
  const [height, setHeight] = useState(DEFAULT_SIZE);
  const [threshold, setThreshold] = useState(50);
  const [inkMode, setInkMode] = useState<InkMode>("alpha");
  const [invert, setInvert] = useState(false);
  const [trim, setTrim] = useState(true);
  const [fixed, setFixed] = useState<{ bitmap: Bitmap; flipped: number[] } | null>(null);
  const [fixFailed, setFixFailed] = useState(false);

  const { puzzle, cells, elapsed, hints, solved } = current;
  const { w, h } = puzzle.bitmap;
  const clues = useMemo(() => cluesOf(puzzle.bitmap), [puzzle]);
  const satisfied = useMemo(() => satisfiedLines(cells, clues), [cells, clues]);
  const title = titleOf(puzzle, lang);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const boardWrap = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState(340);

  const currentRef = useRef(current);
  currentRef.current = current;
  const historyRef = useRef(history);
  historyRef.current = history;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Persist own key only.
  useEffect(() => {
    if (!storage) return;
    const ok = saveStore(storage, { ...store, current, mode });
    setSaveFailed(!ok);
  }, [storage, store, current, mode]);

  // Timer: runs after the first move, pauses while the tab is hidden and once solved.
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const running = started && visible && !solved;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      if (document.hidden) return;
      setCurrent((c) => (c.solved ? c : { ...c, elapsed: Math.min(c.elapsed + delta, 1000 * 60 * 60 * 99) }));
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);

  // Cell size so 15×15 (and 20×20) fit at 390px.
  useLayoutEffect(() => {
    const el = boardWrap.current;
    if (!el) return;
    const measure = () => setBoardWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxRow = Math.max(1, ...clues.rows.map((c) => Math.max(1, c.length)));
  const maxCol = Math.max(1, ...clues.cols.map((c) => Math.max(1, c.length)));
  const clueFont = 11;
  const rowClueWidth = maxRow * 15 + 8;
  const cellSize = Math.max(14, Math.min(34, Math.floor((boardWidth - rowClueWidth - 4) / w)));
  const font = Math.max(clueFont, Math.min(14, Math.floor(cellSize * 0.45)));
  const rowClueW = maxRow * Math.round(font * 1.35) + 8;
  const colClueH = maxCol * Math.round(font * 1.2) + 6;

  const startPuzzle = useCallback(
    (ref: PuzzleRef, message?: string) => {
      const keep = currentRef.current.puzzle.id === ref.id;
      if (!keep) {
        setCurrent(freshCurrent(ref));
        setHistory(emptyHistory());
        setStarted(false);
        setCursor(0);
      }
      setShareUrl("");
      setShareNote("");
      setNotice(message ? { text: message, tone: "info" } : null);
    },
    [],
  );

  const finish = useCallback(
    (next: Current) => {
      if (next.solved || !isSolved(next.cells, next.puzzle.bitmap)) return next;
      const done = { ...next, solved: true };
      setStore((s) => recordSolve(s, next.puzzle.id, next.puzzle.title, next.elapsed, next.hints, new Date()));
      return done;
    },
    [],
  );

  const commit = useCallback(
    (changes: Change[], extra?: Partial<Current>) => {
      const c = currentRef.current;
      if (c.solved) return false;
      const result = applyBatch(c.cells, historyRef.current, changes);
      if (result.history === historyRef.current && !extra) return false;
      const next = finish({ ...c, ...extra, cells: result.cells });
      currentRef.current = next;
      historyRef.current = result.history;
      setCurrent(next);
      setHistory(result.history);
      setStarted(true);
      return true;
    },
    [finish],
  );

  const actOn = useCallback(
    (index: number, action: "fill" | "mark" | "clear") => {
      const c = currentRef.current;
      const before = c.cells[index] ?? BLANK;
      commit([{ index, before, after: nextState(before, action) }]);
    },
    [commit],
  );

  const doUndo = useCallback(() => {
    const c = currentRef.current;
    if (c.solved) return;
    const r = undoBatch(c.cells, historyRef.current);
    if (!r.changed) return;
    historyRef.current = r.history;
    const next = { ...c, cells: r.cells };
    currentRef.current = next;
    setHistory(r.history);
    setCurrent(next);
  }, []);

  const doRedo = useCallback(() => {
    const c = currentRef.current;
    if (c.solved) return;
    const r = redoBatch(c.cells, historyRef.current);
    if (!r.changed) return;
    historyRef.current = r.history;
    const next = finish({ ...c, cells: r.cells });
    currentRef.current = next;
    setHistory(r.history);
    setCurrent(next);
  }, [finish]);

  const doHint = useCallback(() => {
    const c = currentRef.current;
    if (c.solved) return;
    const hint = findHint(c.cells, c.puzzle.bitmap, cluesOf(c.puzzle.bitmap));
    if (!hint) {
      setNotice({ text: text.hintNone, tone: "info" });
      return;
    }
    const after: CellState = hint.value === 1 ? FILLED : MARKED;
    commit([{ index: hint.index, before: c.cells[hint.index] ?? BLANK, after }], { hints: c.hints + 1 });
    setCursor(hint.index);
    const values = {
      row: Math.floor(hint.index / c.puzzle.bitmap.w) + 1,
      col: (hint.index % c.puzzle.bitmap.w) + 1,
      state: text.cellStates[after],
    };
    setNotice({ text: fill(hint.kind === "fix" ? text.hintFixed : text.hintGiven, values), tone: "info" });
  }, [commit, text]);

  const restart = useCallback(() => {
    const c = currentRef.current;
    const next = freshCurrent(c.puzzle);
    currentRef.current = next;
    historyRef.current = emptyHistory();
    setCurrent(next);
    setHistory(emptyHistory());
    setStarted(false);
    setNotice(null);
  }, []);

  const focusCell = useCallback((index: number) => {
    const active = document.activeElement;
    const inGrid = active instanceof HTMLElement && active.dataset.index !== undefined;
    if (inGrid || active === document.body || active === null) cellRefs.current[index]?.focus({ preventScroll: false });
  }, []);

  const runAction = useCallback(
    (action: Action, fromPad: boolean) => {
      const c = currentRef.current;
      const bw = c.puzzle.bitmap.w;
      const bh = c.puzzle.bitmap.h;
      switch (action.type) {
        case "move": {
          const next = moveCursor(Math.min(cursorRef.current, bw * bh - 1), bw, bh, action.direction);
          cursorRef.current = next;
          setCursor(next);
          if (fromPad) focusCell(next);
          else cellRefs.current[next]?.focus();
          return;
        }
        case "fill":
        case "mark":
        case "clear":
          actOn(Math.min(cursorRef.current, bw * bh - 1), action.type);
          return;
        case "undo":
          doUndo();
          return;
        case "redo":
          doRedo();
          return;
        case "hint":
          doHint();
          return;
      }
    },
    [actOn, doHint, doRedo, doUndo, focusCell],
  );

  // Keyboard: grid keys only on a focused cell; undo/redo/hint anywhere but text fields.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction(event);
      if (!action) return;
      const target = event.target as HTMLElement | null;
      const onCell = target?.dataset?.index !== undefined;
      const global = action.type === "undo" || action.type === "redo" || action.type === "hint";
      if (!global && !onCell) return;
      if (!shortcutAllowed(target ? { tagName: target.tagName, type: (target as HTMLInputElement).type, isContentEditable: target.isContentEditable } : null, action)) return;
      event.preventDefault();
      runAction(action, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runAction]);

  // Gamepad, edge-triggered with first-poll seeding.
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    const poller = createPadPoller();
    let frame = 0;
    const loop = () => {
      const active = document.activeElement as HTMLElement | null;
      const like = active ? { tagName: active.tagName, type: (active as HTMLInputElement).type, isContentEditable: active.isContentEditable } : null;
      let pads: (Gamepad | null)[] = [];
      try {
        pads = Array.from(navigator.getGamepads());
      } catch {
        pads = [];
      }
      const actions = poller.poll(pads, isTypingTarget(like) || document.hidden);
      for (const action of actions) if (shortcutAllowed(like, action)) runAction(action, true);
      frame = requestAnimationFrame(loop);
    };
    const onDisconnect = (event: GamepadEvent) => poller.forget(event.gamepad.index);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, [runAction]);

  // Share links: #w=..&h=..&b=..; verified before opening.
  useEffect(() => {
    const open = () => {
      const result = decodeShare(location.hash);
      if (!result.ok) {
        if (result.error !== "none") setNotice({ text: text.linkErrors[result.error], tone: "bad" });
        return;
      }
      const check = checkPuzzle(result.bitmap);
      if (!check.ok) {
        setNotice({ text: text.linkErrors[check.reason === "size" ? "size" : check.reason], tone: "bad" });
        return;
      }
      const ref: PuzzleRef = { id: bitmapId(result.bitmap), source: "link", title: result.title || text.sharedTitle, bitmap: result.bitmap };
      startPuzzle(ref, text.linkOpened);
      window.history.replaceState(null, "", `${location.pathname}${location.search}`);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
    // The link is read on load and on hash changes; language changes do not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pointer: mouse left = tool, right = X; touch tap = tool, long press = X; drag repeats the first change.
  const drag = useRef<{ pointer: number; from: CellState; to: CellState; changes: Change[]; seen: Set<number>; timer: number; start: number; pending: boolean; touch: boolean } | null>(null);

  const paint = (index: number) => {
    const d = drag.current;
    if (!d || d.seen.has(index)) return;
    d.seen.add(index);
    const c = currentRef.current;
    if ((c.cells[index] ?? BLANK) !== d.from) return;
    d.changes.push({ index, before: d.from, after: d.to });
    const cellsNext = [...c.cells];
    cellsNext[index] = d.to;
    const next = { ...c, cells: cellsNext };
    currentRef.current = next;
    setCurrent(next);
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    window.clearTimeout(d.timer);
    if (d.pending) {
      // A short tap without moving: apply the tool once.
      actOn(d.start, mode);
      return;
    }
    if (d.changes.length === 0) return;
    // Rewind the live preview, then commit the whole drag as one undo step.
    const c = currentRef.current;
    const base = [...c.cells];
    for (const change of d.changes) base[change.index] = change.before;
    currentRef.current = { ...c, cells: base };
    commit(d.changes);
  };

  const beginDrag = (index: number, action: "fill" | "mark", pointer: number) => {
    const c = currentRef.current;
    const from = c.cells[index] ?? BLANK;
    drag.current = { pointer, from, to: nextState(from, action), changes: [], seen: new Set(), timer: 0, start: index, pending: false, touch: false };
    paint(index);
  };

  const cellFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const value = el?.closest<HTMLElement>("[data-index]")?.dataset.index;
    return value === undefined ? null : Number(value);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (currentRef.current.solved) return;
    setCursor(index);
    if (event.pointerType === "mouse") {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      event.currentTarget.focus();
      beginDrag(index, event.button === 2 ? "mark" : mode, event.pointerId);
      return;
    }
    // Touch or pen: wait for a long press or movement.
    const pointer = event.pointerId;
    const timer = window.setTimeout(() => {
      const d = drag.current;
      if (!d || d.pointer !== pointer || !d.pending) return;
      drag.current = null;
      beginDrag(index, "mark", pointer);
      if (navigator.vibrate) navigator.vibrate(15);
    }, LONG_PRESS_MS);
    drag.current = { pointer, from: BLANK, to: BLANK, changes: [], seen: new Set(), timer, start: index, pending: true, touch: true };
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointer !== event.pointerId) return;
      const index = cellFromPoint(event.clientX, event.clientY);
      if (index === null) return;
      if (d.pending) {
        if (index === d.start) return;
        window.clearTimeout(d.timer);
        const start = d.start;
        drag.current = null;
        beginDrag(start, mode, event.pointerId);
      }
      paint(index);
    };
    const up = (event: PointerEvent) => {
      if (drag.current && drag.current.pointer === event.pointerId) endDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  // Import pipeline.
  const converted = useMemo(() => {
    if (!source) return null;
    return convertImage(source.image, { w: width, h: height, threshold: threshold / 100, mode: inkMode, invert, trim });
  }, [source, width, height, threshold, inkMode, invert, trim]);
  const check: CheckResult | null = useMemo(() => (converted ? checkPuzzle(converted) : null), [converted]);
  useEffect(() => {
    setFixed(null);
    setFixFailed(false);
  }, [converted]);
  const ready = fixed ? fixed.bitmap : check?.ok ? converted : null;

  const loadSource = (next: ImportSource) => {
    setSource(next);
    setSourceError("");
    setInkMode(hasTransparency(next.image) ? "alpha" : "luminance");
    setInvert(false);
  };

  const importAvatar = () => {
    const result = readAvatar(storage);
    if (!result.ok) {
      setSourceError(text.sourceErrors[result.reason]);
      return;
    }
    loadSource({ kind: "avatar", image: result.image, label: fill(text.sourceAvatar, { key: AVATAR_KEY }), title: "Avatar" });
  };

  const importSprite = () => {
    const result = readSprite(storage);
    if (!result.ok) {
      setSourceError(text.sourceErrors[result.reason]);
      return;
    }
    loadSource({
      kind: "sprite",
      image: result.image,
      label: fill(text.sourceSprite, { key: SPRITE_KEY, frame: (result.frame ?? 0) + 1, frames: result.frames ?? 1 }),
      title: "Sprite",
    });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setSourceError(text.sourceErrors.fileSize);
      return;
    }
    try {
      const image = await readPng(file);
      const name = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || text.importTitle;
      loadSource({ kind: "image", image, label: fill(text.sourceFile, { name: file.name.slice(0, 60), w: image.width, h: image.height }), title: name });
    } catch {
      setSourceError(text.sourceErrors.file);
    }
  };

  const runFix = () => {
    if (!converted) return;
    const result = autoFix(converted);
    if (result.ok) {
      setFixed({ bitmap: result.bitmap, flipped: result.flipped });
      setFixFailed(false);
    } else {
      setFixed(null);
      setFixFailed(true);
    }
  };

  const startImport = () => {
    if (!ready || !source) return;
    const verify = checkPuzzle(ready);
    if (!verify.ok) return;
    startPuzzle({ id: bitmapId(ready), source: source.kind, title: source.title, bitmap: ready });
    requestAnimationFrame(() => document.getElementById("nonogram-board")?.scrollIntoView({ block: "start" }));
  };

  const share = async () => {
    const url = `${location.origin}${location.pathname}${encodeShare(puzzle.bitmap, puzzle.source === "builtin" ? title : puzzle.title)}`;
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setShareNote(text.shareCopied);
    } catch {
      setShareNote(text.shareManual);
    }
  };

  const solvedEntry = store.solved[puzzle.id];
  const sizes = [5, 10, 15];

  return (
    <div className="flex flex-col gap-6">
      <section className="panel rounded-xl p-3 sm:p-5" aria-labelledby="sources-heading">
        <h3 id="sources-heading" className="font-display text-xl font-semibold tracking-tight">
          {text.sourcesHeading}
        </h3>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={text.sourcesHeading}>
          <button type="button" className="chip" aria-pressed={tab === "builtin"} onClick={() => setTab("builtin")} data-testid="tab-builtin">
            {text.tabBuiltin}
          </button>
          <button type="button" className="chip" aria-pressed={tab === "import"} onClick={() => setTab("import")} data-testid="tab-import">
            {text.tabImport}
          </button>
        </div>
        {tab === "builtin" ? (
          <div className="mt-4 flex flex-col gap-4">
            {sizes.map((size) => (
              <div key={size}>
                <h4 className="text-sm font-semibold text-muted">{fill(text.sizeGroup, { w: size, h: size })}</h4>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {BUILTINS.filter((b) => b.art.length === size).map((b) => {
                    const id = `b-${b.id}`;
                    const entry = store.solved[id];
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          className="chip flex-col !items-start"
                          aria-current={puzzle.id === id}
                          data-testid={`builtin-${b.id}`}
                          onClick={() => startPuzzle(builtinRef(b.id, lang)!)}
                        >
                          <span>{lang === "de" ? b.de : b.en}</span>
                          {entry ? <span className="badge-ok">✓ {fill(text.solvedBadge, { time: formatTime(entry.best) })}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4" data-testid="import-panel">
            <p className="text-sm leading-relaxed text-muted">{text.importNote}</p>
            <div className="flex flex-wrap gap-2">
              <label className="btn btn-ghost">
                {text.importFile}
                <input
                  type="file"
                  accept="image/png,image/*"
                  className="sr-only"
                  data-testid="import-file"
                  onChange={(event) => {
                    void importFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <button type="button" className="btn btn-ghost" onClick={importAvatar} data-testid="import-avatar">
                {text.importAvatar}
              </button>
              <button type="button" className="btn btn-ghost" onClick={importSprite} data-testid="import-sprite">
                {text.importSprite}
              </button>
            </div>
            {sourceError ? (
              <p className="notice-bad text-sm" role="alert" data-testid="source-error">
                {sourceError}
              </p>
            ) : null}
            {source && converted ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-fg" data-testid="source-label">
                  {source.label}
                </p>
                <fieldset>
                  <legend className="text-sm font-semibold text-muted">{text.sizeLegend}</legend>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {SIZE_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="chip"
                        aria-pressed={width === n && height === n}
                        data-testid={`size-${n}`}
                        onClick={() => {
                          setWidth(n);
                          setHeight(n);
                        }}
                      >
                        {fill(text.sizePreset, { n })}
                      </button>
                    ))}
                    <label className="flex flex-col text-xs text-muted">
                      {text.widthLabel}
                      <input
                        type="number"
                        min={MIN_SIDE}
                        max={MAX_SIDE}
                        value={width}
                        className="field w-20"
                        data-testid="width"
                        onChange={(event) => setWidth(Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.round(Number(event.target.value) || MIN_SIDE))))}
                      />
                    </label>
                    <label className="flex flex-col text-xs text-muted">
                      {text.heightLabel}
                      <input
                        type="number"
                        min={MIN_SIDE}
                        max={MAX_SIDE}
                        value={height}
                        className="field w-20"
                        data-testid="height"
                        onChange={(event) => setHeight(Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.round(Number(event.target.value) || MIN_SIDE))))}
                      />
                    </label>
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1 text-sm text-muted">
                  <span>
                    {text.thresholdLabel}: {fill(text.thresholdValue, { n: threshold })}
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    step={1}
                    value={threshold}
                    data-testid="threshold"
                    onChange={(event) => setThreshold(Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-muted">
                  {text.modeLabel}
                  <select className="field" value={inkMode} data-testid="ink-mode" onChange={(event) => setInkMode(event.target.value === "luminance" ? "luminance" : "alpha")}>
                    <option value="alpha">{text.modeAlpha}</option>
                    <option value="luminance">{text.modeLuminance}</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-4 text-sm text-fg">
                  <label className="inline-flex min-h-11 items-center gap-2">
                    <input type="checkbox" checked={invert} onChange={(event) => setInvert(event.target.checked)} data-testid="invert" />
                    {text.invertLabel}
                  </label>
                  <label className="inline-flex min-h-11 items-center gap-2">
                    <input type="checkbox" checked={trim} onChange={(event) => setTrim(event.target.checked)} data-testid="trim" />
                    {text.trimLabel}
                  </label>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted">{text.previewLabel}</p>
                  <div className="mt-2">
                    <MiniGrid bitmap={fixed ? fixed.bitmap : converted} flipped={fixed?.flipped} label={`${text.previewLabel} ${width}×${height}`} />
                  </div>
                </div>
                <div aria-live="polite" data-testid="check-status">
                  {fixed ? (
                    <p className="notice-ok text-sm">{fill(text.autoFixDone, { n: fixed.flipped.length })}</p>
                  ) : check?.ok ? (
                    <p className="notice-ok text-sm">{text.checkUnique}</p>
                  ) : check ? (
                    <p className="notice-bad text-sm">{text.checkErrors[check.reason]}</p>
                  ) : null}
                  {fixFailed ? <p className="notice-bad mt-1 text-sm">{text.autoFixFailed}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!fixed && check && !check.ok && (check.reason === "multiple" || check.reason === "unknown") ? (
                    <button type="button" className="btn btn-ghost" onClick={runFix} data-testid="autofix">
                      {text.autoFix}
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-primary" disabled={!ready} onClick={startImport} data-testid="start-import">
                    {text.startPuzzle}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section id="nonogram-board" className="panel rounded-xl p-3 sm:p-5" aria-labelledby="board-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="board-heading" className="font-display text-xl font-semibold tracking-tight">
            {title} <span className="text-sm font-normal text-muted">{`${w}×${h}`}</span>
          </h3>
          <p className="text-sm tabular-nums text-muted">
            {text.timer}: <span data-testid="timer">{formatTime(elapsed)}</span>
            {started && !visible && !solved ? ` (${text.paused})` : ""} · <span data-testid="hints">{fill(text.hintsUsed, { n: hints })}</span>
            {solvedEntry ? ` · ${fill(text.solvedBest, { time: formatTime(solvedEntry.best) })}` : ""}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label={text.modeToggle}>
            <button type="button" className="chip" aria-pressed={mode === "fill"} onClick={() => setMode("fill")} data-testid="mode-fill">
              <span aria-hidden="true">■</span> {text.modeFill}
            </button>
            <button type="button" className="chip" aria-pressed={mode === "mark"} onClick={() => setMode("mark")} data-testid="mode-mark">
              <span aria-hidden="true">✕</span> {text.modeMark}
            </button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={doUndo} disabled={history.undo.length === 0 || solved} data-testid="undo">
            {text.undo}
          </button>
          <button type="button" className="btn btn-ghost" onClick={doRedo} disabled={history.redo.length === 0 || solved} data-testid="redo">
            {text.redo}
          </button>
          <button type="button" className="btn btn-ghost" onClick={doHint} disabled={solved} data-testid="hint">
            {text.hint}
          </button>
        </div>
        <div ref={boardWrap} className="board-wrap mt-4">
          <div
            role="grid"
            aria-label={fill(text.gridLabel, { title, w, h })}
            aria-describedby="board-heading"
            data-testid="board"
            className={`board${solved ? " solved" : ""}`}
            style={{ gridTemplateColumns: `${rowClueW}px repeat(${w}, ${cellSize}px)`, gridTemplateRows: `${colClueH}px repeat(${h}, ${cellSize}px)`, fontSize: `${font}px` }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div role="row" className="board-row">
              <div role="columnheader" aria-hidden="true" />
              {clues.cols.map((clue, x) => {
                const done = satisfied.cols[x];
                const label = `${fill(text.colClue, { n: x + 1, clue: clue.length ? clue.join(" ") : "0" })}${done ? `, ${text.clueDone}` : ""}`;
                return (
                  <div
                    key={x}
                    role="columnheader"
                    aria-label={label}
                    data-testid={`col-clue-${x}`}
                    data-done={done ? "true" : "false"}
                    className={`clue clue-col${done ? " clue-done" : ""}${cursor % w === x ? " clue-active" : ""}`}
                  >
                    {(clue.length ? clue : [0]).map((n, k) => (
                      <span key={k} className="clue-num">
                        {n}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
            {clues.rows.map((clue, y) => {
              const done = satisfied.rows[y];
              const label = `${fill(text.rowClue, { n: y + 1, clue: clue.length ? clue.join(" ") : "0" })}${done ? `, ${text.clueDone}` : ""}`;
              return (
                <div key={y} role="row" className="board-row">
                  <div
                    role="rowheader"
                    aria-label={label}
                    data-testid={`row-clue-${y}`}
                    data-done={done ? "true" : "false"}
                    className={`clue clue-row${done ? " clue-done" : ""}${Math.floor(cursor / w) === y ? " clue-active" : ""}`}
                  >
                    {(clue.length ? clue : [0]).map((n, k) => (
                      <span key={k} className="clue-num">
                        {n}
                      </span>
                    ))}
                  </div>
                  {Array.from({ length: w }, (_, x) => {
                    const i = y * w + x;
                    const state = cells[i] ?? BLANK;
                    const classes = [
                      "cell-wrap",
                      x === 0 ? "edge-left" : "",
                      y === 0 ? "edge-top" : "",
                      x === w - 1 || (x + 1) % 5 === 0 ? "major-right" : "",
                      y === h - 1 || (y + 1) % 5 === 0 ? "major-bottom" : "",
                    ].join(" ");
                    return (
                      <div key={x} role="gridcell" className={classes} aria-selected={state === FILLED}>
                        <button
                          type="button"
                          ref={(el) => {
                            cellRefs.current[i] = el;
                          }}
                          className="cell"
                          data-index={i}
                          data-state={state}
                          data-cursor={cursor === i ? "true" : "false"}
                          tabIndex={cursor === i ? 0 : -1}
                          aria-label={fill(text.cellLabel, { row: y + 1, col: x + 1, state: text.cellStates[state] })}
                          aria-disabled={solved || undefined}
                          onFocus={() => setCursor(i)}
                          onPointerDown={(event) => onPointerDown(event, i)}
                          onClick={(event) => {
                            // Pointer input is handled above; detail 0 is assistive-technology activation.
                            if (event.detail === 0 && !solved) actOn(i, mode);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <div role="status" aria-live="polite" data-testid="solved-status">
            {solved ? (
              <p className="notice-ok text-lg font-semibold">
                {fill(text.solved, { time: formatTime(elapsed), hints })}
              </p>
            ) : null}
          </div>
          <div aria-live="polite" data-testid="notice">
            {notice ? <p className={`text-sm ${notice.tone === "bad" ? "notice-bad" : notice.tone === "ok" ? "notice-ok" : "text-muted"}`}>{notice.text}</p> : null}
            {saveFailed ? <p className="notice-bad text-sm">{text.saveFailed}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={restart} data-testid="restart">
              {text.restart}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void share()} data-testid="share">
              {text.share}
            </button>
          </div>
          {shareUrl ? (
            <label className="flex flex-col gap-1 text-sm text-muted">
              {text.shareLabel}
              <input className="field font-mono text-sm" readOnly value={shareUrl} data-testid="share-url" onFocus={(event) => event.currentTarget.select()} />
              <span aria-live="polite">{shareNote}</span>
            </label>
          ) : null}
        </div>
      </section>
    </div>
  );
}
