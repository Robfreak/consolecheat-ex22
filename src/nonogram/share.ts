import { MAX_SIDE, MIN_SIDE, type Bitmap } from "./bitmap.ts";

// Share link: #w=<w>&h=<h>&b=<bits as base64url>[&t=<title>]. Bits row-major,
// most significant bit first, padded with zeros to a whole byte.

export const MAX_TITLE = 40;

export function bitsToBase64Url(cells: ArrayLike<number>): string {
  const bytes = new Uint8Array(Math.ceil(cells.length / 8));
  for (let i = 0; i < cells.length; i++) if (cells[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBits(text: string, count: number): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const expected = Math.ceil(count / 8);
  if (Math.ceil((text.length * 3) / 4) < expected || text.length > Math.ceil((expected * 4) / 3)) return null;
  let binary: string;
  try {
    binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  } catch {
    return null;
  }
  if (binary.length !== expected) return null;
  const cells = new Uint8Array(count);
  for (let i = 0; i < expected * 8; i++) {
    const bit = (binary.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
    if (i < count) cells[i] = bit;
    else if (bit) return null; // padding must be zero
  }
  return cells;
}

export function encodeShare(bitmap: Bitmap, title = ""): string {
  const params = new URLSearchParams();
  params.set("w", String(bitmap.w));
  params.set("h", String(bitmap.h));
  params.set("b", bitsToBase64Url(bitmap.cells));
  const t = title.trim().slice(0, MAX_TITLE);
  if (t) params.set("t", t);
  return `#${params.toString()}`;
}

export type ShareError = "none" | "size" | "bits";
export type DecodeResult = { ok: true; bitmap: Bitmap; title: string } | { ok: false; error: ShareError };

export function decodeShare(hash: string): DecodeResult {
  const raw = hash.replace(/^#/, "");
  if (raw.length > 400) return { ok: false, error: "bits" };
  const params = new URLSearchParams(raw);
  if (!params.has("w") && !params.has("h") && !params.has("b")) return { ok: false, error: "none" };
  const w = Number(params.get("w"));
  const h = Number(params.get("h"));
  if (!/^\d{1,2}$/.test(params.get("w") ?? "") || !/^\d{1,2}$/.test(params.get("h") ?? "")) return { ok: false, error: "size" };
  if (w < MIN_SIDE || h < MIN_SIDE || w > MAX_SIDE || h > MAX_SIDE) return { ok: false, error: "size" };
  const cells = base64UrlToBits(params.get("b") ?? "", w * h);
  if (!cells) return { ok: false, error: "bits" };
  const title = (params.get("t") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return { ok: true, bitmap: { w, h, cells }, title };
}
