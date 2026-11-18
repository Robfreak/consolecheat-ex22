import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { copy, fill, initialLang, isLang } from "./messages.ts";

function shape(value: unknown, path = ""): string[] {
  if (typeof value === "string") return [`${path}:${[...value.matchAll(/\{([A-Za-z0-9]+)\}/g)].map((m) => m[1]).sort().join(",")}`];
  if (value && typeof value === "object") return Object.keys(value).sort().flatMap((key) => shape((value as Record<string, unknown>)[key], `${path}.${key}`));
  return [`${path}:?`];
}

test("German and English have the same keys and placeholders", () => {
  assert.deepEqual(shape(copy.de), shape(copy.en));
  for (const lang of ["de", "en"] as const) {
    for (const line of shape(copy[lang])) assert.ok(!line.endsWith(":?"), line);
  }
});

test("German is the default language", () => {
  assert.equal(initialLang(null), "de");
  assert.equal(initialLang("fr"), "de");
  assert.equal(initialLang("en"), "en");
  assert.ok(isLang("de"));
  assert.equal(fill("{a} und {b}", { a: 1 }), "1 und {b}");
});

test("the storage note names the own key and the read-only avatar and sprite keys", () => {
  for (const lang of ["de", "en"] as const) {
    assert.match(copy[lang].storageNote, /consolecheat-nonogram-v1/);
    assert.match(copy[lang].storageNote, /consolecheat-avatar-v1/);
    assert.match(copy[lang].storageNote, /consolecheat-sprite-v1/);
    assert.match(copy[lang].checkErrors.multiple, /eindeutig|uniquely/);
  }
  const ui = readFileSync(new URL("./Nonogram.tsx", import.meta.url), "utf8");
  assert.match(ui, /role="grid"/);
  assert.match(ui, /role="gridcell"/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /tabIndex=\{cursor === i \? 0 : -1\}/);
});
