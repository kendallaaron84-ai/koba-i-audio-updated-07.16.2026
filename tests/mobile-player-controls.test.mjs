import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

async function mobilePlayerSources() {
  const [player, styles] = await Promise.all([
    readFile(new URL("assets/bloom-player.js", pluginRoot), "utf8"),
    readFile(new URL("assets/bloom-style.css", pluginRoot), "utf8"),
  ]);
  const shell = styles.slice(styles.indexOf("P0 CROSS-DEVICE PUBLICATION SHELL"));
  const phone = shell.slice(
    shell.indexOf("@media (max-width: 767px)"),
    shell.indexOf("@media (min-width: 768px) and (max-width: 1023px)"),
  );
  return { player, shell, phone };
}

test("phone playback controls fill both control rows with stable columns", async () => {
  const { phone } = await mobilePlayerSources();

  assert.match(phone, /\.k-buttons\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?grid-template-rows:\s*auto auto;/);
  assert.match(phone, /\.k-primary-transport,\s*\.k-actions\s*\{[\s\S]*?display:\s*grid;[\s\S]*?width:\s*100%;[\s\S]*?justify-items:\s*center;/);
  assert.match(phone, /\.k-primary-transport\s*\{\s*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(phone, /\.k-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(phone, /\.k-btn-icon\s*\{[\s\S]*?min-width:\s*var\(--k-touch-target\);[\s\S]*?min-height:\s*var\(--k-touch-target\);/);
});

test("all existing Bloom Player controls remain present and grouped", async () => {
  const { player } = await mobilePlayerSources();

  assert.match(player, /class="k-primary-transport" aria-label="Playback controls"/);
  assert.match(player, /class="k-actions" aria-label="Player tools"/);
  for (const id of [
    "k-rw-btn",
    "k-prev-btn",
    "k-play-btn",
    "k-next-btn",
    "k-ff-btn",
    "k-speed-btn",
    "k-mark-btn",
    "k-text-btn",
    "k-fullscreen-btn",
  ]) {
    assert.match(player, new RegExp(`id=['"]${id}['"]`));
  }
});

test("desktop controls retain their established single-row composition", async () => {
  const { shell } = await mobilePlayerSources();
  const desktop = shell.slice(shell.indexOf("@media (min-width: 1024px)"));

  assert.match(desktop, /\.k-primary-transport,\s*\.k-actions\s*\{\s*display:\s*contents;/);
});
