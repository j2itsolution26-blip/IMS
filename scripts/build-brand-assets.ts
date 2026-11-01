/**
 * Regenerates every brand derivative from the approved master logo:
 *
 *   public/brand/tindahanpromax-logo.png  the approved full logo (master, never modified)
 *
 * Two kinds of output:
 *
 *  - The full logo's web copy (with wordmark), for screens with room for it.
 *  - The emblem: the master's own cart, products, scanning phone and swoosh,
 *    cut from above the wordmark (which is unreadable below ~120px). It is
 *    the source of every small icon: sidebar and header mark, browser tab
 *    favicon, iOS and PWA install icons. Nothing is redrawn or recoloured;
 *    the emblem sits on a white tile, the background the logo was made for.
 *
 * Where a platform rounds or masks the icon itself (iOS home screen, Android
 * maskable icons) the tile is square and the emblem stays inside the 80%
 * safe zone, so the platform's own mask shapes it.
 *
 * Run with `npx tsx scripts/build-brand-assets.ts` after changing the master,
 * then bump BRAND_ICON_VERSION in src/lib/brand.ts and VERSION in
 * public/sw.js so browsers and installed apps refetch the icons. `sharp` is
 * the image library Next.js already installs.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'public', 'brand');
const appDir = path.join(root, 'src', 'app');

const LOGO = path.join(brand, 'tindahanpromax-logo.png');

/**
 * The emblem's place in the trimmed master, as fractions so a re-export of
 * the master at another size still works: everything above the wordmark,
 * trimmed to the cart, phone and swoosh.
 */
const EMBLEM = { top: 0, bottom: 0.655, left: 0.085, right: 0.905 } as const;

/**
 * The simplified emblem for 16px and 32px browser-tab icons: the master's
 * cart with its products alone, which stays recognisable where the phone and
 * swoosh would blur together.
 */
const CART = { top: 0.1, bottom: 0.655, left: 0.085, right: 0.6 } as const;

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

/** A region of the trimmed master (fractions), transparent around it. */
async function emblem(region: { top: number; bottom: number; left: number; right: number } = EMBLEM): Promise<Buffer> {
  const { data, info } = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
  const left = Math.round(info.width * region.left);
  const top = Math.round(info.height * region.top);
  return sharp(data)
    .extract({
      left,
      top,
      width: Math.round(info.width * region.right) - left,
      height: Math.round(info.height * region.bottom) - top,
    })
    .trim()
    .png()
    .toBuffer();
}

/**
 * The emblem centred on a white tile of `size` pixels. `rounded` gives the
 * app's rounded square (transparent corners); otherwise the tile is square
 * for platforms that apply their own mask. `fill` is how much of the tile's
 * width the emblem may take.
 */
async function tile(art: Buffer, size: number, { rounded, fill }: { rounded: boolean; fill: number }): Promise<Buffer> {
  // Work at 4x and scale down once, for clean edges at small sizes.
  const big = size * 4;
  const box = Math.round(big * fill);
  const scaled = await sharp(art).resize(box, box, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
  const radius = rounded ? Math.round(big * (112 / 512)) : 0;
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${big}" height="${big}"><rect width="${big}" height="${big}" rx="${radius}" fill="#FFFFFF"/></svg>`,
  );
  const composed = await sharp(background).composite([{ input: scaled, gravity: 'center' }]).png().toBuffer();
  return sharp(composed).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
}

async function main() {
  // The web copy of the full logo: transparent margin trimmed, scaled
  // proportionally, never cropped or stretched. PNG on purpose: next/image
  // serves WebP/AVIF where accepted and keeps the transparency otherwise.
  const logo = await sharp(LOGO)
    .trim()
    .resize({ width: 960, withoutEnlargement: true, kernel: 'lanczos3' })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(path.join(brand, 'tindahanpromax-logo-960.png'));
  console.log(`tindahanpromax-logo-960.png  ${logo.width}x${logo.height}`);

  const art = await emblem();
  const rounded = (size: number) => tile(art, size, { rounded: true, fill: 0.86 });
  // Android masks to a circle at worst: the emblem's corners stay inside the
  // central 80% circle at this fill.
  const maskable = (size: number) => tile(art, size, { rounded: false, fill: 0.66 });

  // Sidebar and header mark (shown at 32-40px; 256px stays sharp at 3x+).
  await writeFile(path.join(brand, 'tindahanpromax-mark-256.png'), await rounded(256));

  // Browser tab. Next.js links src/app/icon.png (content-hashed URL) and
  // /favicon.ico; both carry the emblem. The .ico is a real ICO container
  // holding 16, 32 and 48px PNG images.
  await writeFile(path.join(appDir, 'icon.png'), await rounded(96));
  // 16 and 32px use the simplified cart; 48px has room for the whole emblem.
  const cart = await emblem(CART);
  const small = (size: number) => tile(cart, size, { rounded: true, fill: 0.9 });
  const ico = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await (size <= 32 ? small(size) : rounded(size)) })));
  await writeFile(path.join(appDir, 'favicon.ico'), toIco(ico));

  // iOS rounds home-screen icons itself and fills transparency with black.
  await writeFile(path.join(appDir, 'apple-icon.png'), await tile(art, 180, { rounded: false, fill: 0.8 }));

  // Install icons: "any" keeps the rounded tile; maskable is full-bleed.
  await writeFile(path.join(brand, 'icon-192.png'), await rounded(192));
  await writeFile(path.join(brand, 'icon-512.png'), await rounded(512));
  await writeFile(path.join(brand, 'icon-maskable-192.png'), await maskable(192));
  await writeFile(path.join(brand, 'icon-maskable-512.png'), await maskable(512));

  console.log('Brand icons written.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
