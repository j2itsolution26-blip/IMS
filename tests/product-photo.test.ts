import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alphaBounds, squarePlacement } from '@/lib/image-layout';
import { describeRemoveBgFailure, resolveRemoveBgSize } from '@/server/services/remove-bg-response';

/** An RGBA buffer with the given pixels opaque and everything else transparent. */
function rgba(width: number, height: number, opaque: [number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255;
  return data;
}

test('alphaBounds finds the visible product, ignoring transparent surroundings', () => {
  const data = rgba(10, 8, [
    [3, 2],
    [6, 5],
    [4, 4],
  ]);
  assert.deepEqual(alphaBounds(data, 10, 8), { x: 3, y: 2, width: 4, height: 4 });
});

test('alphaBounds ignores faint edge haze below the threshold', () => {
  const data = rgba(4, 4, [[1, 1]]);
  data[(3 * 4 + 3) * 4 + 3] = 5; // nearly invisible pixel in the corner
  assert.deepEqual(alphaBounds(data, 4, 4), { x: 1, y: 1, width: 1, height: 1 });
});

test('alphaBounds reports a fully transparent image as empty', () => {
  assert.equal(alphaBounds(rgba(5, 5, []), 5, 5), null);
});

test('squarePlacement centres content with padding and keeps its aspect ratio', () => {
  const placement = squarePlacement({ width: 400, height: 800 }, { maxSide: 1024, padding: 0.08 });
  const side = Math.round(800 / 0.84); // the 800px side exactly fills the usable area
  assert.equal(placement.side, side);
  assert.equal(placement.dh, 800);
  assert.equal(placement.dw, 400);
  assert.equal(placement.dx, Math.round((side - 400) / 2));
  assert.equal(placement.dy, Math.round((side - 800) / 2));
});

test('squarePlacement shrinks large content to fit, never stretching it', () => {
  const placement = squarePlacement({ width: 3000, height: 1500 }, { maxSide: 1024, padding: 0.1 });
  assert.equal(placement.side, 1024);
  assert.ok(placement.dw <= 1024 * 0.8 + 1);
  assert.ok(Math.abs(placement.dw / placement.dh - 2) < 0.01, 'aspect ratio preserved');
  // Nothing falls off the canvas.
  assert.ok(placement.dx >= 0 && placement.dy >= 0);
  assert.ok(placement.dx + placement.dw <= placement.side);
  assert.ok(placement.dy + placement.dh <= placement.side);
});

test('squarePlacement never enlarges a small cut-out', () => {
  const placement = squarePlacement({ width: 120, height: 60 });
  assert.equal(placement.dw, 120);
  assert.equal(placement.dh, 60);
});

test('remove.bg size defaults to the cheap preview resolution', () => {
  assert.equal(resolveRemoveBgSize(undefined), 'preview');
  assert.equal(resolveRemoveBgSize('  FULL '), 'full');
  assert.equal(resolveRemoveBgSize('4k-please'), 'preview');
});

test('remove.bg failures become actionable messages', () => {
  assert.match(
    describeRemoveBgFailure(400, { errors: [{ title: 'Could not identify foreground in image', code: 'unknown_foreground' }] }),
    /No product could be found/,
  );
  assert.match(describeRemoveBgFailure(402, { errors: [{ code: 'insufficient_credits' }] }), /run out of credits/);
  assert.match(describeRemoveBgFailure(403, null), /REMOVE_BG_API_KEY/);
  assert.match(describeRemoveBgFailure(429, {}), /Too many photos/);
  assert.match(describeRemoveBgFailure(503, 'not json'), /having trouble/);
  assert.match(describeRemoveBgFailure(400, { errors: [{ title: 'Invalid file' }] }), /Invalid file/);
});
