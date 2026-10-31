/**
 * Regenerates every app icon from the one official source:
 *
 *   public/brand/tindahanpromax-icon.svg  the official app icon — a white
 *                                         shopping cart in a green rounded square
 *
 * Every size is rendered from the vector, so edges stay sharp and the
 * artwork is never redrawn, cropped or stretched. Where a platform rounds or
 * masks the icon itself (iOS home screen, Android maskable icons) the same
 * artwork is drawn with square corners so the platform's own mask shapes it;
 * the cart sits well inside the safe zone either way.
 *
 * Run with `npx tsx scripts/build-brand-assets.ts` after changing the SVG.
 * `sharp` is the image library Next.js already installs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'public', 'brand');
const appDir = path.join(root, 'src', 'app');

const ICON_SVG = path.join(brand, 'tindahanpromax-icon.svg');

/** Packs PNG images into a .ico container (PNG payloads are valid since Vista). */
function toIco(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

/** The icon rendered as a square PNG of `size` pixels, straight from the vector. */
async function render(svg: string, size: number): Promise<Buffer> {
  // Rasterise at 4x and scale down, for clean anti-aliasing at small sizes.
  const density = Math.max(72, Math.ceil((size * 4 * 72) / 512));
  return sharp(Buffer.from(svg), { density })
    .resize(size, size, { fit: 'contain', kernel: 'lanczos3', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const svg = await readFile(ICON_SVG, 'utf8');
  if (!/rx="112"/.test(svg)) throw new Error('Expected the icon background rect with rx="112".');
  // Same artwork, square corners: for platforms that apply their own mask.
  const fullBleed = svg.replace('rx="112"', 'rx="0"');

  // Browser tab: the rounded icon on transparency, as it appears in the app.
  await writeFile(path.join(appDir, 'icon.png'), await render(svg, 96));
  const ico = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await render(svg, size) })));
  await writeFile(path.join(appDir, 'favicon.ico'), toIco(ico));

  // iOS rounds home-screen icons itself and fills transparency with black.
  await writeFile(path.join(appDir, 'apple-icon.png'), await render(fullBleed, 180));

  // Install icons. "any" keeps the rounded square; maskable is full-bleed so
  // Android's circle or squircle mask keeps the cart (all within the 80% zone).
  await writeFile(path.join(brand, 'icon-192.png'), await render(svg, 192));
  await writeFile(path.join(brand, 'icon-512.png'), await render(svg, 512));
  await writeFile(path.join(brand, 'icon-maskable-192.png'), await render(fullBleed, 192));
  await writeFile(path.join(brand, 'icon-maskable-512.png'), await render(fullBleed, 512));

  console.log('Brand icons written.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
