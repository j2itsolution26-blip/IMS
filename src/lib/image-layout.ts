/**
 * Geometry for presenting a background-removed product photo.
 *
 * A cut-out comes back on the original photo's canvas, with the product
 * wherever it happened to sit in the frame. These helpers find the visible
 * pixels and place them, uncropped and unstretched, in the middle of a square
 * transparent canvas — so every product card frames its photo the same way.
 *
 * Pure functions over raw RGBA data: no DOM, so they are unit-tested directly.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The smallest box containing every pixel whose alpha exceeds `threshold`,
 * or null when the image is fully transparent.
 *
 * The threshold ignores the faint haze segmentation models leave around an
 * edge; it is low enough never to clip a real part of the product.
 */
export function alphaBounds(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 8,
): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (rgba[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export interface SquarePlacement {
  /** Side of the square output canvas, in pixels. */
  side: number;
  /** Where the content box is drawn on that canvas. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Places `content` centred on a square canvas with a margin of `padding`
 * (a fraction of the side) on every edge.
 *
 * The aspect ratio is always kept, and small content is never enlarged — an
 * upscaled photo only gets blurrier. The canvas is capped at `maxSide`.
 */
export function squarePlacement(
  content: Pick<Box, 'width' | 'height'>,
  { maxSide = 1024, padding = 0.08 }: { maxSide?: number; padding?: number } = {},
): SquarePlacement {
  const longest = Math.max(content.width, content.height, 1);
  const usable = 1 - 2 * Math.min(Math.max(padding, 0), 0.4);

  const side = Math.max(1, Math.min(maxSide, Math.round(longest / usable)));
  const scale = Math.min(1, (side * usable) / longest);

  const dw = Math.max(1, Math.round(content.width * scale));
  const dh = Math.max(1, Math.round(content.height * scale));

  return {
    side,
    dx: Math.round((side - dw) / 2),
    dy: Math.round((side - dh) / 2),
    dw,
    dh,
  };
}
