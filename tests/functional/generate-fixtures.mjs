import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function transparentPng(width, height) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) { const row = Buffer.alloc(1 + width * 4); for (let x = 0; x < width; x++) { const offset = 1 + x * 4; row[offset] = 20; row[offset + 1] = 140; row[offset + 2] = 220; row[offset + 3] = x < width / 2 ? 0 : 180; } rows.push(row); }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}
const png = transparentPng(100, 50);
const gif = Buffer.from('R0lGODlhZABQAPAAAP+ZAP///yH5BAAAAAAALAAAAABkAFAAAAJehI+py+0Po5y02ouz3rz7D4biSJbmiaaqK7rtC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8fksvmMTqvX7Lb7DY/L5/S6/Y7P6/f8vv8PGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp+gkaKjpKWmp6ipqqusra6voKGys7S1tre4ubq7vL2+vwAAA7', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAAyAGQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEn/8QAFBABAAAAAAAAAAAAAAAAAAAAUP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAUP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAUP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAUP/aAAgBAQABPxB//9k=', 'base64');
const svg = (w, h, color = '#2563eb') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${color}"/><circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)/4}" fill="#f9b437"/></svg>`;

const fixtures = [
  ['01-text-only', '<p id="before">Before text.</p><p id="after">After text.</p>', {}],
  ['02-jpeg', '<p id="before">Before.</p><img id="hero" src="images/photo.jpg" alt="JPEG fixture"><p id="after">After.</p>', { 'images/photo.jpg': jpeg }],
  ['03-png-transparent', '<p>Transparent PNG.</p><img id="hero" src="images/transparent.png" alt="PNG transparency">', { 'images/transparent.png': png }],
  ['04-safe-svg', '<p>Safe vector.</p><img id="hero" src="images/vector.svg" alt="Safe SVG">', { 'images/vector.svg': svg(400, 200) }],
  ['05-small-inline', '<p id="before">Before.</p><img id="hero" src="images/small.svg" alt="Small inline"><p id="after">After.</p>', { 'images/small.svg': svg(80, 40, '#059669') }],
  ['06-full-width', '<p>Wide art.</p><img id="hero" class="full-width" src="images/wide.svg" alt="Full width">', { 'images/wide.svg': svg(1200, 500, '#7c3aed') }],
  ['07-full-page-like', '<img id="hero" src="images/page.svg" alt="Full page illustration"><p id="after">Following content.</p>', { 'images/page.svg': svg(900, 1200, '#be123c') }],
  ['08-caption', '<figure id="figure"><img id="hero" src="images/caption.svg" alt="Captioned art"><figcaption id="caption">Deterministic caption</figcaption></figure><p id="after">After.</p>', { 'images/caption.svg': svg(600, 300) }],
  ['09-multiple', '<p id="before">Before.</p><img id="image-one" src="images/one.svg" alt="One"><p id="middle">Middle.</p><img id="image-two" src="images/two.gif" alt="Two"><p id="after">After.</p>', { 'images/one.svg': svg(240, 120), 'images/two.gif': gif }],
  ['10-broken', '<p id="before">Before.</p><img id="hero" src="images/missing.jpg" alt="Missing fixture"><p id="after">Survives broken image.</p>', {}],
  ['11-cover-dedupe', '<section epub:type="cover"><img id="epub-cover" src="images/cover.svg" alt="EPUB cover"></section>', { 'images/cover.svg': svg(600, 900, '#111827') }],
  ['12-cover-fallback', '<section epub:type="cover"><img id="epub-cover" src="images/cover.svg" alt="EPUB fallback cover"></section>', { 'images/cover.svg': svg(600, 900, '#374151') }],
];

fs.rmSync(root, { recursive: true, force: true });
for (const [name, body, assets] of fixtures) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'META-INF'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'OEBPS', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mimetype'), 'application/epub+zip');
  fs.writeFileSync(path.join(dir, 'META-INF', 'container.xml'), '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  fs.writeFileSync(path.join(dir, 'OEBPS', 'chapter.xhtml'), `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${name}</title></head><body>${body}</body></html>`);
  const items = ['<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>'];
  for (const [relative, value] of Object.entries(assets)) {
    const target = path.join(dir, 'OEBPS', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    const ext = path.extname(relative).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml');
    items.push(`<item id="asset-${items.length}" href="${relative}" media-type="image/${ext}"/>`);
  }
  const coverMeta = name.startsWith('11-') || name.startsWith('12-') ? '<meta name="cover" content="asset-1"/>' : '';
  fs.writeFileSync(path.join(dir, 'OEBPS', 'package.opf'), `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:koba:${name}</dc:identifier><dc:title>${name}</dc:title>${coverMeta}</metadata><manifest>${items.join('')}</manifest><spine><itemref idref="chapter"/></spine></package>`);
}
console.log(`Generated ${fixtures.length} deterministic EPUB fixture trees.`);
