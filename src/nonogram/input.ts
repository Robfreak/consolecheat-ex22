// Keyboard and gamepad mapping. Pure helpers so node:test can check them.

export type Direction = "up" | "down" | "left" | "right" | "home" | "end";
export type Action =
  | { type: "move"; direction: Direction }
  | { type: "fill" }
  | { type: "mark" }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "hint" };

export type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };
export type TargetLike = { tagName?: string; type?: string; isContentEditable?: boolean } | null;

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

export function isTypingTarget(target: TargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
  return false;
}

function isRange(target: TargetLike): boolean {
  return (target?.tagName ?? "").toUpperCase() === "INPUT" && (target?.type ?? "").toLowerCase() === "range";
}

/** Keys. Arrows/Home/End, Space/Enter, X, Backspace/Delete apply on the grid; Ctrl+Z/Y and H anywhere. */
export function keyAction(event: KeyLike): Action | null {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "z") return event.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "y") return { type: "redo" };
    return null;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case "ArrowUp":
      return { type: "move", direction: "up" };
    case "ArrowDown":
      return { type: "move", direction: "down" };
    case "ArrowLeft":
      return { type: "move", direction: "left" };
    case "ArrowRight":
      return { type: "move", direction: "right" };
    case "Home":
      return { type: "move", direction: "home" };
    case "End":
      return { type: "move", direction: "end" };
    case " ":
    case "Enter":
      return { type: "fill" };
    case "x":
    case "X":
      return { type: "mark" };
    case "Backspace":
    case "Delete":
      return { type: "clear" };
    case "h":
    case "H":
      return { type: "hint" };
    default:
      return null;
  }
}

/**
 * Whether a shortcut may act with this element focused. Text fields, text areas and
 * selects keep every key. A range slider keeps its keys too, but lets Ctrl/⌘+Z and
 * Ctrl/⌘+Y (Ctrl/⌘+Shift+Z) through, as in ex19.
 */
export function shortcutAllowed(target: TargetLike, action: Action): boolean {
  if (isTypingTarget(target)) return false;
  if (isRange(target)) return action.type === "undo" || action.type === "redo";
  return true;
}

// Standard gamepad mapping (PlayStation labels).
export const PAD = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, up: 12, down: 13, left: 14, right: 15 } as const;

const BUTTON_ACTIONS: readonly (readonly [number, Action])[] = [
  [PAD.up, { type: "move", direction: "up" }],
  [PAD.down, { type: "move", direction: "down" }],
  [PAD.left, { type: "move", direction: "left" }],
  [PAD.right, { type: "move", direction: "right" }],
  [PAD.cross, { type: "fill" }],
  [PAD.circle, { type: "mark" }],
  [PAD.square, { type: "clear" }],
  [PAD.triangle, { type: "hint" }],
  [PAD.l1, { type: "undo" }],
  [PAD.r1, { type: "redo" }],
];
const WATCHED = BUTTON_ACTIONS.map(([index]) => index);

export type PadLike = { index: number; buttons: readonly { pressed: boolean }[] };
export type PadMemory = { buttons: boolean[] };

function snapshot(pad: PadLike): PadMemory {
  const buttons: boolean[] = [];
  for (const index of WATCHED) buttons[index] = Boolean(pad.buttons[index]?.pressed);
  return { buttons };
}

/**
 * One pad, one poll (the pollPad pattern). No memory: seed and emit nothing. Blocked
 * (a field has focus): the memory follows the pad and nothing fires, then or later.
 */
export function pollPad(pad: PadLike | null, memory: PadMemory | null, blocked = false): { actions: Action[]; memory: PadMemory | null } {
  if (!pad) return { actions: [], memory: null };
  const seeded = snapshot(pad);
  if (!memory) return { actions: [], memory: seeded };
  if (blocked) return { actions: [], memory: seeded };
  const actions: Action[] = [];
  for (const [index, action] of BUTTON_ACTIONS) if (seeded.buttons[index] && !memory.buttons[index]) actions.push(action);
  return { actions, memory: seeded };
}

/** Memory per gamepad index. A pad missing from a poll (or forgotten on disconnect) seeds again. */
export function createPadPoller() {
  const memories = new Map<number, PadMemory>();
  return {
    poll(pads: readonly (PadLike | null)[], blocked = false): Action[] {
      const actions: Action[] = [];
      const live = new Set<number>();
      for (const pad of pads) {
        if (!pad) continue;
        live.add(pad.index);
        const result = pollPad(pad, memories.get(pad.index) ?? null, blocked);
        if (result.memory) memories.set(pad.index, result.memory);
        actions.push(...result.actions);
      }
      for (const index of [...memories.keys()]) if (!live.has(index)) memories.delete(index);
      return actions;
    },
    forget(index: number) {
      memories.delete(index);
    },
  };
}
