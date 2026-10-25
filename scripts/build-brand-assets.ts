/**
 * Regenerates every brand derivative from the two committed sources:
 *
 *   public/brand/tindahanpromax-logo.png  the official logo, never modified
 *   public/brand/tindahanpromax-icon.svg  the square mark the sidebar uses
 *
 * The full logo carries a wordmark that is unreadable below ~120px, so the
 * app icons (favicon, home-screen and install icons) use the logo's emblem —
 * the cart, barcode-scanning phone and swoosh — cut from the original pixels
 * and scaled proportionally, never redrawn or stretched.
 *
 * Run with `npx tsx scripts/build-brand-assets.ts` after changing either
 * source. `sharp` is the image library Next.js already installs.
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'public', 'brand');
const appDir = path.join(root, 'src', 'app');

const LOGO = path.join(brand, 'tindahanpromax-logo.png');

/** The emblem inside the 1254px logo: everything above the wordmark. */
const EMBLEM = { left: 110, top: 140, width: 1030, height: 690 } as const;
/**
 * Wordmark pieces that reach into the emblem's box, in emblem coordinates:
 * the leaf on the "i" of "Tindahan" (left of the cart wheels), and the glow
 * behind the wordmark along the bottom edge. Both are faded out.
 */
const LEAF = { left: 0, top: 630, width: 185, height: 60 } as const;
const BOTTOM_FADE = 16;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

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

/** The emblem with its transparency, trimmed to the artwork. */
async function emblem(): Promise<Buffer> {
  const { data, info } = await sharp(LOGO)
    .extract(EMBLEM)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Feathered so no hard cut shows where wordmark pixels are removed.
  const feather = 12;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      let keep = 1;
      const intoLeafX = LEAF.left + LEAF.width - x;
      const intoLeafY = y - LEAF.top;
      if (intoLeafX > 0 && intoLeafY > 0) keep = 1 - Math.min(1, Math.min(intoLeafX, intoLeafY) / feather);
      const intoBottom = y - (info.height - BOTTOM_FADE);
      if (intoBottom > 0) keep = Math.min(keep, 1 - intoBottom / BOTTOM_FADE);
      const alpha = (y * info.width + x) * 4 + 3;
      data[alpha] = Math.round(data[alpha] * keep);
    }
  }

  return sharp(data, { raw: info }).png().trim({ threshold: 1 }).toBuffer();
}

/** A square icon: the emblem fitted proportionally inside `content` of the side. */
async function icon(art: Buffer, size: number, content: number, background = TRANSPARENT): Promise<Buffer> {
  const box = Math.round(size * content);
  const fitted = await sharp(art)
    .resize(box, box, { fit: 'inside', kernel: 'lanczos3' })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
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

  const art = await emblem();

  // Favicon: transparent, nearly edge to edge so it reads at 16px. A PNG
  // icon replaces the old SVG one, which browsers would otherwise prefer.
  await rm(path.join(appDir, 'icon.svg'), { force: true });
  await writeFile(path.join(appDir, 'icon.png'), await icon(art, 96, 0.96));
  const ico = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, data: await icon(art, size, 0.96) })),
  );
  await writeFile(path.join(appDir, 'favicon.ico'), toIco(ico));

  // iOS fills transparency with black, so the touch icon is opaque white.
  await writeFile(path.join(appDir, 'apple-icon.png'), await icon(art, 180, 0.84, WHITE));

  // Web app manifest icons. "any" keeps the logo's transparency; maskable is
  // opaque and fits the emblem inside the central 80% circle launchers keep
  // (a 1.5:1 emblem 65% wide has its corners at ~39% from the centre).
  await writeFile(path.join(brand, 'icon-192.png'), await icon(art, 192, 0.88));
  await writeFile(path.join(brand, 'icon-512.png'), await icon(art, 512, 0.88));
  await writeFile(path.join(brand, 'icon-maskable-512.png'), await icon(art, 512, 0.65, WHITE));

  console.log('Brand assets written.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
