/**
 * Regenerates every brand derivative from the two committed sources:
 *
 *   public/brand/tindahanpromax-logo.png  the official logo, never modified
 *   public/brand/tindahanpromax-icon.svg  the square app mark (cart + barcode)
 *
 * The full logo carries a wordmark that is unreadable below ~120px, so small
 * contexts (favicon, home-screen icons, sidebar) use the square mark instead.
 *
 * Run with `npx tsx scripts/build-brand-assets.ts` after changing either
 * source. `sharp` is the image library Next.js already installs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'public', 'brand');
const appDir = path.join(root, 'src', 'app');

const LOGO = path.join(brand, 'tindahanpromax-logo.png');
const ICON = path.join(brand, 'tindahanpromax-icon.svg');

/** Square mark with no rounded corners, content scaled into a centred safe zone. */
function fullBleed(svg: string, contentScale: number): string {
  const offset = (512 * (1 - contentScale)) / 2;
  return svg
    .replace('rx="112"', 'rx="0"')
    .replace(
      '<g transform="translate(9 -9)">',
      `<g transform="translate(${offset} ${offset}) scale(${contentScale}) translate(9 -9)">`,
    );
}

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

async function main() {
  const iconSvg = await readFile(ICON, 'utf8');
  const png = (svg: string, size: number) =>
    sharp(Buffer.from(svg), { density: 72 * (size / 512) * 4 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer();

  // Login panel and mobile header. Trimming removes only the transparent
  // margin; the artwork is scaled proportionally, never cropped or stretched.
  // PNG rather than WebP on purpose: next/image re-encodes it to WebP/AVIF for
  // browsers that accept them, and falls back to the source format otherwise
  // — a WebP source would fall back to JPEG and lose the transparency.
  const trimmed = await sharp(LOGO).trim().toBuffer();
  const logoInfo = await sharp(trimmed)
    .resize({ width: 960, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(path.join(brand, 'tindahanpromax-logo-960.png'));
  console.log(`logo-960.png  ${logoInfo.width}x${logoInfo.height}`);

  // Favicon and touch icons.
  await writeFile(path.join(appDir, 'icon.svg'), iconSvg);
  const ico = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, data: await png(iconSvg, size) })),
  );
  await writeFile(path.join(appDir, 'favicon.ico'), toIco(ico));
  await writeFile(path.join(appDir, 'apple-icon.png'), await png(fullBleed(iconSvg, 0.86), 180));

  // Web app manifest icons. Maskable content stays inside the 80% safe zone.
  await writeFile(path.join(brand, 'icon-192.png'), await png(iconSvg, 192));
  await writeFile(path.join(brand, 'icon-512.png'), await png(iconSvg, 512));
  await writeFile(path.join(brand, 'icon-maskable-512.png'), await png(fullBleed(iconSvg, 0.72), 512));

  console.log('Brand assets written.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
