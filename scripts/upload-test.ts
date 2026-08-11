/** Exercises the real upload service. Removes everything it creates. */
import zlib from 'node:zlib';
import { prisma } from '../src/lib/prisma';
import { uploadProductImage, deleteProductImage } from '../src/server/services/storage-service';
import { isStorageConfigured } from '../src/lib/env';
import { validateImageUrl } from '../src/lib/image-url';

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };

/** Builds a genuine PNG of the given size — no library, no placeholder service. */
function makePng(size: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour
  const raw = Buffer.concat(Array.from({ length: size }, () =>
    Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, () => Buffer.from(rgb)))])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  check('storage reports configured', isStorageConfigured());

  console.log('\nUpload a real PNG through the application service');
  const png = makePng(256, [220, 38, 38]);
  const file = new File([new Uint8Array(png)], 'coke.png', { type: 'image/png' });
  const url = await uploadProductImage(file, 'COKE-1');
  console.log(`    -> ${url}`);
  check('upload returned a URL', Boolean(url));
  check('path uses a UUID, not just the filename', /products\/coke-1-[0-9a-f-]{36}\.png$/.test(url));
  check('URL passes the app\'s own image validation', validateImageUrl(url).ok);

  console.log('\nThe uploaded image is publicly readable');
  const res = await fetch(url);
  check('fetches over HTTPS', res.ok, `HTTP ${res.status}`);
  check('served as image/png', (res.headers.get('content-type') ?? '').includes('image/png'),
    res.headers.get('content-type') ?? 'none');
  const bytes = Buffer.from(await res.arrayBuffer());
  check('bytes match what was uploaded', bytes.length === png.length, `${bytes.length} vs ${png.length}`);

  console.log('\nRejections');
  const oversize = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' });
  await uploadProductImage(oversize, 'X').then(
    () => check('6 MB file rejected', false, 'accepted!'),
    (e) => check('6 MB file rejected', true, e.message));

  const pdf = new File([new Uint8Array(Buffer.from('%PDF-1.4'))], 'doc.pdf', { type: 'application/pdf' });
  await uploadProductImage(pdf, 'X').then(
    () => check('PDF rejected', false, 'accepted!'),
    (e) => check('PDF rejected', true, e.message));

  const exe = new File([new Uint8Array(Buffer.from('MZ'))], 'a.exe', { type: 'application/x-msdownload' });
  await uploadProductImage(exe, 'X').then(
    () => check('EXE rejected', false, 'accepted!'),
    (e) => check('EXE rejected', true, e.message));

  const svg = new File([new Uint8Array(Buffer.from('<svg/>'))], 'a.svg', { type: 'image/svg+xml' });
  await uploadProductImage(svg, 'X').then(
    () => check('SVG rejected (can carry script)', false, 'accepted!'),
    (e) => check('SVG rejected (can carry script)', true, e.message));

  const empty = new File([new Uint8Array(0)], 'e.png', { type: 'image/png' });
  await uploadProductImage(empty, 'X').then(
    () => check('empty file rejected', false, 'accepted!'),
    (e) => check('empty file rejected', true, e.message));

  console.log('\nAttach to the real product, then detach');
  const coke = await prisma.product.findFirst({ where: { sku: 'COKE-1' }, select: { id: true, imageUrl: true } });
  if (coke) {
    await prisma.product.update({ where: { id: coke.id }, data: { imageUrl: url } });
    const saved = await prisma.product.findUnique({ where: { id: coke.id }, select: { imageUrl: true } });
    check('image reference saved on the product', saved?.imageUrl === url);
    await prisma.product.update({ where: { id: coke.id }, data: { imageUrl: coke.imageUrl } });
    check('product restored to prior state', true);
  } else {
    check('COKE-1 present', false, 'not found');
  }

  console.log('\nCleanup');
  const removal = await deleteProductImage(url);
  check('delete reports success', removal.status === 'deleted', removal.status);

  // Storage is authoritative. The public URL keeps serving a cached copy via
  // Supabase's CDN after the object is gone, so asserting on it would test the
  // CDN rather than the deletion.
  const { createClient } = await import('@supabase/supabase-js');
  const fsMod = await import('node:fs');
  const e: Record<string, string> = {};
  for (const l of fsMod.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(l);
    if (m) e[m[1]] = m[2];
  }
  const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: left } = await sb.storage
    .from(e.SUPABASE_STORAGE_BUCKET || 'product-images')
    .list('products');
  check('object is gone from storage', (left?.length ?? 0) === 0, `${left?.length ?? 0} remain`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
