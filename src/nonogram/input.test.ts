import assert from "node:assert/strict";
import test from "node:test";
import { PAD, createPadPoller, isTypingTarget, keyAction, pollPad, shortcutAllowed, type PadLike } from "./input.ts";

function pad(index: number, pressed: number[] = []): PadLike {
  return { index, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) };
}

test("keys map to moves, fill, mark, clear, undo, redo and hint", () => {
  assert.deepEqual(keyAction({ key: "ArrowLeft" }), { type: "move", direction: "left" });
  assert.deepEqual(keyAction({ key: "Home" }), { type: "move", direction: "home" });
  assert.deepEqual(keyAction({ key: " " }), { type: "fill" });
  assert.deepEqual(keyAction({ key: "Enter" }), { type: "fill" });
  assert.deepEqual(keyAction({ key: "x" }), { type: "mark" });
  assert.deepEqual(keyAction({ key: "Backspace" }), { type: "clear" });
  assert.deepEqual(keyAction({ key: "Delete" }), { type: "clear" });
  assert.deepEqual(keyAction({ key: "z", ctrlKey: true }), { type: "undo" });
  assert.deepEqual(keyAction({ key: "Z", ctrlKey: true, shiftKey: true }), { type: "redo" });
  assert.deepEqual(keyAction({ key: "y", metaKey: true }), { type: "redo" });
  assert.deepEqual(keyAction({ key: "h" }), { type: "hint" });
  assert.equal(keyAction({ key: "x", ctrlKey: true }), null);
  assert.equal(keyAction({ key: "z", ctrlKey: true, altKey: true }), null);
  assert.equal(keyAction({ key: "q" }), null);
});

test("no shortcuts in text fields or selects; sliders only allow undo and redo", () => {
  const text = { tagName: "INPUT", type: "text" };
  const number = { tagName: "INPUT", type: "number" };
  const range = { tagName: "INPUT", type: "range" };
  const select = { tagName: "SELECT" };
  const editable = { tagName: "DIV", isContentEditable: true };
  const button = { tagName: "BUTTON", type: "button" };
  for (const target of [text, number, select, editable, { tagName: "TEXTAREA" }]) {
    assert.ok(isTypingTarget(target));
    for (const type of ["undo", "redo", "hint", "fill"] as const) assert.equal(shortcutAllowed(target, { type }), false);
  }
  assert.equal(isTypingTarget(range), false);
  assert.equal(shortcutAllowed(range, { type: "undo" }), true);
  assert.equal(shortcutAllowed(range, { type: "redo" }), true);
  assert.equal(shortcutAllowed(range, { type: "hint" }), false);
  assert.equal(shortcutAllowed(range, { type: "move", direction: "left" }), false);
  assert.equal(shortcutAllowed(button, { type: "hint" }), true);
  assert.equal(shortcutAllowed(null, { type: "fill" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
});

test("the first poll only seeds, so a held button does not fire", () => {
  const first = pollPad(pad(0, [PAD.cross]), null);
  assert.deepEqual(first.actions, []);
  assert.ok(first.memory);
  const held = pollPad(pad(0, [PAD.cross]), first.memory);
  assert.deepEqual(held.actions, []);
  const released = pollPad(pad(0), held.memory);
  const pressed = pollPad(pad(0, [PAD.cross]), released.memory);
  assert.deepEqual(pressed.actions, [{ type: "fill" }]);
  assert.deepEqual(pollPad(null, pressed.memory), { actions: [], memory: null });
});

test("gamepad buttons map to the documented actions", () => {
  const cases: [number, object][] = [
    [PAD.cross, { type: "fill" }],
    [PAD.circle, { type: "mark" }],
    [PAD.square, { type: "clear" }],
    [PAD.triangle, { type: "hint" }],
    [PAD.l1, { type: "undo" }],
    [PAD.r1, { type: "redo" }],
    [PAD.up, { type: "move", direction: "up" }],
    [PAD.down, { type: "move", direction: "down" }],
    [PAD.left, { type: "move", direction: "left" }],
    [PAD.right, { type: "move", direction: "right" }],
  ];
  assert.deepEqual([PAD.cross, PAD.circle, PAD.square, PAD.triangle, PAD.l1, PAD.r1], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([PAD.up, PAD.down, PAD.left, PAD.right], [12, 13, 14, 15]);
  for (const [button, action] of cases) {
    const seed = pollPad(pad(0), null).memory;
    assert.deepEqual(pollPad(pad(0, [button]), seed).actions, [action], String(button));
  }
});

test("blocked polls track the pad without firing; reconnects and missing pads seed again", () => {
  const poller = createPadPoller();
  assert.deepEqual(poller.poll([pad(0, [PAD.triangle])]), []);
  assert.deepEqual(poller.poll([pad(0)]), []);
  // Pressed while a text field has focus: nothing, and nothing later while held.
  assert.deepEqual(poller.poll([pad(0, [PAD.triangle])], true), []);
  assert.deepEqual(poller.poll([pad(0, [PAD.triangle])]), []);
  assert.deepEqual(poller.poll([pad(0)]), []);
  assert.deepEqual(poller.poll([pad(0, [PAD.triangle])]), [{ type: "hint" }]);
  // Disconnect while holding, reconnect still holding: only seeds.
  poller.forget(0);
  assert.deepEqual(poller.poll([pad(0, [PAD.l1])]), []);
  assert.deepEqual(poller.poll([null]), []);
  assert.deepEqual(poller.poll([pad(0, [PAD.l1])]), [], "a pad missing from a poll seeds again");
  assert.deepEqual(poller.poll([pad(0)]), []);
  assert.deepEqual(poller.poll([pad(0, [PAD.r1]), pad(1, [PAD.cross])]), [{ type: "redo" }]);
});
