import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("mobile hamburger toggles a reversible chapter menu without forcing cover art", async () => {
  const player = await readFile(new URL("assets/bloom-player.js", pluginRoot), "utf8");
  const handlerStart = player.indexOf("if (markBtn) {");
  const handlerEnd = player.indexOf("if (textBtn)", handlerStart);
  const handler = player.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /setChapterMenuOpen\(!root\.classList\.contains\('k-chapter-menu-open'\)\)/);
  assert.match(player, /setChapterMenuOpen\(false\);[\s\S]*?loadChapter\(i, \{ autoplay: true \}\)/);
  assert.match(player, /orientationchange'[\s\S]*?setChapterMenuOpen\(false\)/);
  assert.doesNotMatch(handler, /coverArtContainer\.style\.display = 'block'/);
});

test("portrait and short-landscape CSS retain reachable video controls", async () => {
  const styles = await readFile(new URL("assets/bloom-style.css", pluginRoot), "utf8");

  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.k-bloom-sidebar\s*\{[\s\S]*?display: none/);
  assert.match(styles, /k-chapter-menu-open \.k-bloom-sidebar[\s\S]*?display: flex/);
  assert.match(styles, /@media \(orientation: landscape\) and \(max-height: 600px\) and \(pointer: coarse\)/);
  assert.match(styles, /k-video-presentation[\s\S]*?\.k-video-viewport[\s\S]*?position: absolute/);
  assert.doesNotMatch(styles.slice(styles.indexOf("P0 CROSS-DEVICE")), /calc\(100dvh - 142px\)/);
  assert.match(styles, /\.k-bloom-controls[\s\S]*?flex: 0 0 auto/);
  assert.match(styles, /padding:[^;]*env\(safe-area-inset-bottom\)/);
});
