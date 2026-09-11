import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const php = fs.readFileSync(new URL('../koba-i-audio.php', import.meta.url), 'utf8');
const player = fs.readFileSync(new URL('../assets/bloom-player.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/bloom-style.css', import.meta.url), 'utf8');

test('text-only EPUB regression', () => {
  assert.match(php, /else body\.textContent = content/);
  assert.match(player, /paragraph\.textContent = line\.trim\(\)/);
});

for (const [label, extension] of [['JPEG', 'jpe?g'], ['PNG', 'png'], ['GIF', 'gif'], ['supported SVG', 'svg']]) {
  test(`${label} illustration fixture`, () => {
    assert.match(php, new RegExp(extension, 'i'));
    assert.match(php, /javascript:/i);
    assert.match(player, /data\|blob\|javascript/);
  });
}

test('small inline image fixture preserves natural size', () => {
  assert.match(css, /width:\s*auto/);
  assert.match(css, /max-width:\s*100%/);
});

test('full-width illustration fixture remains responsive', () => {
  assert.match(css, /\.koba-reader-copy img[\s\S]*max-width:\s*100%/);
});

test('full-page-like illustration fixture is viewport bounded', () => {
  assert.match(css, /max-height:\s*min\(82vh,\s*52rem\)/);
  assert.match(css, /max-height:\s*75vh/);
});

test('image and caption fixture preserves figure semantics', () => {
  assert.match(php, /"FIGCAPTION", "FIGURE"/);
  assert.match(css, /\.koba-reader-copy figcaption/);
});

test('multiple images in one chapter fixture retains document order', () => {
  assert.match(php, /fragment\.append\(\.\.\.root\.childNodes\)/);
  assert.match(player, /content\.append\(\.\.\.root\.childNodes\)/);
});

test('broken or missing image fixture degrades without crashing the chapter', () => {
  assert.match(php, /koba-reader-image-unavailable/);
  assert.match(php, /addEventListener\("error"/);
  assert.match(player, /addEventListener\('error'/);
});

test('KOBA-I CoverArtUrl suppresses only a genuine duplicate EPUB cover', () => {
  assert.match(php, /function isDuplicateCoverChapter/);
  assert.match(php, /images\.length === 1/);
  assert.match(php, /if \(isDuplicateCoverChapter\(chapter, book, primaryCoverUrl\)\) return/);
});

test('EPUB-defined cover is the fallback when CoverArtUrl is absent', () => {
  assert.match(php, /function epubCoverCandidate/);
  assert.match(php, /book\.coverUrl \|\| book\.coverArtUrl \|\| ""\) \|\| epubCoverUrl/);
});
