// Read-only access to the pixel drafts of other consolecheat tools on the same origin
// (robfreak.github.io). Only getItem is ever called on these keys.

export const AVATAR_KEY = "consolecheat-avatar-v1";
export const SPRITE_KEY = "consolecheat-sprite-v1";
export const AVATAR_SIZE = 64;
const SPRITE_SIZES = [16, 32, 64];

export type PixelImage = { width: number; height: number; data: Uint8ClampedArray };
export type SourceResult = { ok: true; image: PixelImage; frame?: number; frames?: number } | { ok: false; reason: "missing" | "blocked" | "corrupt" };

/** The run-length format of Pixel-Avatar-Studio and Sprite-Animator: `COUNT:0` or `COUNT:RRGGBBAA`, comma separated. */
export function decodeRuns(size: number, text: string, maxLength = 200_000): Uint8ClampedArray | null {
  const count = size * size;
  if (typeof text !== "string" || text.length === 0 || text.length > maxLength) return null;
  const out = new Uint8ClampedArray(count * 4);
  let written = 0;
  for (const run of text.split(",")) {
    const sep = run.indexOf(":");
    if (sep <= 0) return null;
    const n = Number(run.slice(0, sep));
    const payload = run.slice(sep + 1);
    if (!Number.isInteger(n) || n < 1 || written + n > count) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    if (payload !== "0") {
      if (!/^[0-9a-fA-F]{8}$/.test(payload)) return null;
      r = parseInt(payload.slice(0, 2), 16);
      g = parseInt(payload.slice(2, 4), 16);
      b = parseInt(payload.slice(4, 6), 16);
      a = parseInt(payload.slice(6, 8), 16);
    }
    for (let k = 0; k < n; k++) {
      const o = (written + k) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
    written += n;
  }
  return written === count ? out : null;
}

/** Avatar draft: `{ "version": 1, "pixels": "<runs for 64×64>" }`. */
export function parseAvatar(raw: string | null): SourceResult {
  if (raw === null) return { ok: false, reason: "missing" };
  try {
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data.version !== 1 || typeof data.pixels !== "string") return { ok: false, reason: "corrupt" };
    const pixels = decodeRuns(AVATAR_SIZE, data.pixels);
    return pixels ? { ok: true, image: { width: AVATAR_SIZE, height: AVATAR_SIZE, data: pixels } } : { ok: false, reason: "corrupt" };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

/** Sprite draft: `{ "version": 1, "size": 16|32|64, "frames": ["<runs>", …], "index": n }`. Uses the current frame. */
export function parseSprite(raw: string | null): SourceResult {
  if (raw === null) return { ok: false, reason: "missing" };
  try {
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data.version !== 1) return { ok: false, reason: "corrupt" };
    const size = data.size;
    if (typeof size !== "number" || !SPRITE_SIZES.includes(size) || !Array.isArray(data.frames) || data.frames.length < 1 || data.frames.length > 64) {
      return { ok: false, reason: "corrupt" };
    }
    const index = typeof data.index === "number" && Number.isInteger(data.index) ? Math.min(data.frames.length - 1, Math.max(0, data.index)) : 0;
    const frame = data.frames[index];
    if (typeof frame !== "string") return { ok: false, reason: "corrupt" };
    const pixels = decodeRuns(size, frame);
    return pixels ? { ok: true, image: { width: size, height: size, data: pixels }, frame: index, frames: data.frames.length } : { ok: false, reason: "corrupt" };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

type ReadOnly = Pick<Storage, "getItem">;

function read(storage: ReadOnly | null, key: string): string | null | undefined {
  if (!storage) return undefined;
  try {
    return storage.getItem(key);
  } catch {
    return undefined;
  }
}

/** getItem only; never setItem or removeItem. */
export function readAvatar(storage: ReadOnly | null): SourceResult {
  const raw = read(storage, AVATAR_KEY);
  return raw === undefined ? { ok: false, reason: "blocked" } : parseAvatar(raw);
}

export function readSprite(storage: ReadOnly | null): SourceResult {
  const raw = read(storage, SPRITE_KEY);
  return raw === undefined ? { ok: false, reason: "blocked" } : parseSprite(raw);
}
