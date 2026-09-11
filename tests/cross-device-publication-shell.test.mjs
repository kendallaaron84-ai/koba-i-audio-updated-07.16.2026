import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

async function sources() {
  const [player, styles, plugin] = await Promise.all([
    readFile(new URL("assets/bloom-player.js", pluginRoot), "utf8"),
    readFile(new URL("assets/bloom-style.css", pluginRoot), "utf8"),
    readFile(new URL("koba-i-audio.php", pluginRoot), "utf8"),
  ]);
  return { player, styles, plugin };
}

test("phone and tablet shells use explicit non-desktop layouts", async () => {
  const { styles } = await sources();
  const p0 = styles.slice(styles.indexOf("P0 CROSS-DEVICE PUBLICATION SHELL"));

  assert.match(p0, /@media \(max-width: 767px\)/);
  assert.match(p0, /@media \(min-width: 768px\) and \(max-width: 1023px\)/);
  assert.match(p0, /@media \(min-width: 1024px\)/);
  assert.match(p0, /grid-template-rows: auto auto/);
  assert.match(p0, /--k-touch-target: 44px/);
  assert.match(p0, /100vh !important;[\s\S]*100svh !important;[\s\S]*100dvh !important/);
  assert.match(p0, /k-chapter-menu-open \.k-bloom-sidebar/);
});

test("video presentation preserves the media node and exposes a reachable exit", async () => {
  const { player, styles } = await sources();

  assert.match(player, /k-video-presentation-exit/);
  assert.match(player, /root\.classList\.toggle\('k-video-presentation', videoPresentation\)/);
  assert.match(player, /landscapePresentationDismissed = true/);
  assert.match(player, /window\.addEventListener\('resize', stabilizeResponsiveLayout/);
  assert.match(styles, /k-video-presentation \.k-video-presentation-exit[\s\S]*?width: var\(--k-touch-target\)/);
  assert.match(styles, /k-video-presentation \.k-video-viewport[\s\S]*?inset: 0/);
  assert.doesNotMatch(player.slice(player.indexOf("function updateResponsivePresentation")), /createElement\(['"]video['"]\)/);
});

test("reader shell has reading-first controls, thresholded swipe, and portrait-first fullscreen", async () => {
  const { plugin } = await sources();

  assert.match(plugin, /koba-reader-mobile-header/);
  assert.match(plugin, /grid-template-areas:[\s\S]*"previous progress progress next"[\s\S]*"\. settings fullscreen \.*"/);
  assert.match(plugin, /Math\.abs\(deltaX\) >= 56/);
  assert.match(plugin, /Math\.abs\(deltaX\) > Math\.abs\(deltaY\) \* 1\.25/);
  assert.match(plugin, /if \(deltaX < 0\) showNextPage\(\)/);
  assert.match(plugin, /screen\.orientation\.lock\("portrait"\)/);
  assert.match(plugin, /touch-action: pan-y/);
  assert.match(plugin, /font-size: max\(16px, var\(--koba-reader-size\)\)/);
});

test("legacy and security-sensitive player paths remain outside this layout change", async () => {
  const { player, plugin } = await sources();

  assert.match(player, /playMediaElement\(chapterMedia, 'chapter transition'\)/);
  assert.match(plugin, /requestAuthorizedPublication\(\)/);
  assert.match(plugin, /Authorization: `Bearer \$\{readerToken\}`/);
  assert.match(plugin, /koba_get_authoritative_bookstore_url\(\)/);
  assert.match(plugin, /Description: Version 6\.2\.0:/);
});
