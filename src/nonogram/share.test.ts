import assert from "node:assert/strict";
import test from "node:test";
import { fromArt, sameBitmap } from "./bitmap.ts";
import { builtinBitmap, BUILTINS } from "./puzzles.ts";
import { base64UrlToBits, bitsToBase64Url, decodeShare, encodeShare } from "./share.ts";
import { checkPuzzle } from "./unique.ts";

test("bits round-trip through base64url", () => {
  for (const n of [1, 6, 7, 25, 100, 400]) {
    const bits = Array.from({ length: n }, (_, i) => ((i * 7) % 3 === 0 ? 1 : 0));
    const text = bitsToBase64Url(bits);
    assert.match(text, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual([...(base64UrlToBits(text, n) ?? [])], bits);
  }
  assert.equal(base64UrlToBits("A", 12), null, "too short");
  assert.equal(base64UrlToBits("AAAA", 6), null, "too long");
  assert.equal(base64UrlToBits("B", 5), null, "padding bits must be zero");
  assert.equal(base64UrlToBits("A+", 12), null, "not base64url");
});

test("share links round-trip every built-in with its title", () => {
  for (const b of BUILTINS) {
    const bitmap = builtinBitmap(b);
    const hash = encodeShare(bitmap, b.de);
    const result = decodeShare(hash);
    assert.ok(result.ok, b.id);
    assert.ok(sameBitmap(result.bitmap, bitmap), b.id);
    assert.equal(result.title, b.de);
    assert.deepEqual(checkPuzzle(result.bitmap), { ok: true });
  }
  const rect = fromArt(["#....##", ".#...#.", "..###..", "#.....#", "##...##"]);
  const decoded = decodeShare(encodeShare(rect));
  assert.ok(decoded.ok);
  assert.equal(decoded.bitmap.w, 7);
  assert.equal(decoded.bitmap.h, 5);
  assert.equal(decoded.title, "");
});

test("invalid share links are rejected", () => {
  assert.deepEqual(decodeShare(""), { ok: false, error: "none" });
  assert.deepEqual(decodeShare("#impressum"), { ok: false, error: "none" });
  assert.deepEqual(decodeShare("#w=4&h=5&b=AAAA"), { ok: false, error: "size" });
  assert.deepEqual(decodeShare("#w=21&h=5&b=AAAA"), { ok: false, error: "size" });
  assert.deepEqual(decodeShare("#w=5.5&h=5&b=AAAA"), { ok: false, error: "size" });
  assert.deepEqual(decodeShare("#w=5&h=5&b=A"), { ok: false, error: "bits" });
  assert.deepEqual(decodeShare("#w=5&h=5&b=AAAA!"), { ok: false, error: "bits" });
  assert.deepEqual(decodeShare(`#w=5&h=5&b=${"A".repeat(500)}`), { ok: false, error: "bits" });
  const long = decodeShare(`${encodeShare(builtinBitmap(BUILTINS[0]!))}&t=${"x".repeat(80)}`);
  assert.ok(long.ok);
  assert.equal(long.title.length, 40);
});

test("a decoded link with a non-unique, empty or full picture fails the check", () => {
  const diagonal = decodeShare(encodeShare(fromArt(["#....", ".#...", "..#..", "...#.", "....#"])));
  assert.ok(diagonal.ok);
  assert.deepEqual(checkPuzzle(diagonal.bitmap), { ok: false, reason: "multiple" });
  const empty = decodeShare(`#w=5&h=5&b=${bitsToBase64Url(new Array(25).fill(0))}`);
  assert.ok(empty.ok);
  assert.deepEqual(checkPuzzle(empty.bitmap), { ok: false, reason: "empty" });
  const full = decodeShare(`#w=5&h=5&b=${bitsToBase64Url(new Array(25).fill(1))}`);
  assert.ok(full.ok);
  assert.deepEqual(checkPuzzle(full.bitmap), { ok: false, reason: "full" });
});
