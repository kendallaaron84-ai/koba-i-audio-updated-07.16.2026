import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(testDirectory, "..");
const bloomSource = fs.readFileSync(path.join(pluginRoot, "assets", "bloom-player.js"), "utf8");
const pluginSource = fs.readFileSync(path.join(pluginRoot, "koba-i-audio.php"), "utf8");
const mobileStateTest = fs.readFileSync(path.join(testDirectory, "mobile-video-state.test.mjs"), "utf8");

test("Phase 6D audio and video leave-return flow uses scoped resume without autoplay", () => {
  assert.match(bloomSource, /koba_bloom_resume_v1/);
  assert.match(bloomSource, /const tenantId = resumeScopeValue\([\s\S]*?data\.tenantId \|\| data\.studioKey/);
  assert.match(bloomSource, /const assetId = resumeScopeValue\(data\.assetId \|\| data\.assetKey\)/);
  assert.match(bloomSource, /pagehide/);
  assert.match(bloomSource, /beforeunload/);
  assert.match(bloomSource, /options\.restore === true/);
  assert.match(bloomSource, /loadChapter\(currentIndex, \{ restore: Boolean\(pendingResumeState\), autoplay: false \}\)/);
});

test("Phase 6D video menu and rotation behavior remains reversible alongside resume", () => {
  assert.match(bloomSource, /setChapterMenuOpen\(!root\.classList\.contains\('k-chapter-menu-open'\)\)/);
  assert.match(bloomSource, /orientationchange'[\s\S]*?setChapterMenuOpen\(false\)/);
  assert.match(mobileStateTest, /mobile hamburger toggles a reversible chapter menu/);
  assert.match(mobileStateTest, /portrait and short-landscape CSS retain reachable video controls/);
});

test("Phase 6D e-reader restores its asset-scoped section and visual page", () => {
  assert.match(pluginSource, /const progressKey = `koba_reader_progress_\$\{assetKey\}`/);
  assert.match(pluginSource, /function saveReaderProgress\(\)/);
  assert.match(pluginSource, /sectionIndex: currentIndex/);
  assert.match(pluginSource, /visualPage: currentVisualPage/);
  assert.match(pluginSource, /localStorage\.getItem\(progressKey\)/);
  assert.match(pluginSource, /savedSectionIndex >= 0 && savedSectionIndex < readerPages\.length/);
  assert.match(pluginSource, /currentVisualPage = Math\.max\(0, savedVisualPage\)/);
  assert.match(pluginSource, /renderPage\(\)/);
});
