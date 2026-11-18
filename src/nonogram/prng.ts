/** Seedable PRNG (mulberry32). Same seed, same sequence, on every engine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, used to mix the term list into the seed. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function freshSeed(): number {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] ?? 1;
  } catch {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }
}

export const MAX_SEED = 0xffffffff;

export function formatSeed(seed: number): string {
  return (seed >>> 0).toString(36);
}

export function parseSeed(text: string): number | null {
  if (!/^[0-9a-z]{1,7}$/.test(text)) return null;
  const value = parseInt(text, 36);
  return Number.isInteger(value) && value >= 0 && value <= MAX_SEED ? value : null;
}
