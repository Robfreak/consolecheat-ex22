import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { filledCount, fromArt, makeBitmap, toArt } from "./bitmap.ts";
import { cluesOf } from "./clues.ts";
import { DEFAULT_SIZE, SIZE_PRESETS, contentBox, convertImage, downscale, inkMap, pixelInk } from "./image.ts";
import { countSolutions } from "./solver.ts";
import { AVATAR_KEY, SPRITE_KEY, decodeRuns, parseAvatar, parseSprite, readAvatar, readSprite } from "./sources.ts";
import { autoFix, checkPuzzle } from "./unique.ts";

type Px = [number, number, number, number];

function encodeRuns(pixels: Px[]): string {
  const runs: string[] = [];
  let last = "";
  let n = 0;
  const hex = (p: Px) => (p[3] === 0 ? "0" : p.map((v) => v.toString(16).padStart(2, "0")).join(""));
  for (const p of pixels) {
    const h = hex(p);
    if (h === last) n++;
    else {
      if (n) runs.push(`${n}:${last}`);
      last = h;
      n = 1;
    }
  }
  if (n) runs.push(`${n}:${last}`);
  return runs.join(",");
}

/** A 64×64 avatar like Pixel-Avatar-Studio makes: transparent background, a head with eyes and a mouth. */
function avatarPixels(): Px[] {
  const out: Px[] = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = x - 31.5;
      const dy = y - 30;
      const head = dx * dx + dy * dy < 22 * 22;
      const eye = (Math.abs(x - 23) < 4 || Math.abs(x - 40) < 4) && Math.abs(y - 25) < 4;
      const mouth = y >= 38 && y < 43 && x > 20 && x < 44;
      const body = y >= 52 && x > 14 && x < 50;
      if ((head && !eye && !mouth) || body) out.push([0x2a, 0x6c, 0xd8, 0xff]);
      else out.push([0, 0, 0, 0]);
    }
  }
  return out;
}

function rgba(pixels: Px[], width: number) {
  return { width, height: pixels.length / width, data: Uint8ClampedArray.from(pixels.flat()) };
}

test("size presets are 10, 15 and 20 with 15 as default", () => {
  assert.deepEqual([...SIZE_PRESETS], [10, 15, 20]);
  assert.equal(DEFAULT_SIZE, 15);
});

test("ink: luminance uses darkness times alpha, alpha mode uses opacity", () => {
  assert.equal(pixelInk(0, 0, 0, 255, "luminance"), 1);
  assert.ok(pixelInk(255, 255, 255, 255, "luminance") < 1e-9);
  assert.equal(pixelInk(0, 0, 0, 0, "luminance"), 0);
  assert.equal(pixelInk(255, 255, 255, 255, "alpha"), 1);
  assert.equal(pixelInk(10, 10, 10, 0, "alpha"), 0);
});

test("the threshold converter fills a cell when its mean ink reaches the threshold", () => {
  // 10×10: left half black, right half white, one grey column.
  const pixels: Px[] = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) pixels.push(x < 5 ? [0, 0, 0, 255] : x === 5 ? [128, 128, 128, 255] : [255, 255, 255, 255]);
  const image = rgba(pixels, 10);
  const half = convertImage(image, { w: 10, h: 10, threshold: 0.4, mode: "luminance" });
  assert.equal(toArt(half)[0], "######....");
  const strict = convertImage(image, { w: 10, h: 10, threshold: 0.6, mode: "luminance" });
  assert.equal(toArt(strict)[0], "#####.....");
  const inverted = convertImage(image, { w: 10, h: 10, threshold: 0.6, mode: "luminance", invert: true });
  assert.equal(toArt(inverted)[0], ".....#####");
  const small = convertImage(image, { w: 5, h: 5, threshold: 0.5, mode: "luminance" });
  assert.equal(toArt(small)[0], "###..", "black plus half the grey column averages above 0.5");
  // Alpha mode on an opaque image: everything is filled.
  assert.equal(filledCount(convertImage(image, { w: 5, h: 5, threshold: 0.5, mode: "alpha" })), 25);
});

test("downscale averages by area and trim crops to the inked area", () => {
  const ink = new Float32Array([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  const box = { x: 0, y: 0, w: 4, h: 4 };
  assert.deepEqual([...downscale(ink, 4, box, 2, 2)], [1, 0, 0, 0.25]);
  assert.deepEqual([...downscale(ink, 4, box, 3, 3)].map((v) => Math.round(v * 100) / 100), [1, 0.5, 0, 0.5, 0.25, 0, 0, 0, 0.56]);
  assert.deepEqual(contentBox(ink, 4, 4), { x: 0, y: 0, w: 4, h: 4 });
  const single = new Float32Array(16);
  single[5] = 1;
  single[6] = 1;
  assert.deepEqual(contentBox(single, 4, 4), { x: 1, y: 1, w: 2, h: 1 });
  assert.equal(contentBox(new Float32Array(16), 4, 4).w, 4, "an empty image keeps the full box");
});

test("a 64×64 avatar is downscaled to 15×15 by area and verified as uniquely solvable", () => {
  const pixels = avatarPixels();
  const raw = JSON.stringify({ version: 1, pixels: encodeRuns(pixels) });
  const parsed = parseAvatar(raw);
  assert.ok(parsed.ok);
  assert.equal(parsed.image.width, 64);
  assert.equal(parsed.image.height, 64);
  for (const size of SIZE_PRESETS) {
    const bitmap = convertImage(parsed.image, { w: size, h: size, threshold: 0.5, mode: "alpha", trim: true });
    assert.equal(bitmap.w, size);
    assert.equal(bitmap.h, size);
    assert.ok(filledCount(bitmap) > 0 && filledCount(bitmap) < size * size);
    let check = checkPuzzle(bitmap);
    let final = bitmap;
    if (!check.ok) {
      assert.ok(check.reason === "multiple" || check.reason === "unknown", check.reason);
      const fixed = autoFix(bitmap);
      assert.ok(fixed.ok, `auto-fix at ${size}`);
      final = fixed.bitmap;
      check = checkPuzzle(final);
    }
    assert.deepEqual(check, { ok: true }, `size ${size}`);
    const counted = countSolutions(cluesOf(final), 2, 200000);
    assert.equal(counted.count, 1);
    assert.deepEqual(counted.solutions[0], [...final.cells]);
  }
  // Area sampling: the transparent eye holes survive at 15×15, so the face is not a solid blob.
  const face = convertImage(parsed.image, { w: DEFAULT_SIZE, h: DEFAULT_SIZE, threshold: 0.5, mode: "alpha", trim: true });
  assert.ok(toArt(face).some((line) => /#\.+#/.test(line)));
  const ink = inkMap(parsed.image, "alpha");
  assert.equal(ink.length, 64 * 64);
});

test("non-unique, empty and full imports are rejected; auto-fix makes them unique or says no", () => {
  const diagonal = fromArt(["#....", ".#...", "..#..", "...#.", "....#"]);
  const check = checkPuzzle(diagonal);
  assert.deepEqual(check, { ok: false, reason: "multiple" });
  const fixed = autoFix(diagonal);
  assert.ok(fixed.ok);
  assert.ok(fixed.flipped.length >= 1);
  assert.deepEqual(checkPuzzle(fixed.bitmap), { ok: true });
  assert.deepEqual(checkPuzzle(makeBitmap(5, 5)), { ok: false, reason: "empty" });
  assert.deepEqual(checkPuzzle(makeBitmap(5, 5, new Array(25).fill(1))), { ok: false, reason: "full" });
  assert.deepEqual(checkPuzzle(makeBitmap(21, 5, new Array(105).fill(0).map((_, i) => i % 2))), { ok: false, reason: "size" });
  const noFlips = autoFix(fromArt(["#.", ".#"]), 0);
  assert.equal(noFlips.ok, false);
  // Unique pictures need no fix.
  const unique = autoFix(fromArt(["##...", "#....", ".....", ".....", "....."]));
  assert.ok(unique.ok);
  assert.deepEqual(unique.flipped, []);
});

test("avatar and sprite drafts parse read-only; corrupt drafts are reported, not changed", () => {
  assert.deepEqual(decodeRuns(2, "4:0")?.length, 16);
  assert.equal(decodeRuns(2, "3:0"), null);
  assert.equal(decodeRuns(2, "5:0"), null);
  assert.equal(decodeRuns(2, "4:zz"), null);
  assert.deepEqual([...(decodeRuns(1, "1:ff000080") ?? [])], [255, 0, 0, 128]);
  assert.deepEqual(parseAvatar(null), { ok: false, reason: "missing" });
  assert.deepEqual(parseAvatar("{"), { ok: false, reason: "corrupt" });
  assert.deepEqual(parseAvatar(JSON.stringify({ version: 2, pixels: "4096:0" })), { ok: false, reason: "corrupt" });
  assert.ok(parseAvatar(JSON.stringify({ version: 1, pixels: "4096:0" })).ok);

  const frame = (fillHex: string) => `128:0,128:${fillHex}`;
  const sprite = { version: 1, size: 16, frames: [frame("ff0000ff"), frame("00ff00ff")], index: 1, palette: [] };
  const parsed = parseSprite(JSON.stringify(sprite));
  assert.ok(parsed.ok);
  assert.equal(parsed.frame, 1);
  assert.equal(parsed.frames, 2);
  assert.equal(parsed.image.width, 16);
  assert.equal(parsed.image.data[128 * 4 + 1], 255, "the current frame (green) is used");
  assert.deepEqual(parseSprite(JSON.stringify({ ...sprite, size: 12 })), { ok: false, reason: "corrupt" });
  assert.deepEqual(parseSprite(JSON.stringify({ ...sprite, frames: [] })), { ok: false, reason: "corrupt" });

  const calls: string[] = [];
  const values: Record<string, string> = { [AVATAR_KEY]: JSON.stringify({ version: 1, pixels: encodeRuns(avatarPixels()) }), [SPRITE_KEY]: JSON.stringify(sprite) };
  const spy = {
    getItem(key: string) {
      calls.push(`get:${key}`);
      return values[key] ?? null;
    },
    setItem(key: string) {
      calls.push(`set:${key}`);
    },
    removeItem(key: string) {
      calls.push(`remove:${key}`);
    },
  };
  assert.ok(readAvatar(spy).ok);
  assert.ok(readSprite(spy).ok);
  assert.deepEqual(calls, [`get:${AVATAR_KEY}`, `get:${SPRITE_KEY}`]);
  const blocked = {
    getItem(): string | null {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readAvatar(blocked), { ok: false, reason: "blocked" });
  assert.deepEqual(readSprite(null), { ok: false, reason: "blocked" });
});

test("no source file ever writes the avatar or sprite key", () => {
  for (const name of ["sources.ts", "storage.ts", "Nonogram.tsx", "App.tsx"]) {
    const text = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /setItem\(\s*(AVATAR_KEY|SPRITE_KEY|"consolecheat-(avatar|sprite)-v1")/, name);
    assert.doesNotMatch(text, /removeItem\(\s*(AVATAR_KEY|SPRITE_KEY|"consolecheat-(avatar|sprite)-v1")/, name);
    assert.doesNotMatch(text, /localStorage\.clear\(/, name);
  }
});
