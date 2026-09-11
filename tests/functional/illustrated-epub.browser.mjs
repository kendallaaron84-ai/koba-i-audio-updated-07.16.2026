import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..', '..');
const fixtureRoot = path.join(here, 'fixtures');
const evidenceRoot = path.join(here, 'evidence');
fs.mkdirSync(evidenceRoot, { recursive: true });

const php = fs.readFileSync(path.join(pluginRoot, 'koba-i-audio.php'), 'utf8');
const css = fs.readFileSync(path.join(pluginRoot, 'assets', 'bloom-style.css'), 'utf8');
const coverStart = php.indexOf('function createCoverPage(book)');
const helperStart = php.indexOf('const KOBA_EPUB_ALLOWED_TAGS');
const helperEnd = php.indexOf('function saveReaderProgress()', helperStart);
assert.ok(coverStart >= 0 && helperStart > coverStart && helperEnd > helperStart, 'Unable to extract packaged reader implementation');
const readerImplementation = `${php.slice(coverStart, helperStart)}\n${php.slice(helperStart, helperEnd)}`;

const types = { '.xhtml': 'application/xhtml+xml', '.xml': 'application/xml', '.opf': 'application/oebps-package+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
  const target = path.resolve(fixtureRoot, relative);
  if (!target.startsWith(fixtureRoot) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404); response.end('missing'); return; }
  response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(target).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const viewports = [{ name: 'desktop', width: 1280, height: 900 }, { name: '430px', width: 430, height: 820 }, { name: '390px', width: 390, height: 780 }];
const fixtureNames = fs.readdirSync(fixtureRoot).sort();
const expectedImageCounts = { '01-text-only': 0, '02-jpeg': 1, '03-png-transparent': 1, '04-safe-svg': 1, '05-small-inline': 1, '06-full-width': 1, '07-full-page-like': 1, '08-caption': 1, '09-multiple': 2, '10-broken': 0, '11-cover-dedupe': 1, '12-cover-fallback': 1 };
const results = [];
const pngFixture = fs.readFileSync(path.join(fixtureRoot, '03-png-transparent', 'OEBPS', 'images', 'transparent.png'));
assert.equal(pngFixture[25], 6, 'PNG fixture must use RGBA color type');
const idatOffset = pngFixture.indexOf(Buffer.from('IDAT'));
const idatLength = pngFixture.readUInt32BE(idatOffset - 4);
const rgbaRows = zlib.inflateSync(pngFixture.subarray(idatOffset + 4, idatOffset + 4 + idatLength));
assert.ok(rgbaRows.includes(0) && rgbaRows.includes(180), 'PNG fixture must contain transparent and translucent pixels');

function chapterBody(name) {
  const xhtml = fs.readFileSync(path.join(fixtureRoot, name, 'OEBPS', 'chapter.xhtml'), 'utf8');
  return xhtml.match(/<body>([\s\S]*)<\/body>/)?.[1] || '';
}

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.setContent(`<!doctype html><style>:root{--koba-text-width:760px;--koba-text-color:#111;--koba-reader-font:serif;--koba-reader-size:18px;--koba-reader-leading:1.6}html,body{margin:0;overflow-x:hidden}#reader{box-sizing:border-box;width:100%;height:${viewport.height}px;padding:24px;overflow:auto}${css}</style><main id="reader"></main>`);
    await page.addScriptTag({ content: readerImplementation });
    for (const name of fixtureNames) {
      const html = chapterBody(name);
      const baseUrl = `${origin}/${name}/OEBPS/`;
      const metrics = await page.evaluate(async ({ name, html, baseUrl }) => {
        const reader = document.querySelector('#reader');
        reader.replaceChildren();
        if (name.startsWith('11-') || name.startsWith('12-')) {
          const chapter = { title: 'Cover', html, assetBaseUrl: baseUrl, isCover: true, properties: ['cover-image'] };
          const epubCoverUrl = epubCoverCandidate({}, [chapter]);
          const external = name.startsWith('11-') ? `${baseUrl}images/cover.svg` : '';
          const primaryCoverUrl = resolveEpubAssetUrl(external) || epubCoverUrl;
          reader.appendChild(createCoverPage({ title: 'Fixture', authorName: 'KOBA-I', coverUrl: primaryCoverUrl }));
          if (!isDuplicateCoverChapter(chapter, {}, primaryCoverUrl)) reader.appendChild(createTextPage('Cover', html, '', baseUrl));
        } else {
          reader.appendChild(createTextPage(name, html, '', baseUrl));
        }
        await Promise.all([...reader.querySelectorAll('img')].map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); })));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const images = [...reader.querySelectorAll('img')].map(img => {
          const rect = img.getBoundingClientRect();
          return { id: img.id, loaded: img.complete && img.naturalWidth > 0, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, alt: img.alt };
        });
        const readerRect = reader.getBoundingClientRect();
        const order = [...reader.querySelectorAll('.koba-reader-copy p,.koba-reader-copy img,.koba-reader-copy figcaption')].map(node => node.tagName === 'IMG' ? node.getAttribute('alt') : node.textContent);
        return {
          images, order,
          unavailable: reader.querySelectorAll('.koba-reader-image-unavailable').length,
          afterVisible: reader.textContent.includes('Survives broken image.'),
          captions: [...reader.querySelectorAll('figure figcaption')].map(node => ({ text: node.textContent, parentTag: node.parentElement?.tagName })),
          coverImages: reader.querySelectorAll('img').length,
          overflow: reader.scrollWidth > reader.clientWidth + 1,
          reader: { left: readerRect.left, right: readerRect.right, width: reader.clientWidth, scrollWidth: reader.scrollWidth },
        };
      }, { name, html, baseUrl });

      assert.equal(metrics.overflow, false, `${name} overflowed at ${viewport.name}`);
      assert.equal(metrics.images.length, expectedImageCounts[name], `${name} rendered the wrong image count at ${viewport.name}`);
      for (const image of metrics.images) {
        assert.equal(image.loaded, true, `${name} image failed at ${viewport.name}`);
        assert.ok(image.left >= metrics.reader.left - 1 && image.right <= metrics.reader.right + 1, `${name} image escaped viewport`);
        const naturalRatio = image.naturalWidth / image.naturalHeight;
        const renderedRatio = image.width / image.height;
        assert.ok(Math.abs(naturalRatio - renderedRatio) <= Math.max(.03, naturalRatio * .03), `${name} aspect ratio changed`);
      }
      if (name.startsWith('05-')) assert.ok(metrics.images[0].width <= 82, `small image enlarged at ${viewport.name}`);
      if (name.startsWith('07-')) assert.ok(metrics.images[0].bottom <= viewport.height + 1, `full-page image cropped at ${viewport.name}`);
      if (name.startsWith('08-')) assert.deepEqual(metrics.captions, [{ text: 'Deterministic caption', parentTag: 'FIGURE' }]);
      if (name.startsWith('09-')) assert.deepEqual(metrics.order, ['Before.', 'One', 'Middle.', 'Two', 'After.']);
      if (name.startsWith('10-')) { assert.equal(metrics.unavailable, 1); assert.equal(metrics.afterVisible, true); }
      if (name.startsWith('11-') || name.startsWith('12-')) assert.equal(metrics.coverImages, 1, `${name} did not produce exactly one cover`);
      results.push({ fixture: name, viewport: viewport.name, status: 'PASS', ...metrics });
    }
    await page.screenshot({ path: path.join(evidenceRoot, `reader-${viewport.name}.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

fs.writeFileSync(path.join(evidenceRoot, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), packageSource: pluginRoot, results }, null, 2));
console.log(`PASS: ${results.length} rendered fixture/viewport combinations; evidence written to ${evidenceRoot}`);
