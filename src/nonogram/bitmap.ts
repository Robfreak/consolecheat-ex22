// A black/white picture: row-major, 1 = filled.

export type Bitmap = { w: number; h: number; cells: Uint8Array };

export const MIN_SIDE = 5;
export const MAX_SIDE = 20;

export function makeBitmap(w: number, h: number, cells?: ArrayLike<number>): Bitmap {
  const out = new Uint8Array(w * h);
  if (cells) for (let i = 0; i < out.length; i++) out[i] = cells[i] ? 1 : 0;
  return { w, h, cells: out };
}

/** Rows of `#` (filled) and `.` (empty). */
export function fromArt(rows: readonly string[]): Bitmap {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (rows.some((row) => row.length !== w)) throw new Error("ragged art");
  const cells = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) cells[y * w + x] = row[x] === "#" ? 1 : 0;
  });
  return { w, h, cells };
}

export function toArt(bitmap: Bitmap): string[] {
  const rows: string[] = [];
  for (let y = 0; y < bitmap.h; y++) {
    let row = "";
    for (let x = 0; x < bitmap.w; x++) row += bitmap.cells[y * bitmap.w + x] ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

export function filledCount(bitmap: Bitmap): number {
  let n = 0;
  for (const c of bitmap.cells) n += c;
  return n;
}

export function row(bitmap: Bitmap, y: number): number[] {
  return Array.from(bitmap.cells.subarray(y * bitmap.w, (y + 1) * bitmap.w));
}

export function column(bitmap: Bitmap, x: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < bitmap.h; y++) out.push(bitmap.cells[y * bitmap.w + x] ?? 0);
  return out;
}

export function sameBitmap(a: Bitmap, b: Bitmap): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  return true;
}

/** FNV-1a over size and cells, for a stable id of a custom puzzle. */
export function bitmapId(bitmap: Bitmap): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(bitmap.w);
  mix(bitmap.h);
  for (const c of bitmap.cells) mix(c);
  return `c-${bitmap.w}x${bitmap.h}-${h.toString(36)}`;
}
