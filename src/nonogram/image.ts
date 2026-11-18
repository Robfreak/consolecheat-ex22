import { makeBitmap, type Bitmap } from "./bitmap.ts";

// Image → black/white bitmap. Area sampling: each target cell averages the "ink"
// of every source pixel it covers (weighted by overlap), then a threshold decides.

export type Rgba = { data: ArrayLike<number>; width: number; height: number };
export type InkMode = "luminance" | "alpha";
export type ConvertOptions = {
  w: number;
  h: number;
  /** 0…1; a cell is filled when its mean ink reaches it. */
  threshold: number;
  mode: InkMode;
  invert?: boolean;
  /** Crop to the non-transparent (or inked) area first. */
  trim?: boolean;
};

export const SIZE_PRESETS = [10, 15, 20] as const;
export const DEFAULT_SIZE = 15;

/** Ink of one pixel, 0…1. Transparent pixels never count as ink. */
export function pixelInk(r: number, g: number, b: number, a: number, mode: InkMode): number {
  const alpha = a / 255;
  if (mode === "alpha") return alpha;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return alpha * (1 - luma);
}

export function inkMap(image: Rgba, mode: InkMode): Float32Array {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = pixelInk(image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0, image.data[o + 3] ?? 0, mode);
  }
  return out;
}

/** Bounding box of pixels with ink above a small floor; the full image if none. */
export function contentBox(ink: Float32Array, width: number, height: number, floor = 0.02) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((ink[y * width + x] ?? 0) > floor) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Mean ink of each target cell (area-weighted box filter). */
export function downscale(ink: Float32Array, width: number, box: { x: number; y: number; w: number; h: number }, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const sx = box.w / w;
  const sy = box.h / h;
  for (let ty = 0; ty < h; ty++) {
    const fy0 = box.y + ty * sy;
    const fy1 = fy0 + sy;
    for (let tx = 0; tx < w; tx++) {
      const fx0 = box.x + tx * sx;
      const fx1 = fx0 + sx;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
        const wy = Math.min(fy1, y + 1) - Math.max(fy0, y);
        if (wy <= 0) continue;
        for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
          const wx = Math.min(fx1, x + 1) - Math.max(fx0, x);
          if (wx <= 0) continue;
          sum += (ink[y * width + x] ?? 0) * wx * wy;
          area += wx * wy;
        }
      }
      out[ty * w + tx] = area > 0 ? sum / area : 0;
    }
  }
  return out;
}

export function convertImage(image: Rgba, options: ConvertOptions): Bitmap {
  const ink = inkMap(image, options.mode);
  const box = options.trim ? contentBox(ink, image.width, image.height) : { x: 0, y: 0, w: image.width, h: image.height };
  const cells = downscale(ink, image.width, box, options.w, options.h);
  const bits: number[] = [];
  for (const value of cells) {
    const on = value >= options.threshold && value > 0;
    bits.push(options.invert ? (on ? 0 : 1) : on ? 1 : 0);
  }
  return makeBitmap(options.w, options.h, bits);
}
