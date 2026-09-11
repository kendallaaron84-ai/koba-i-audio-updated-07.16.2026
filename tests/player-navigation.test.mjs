import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("full publication shell renders authoritative navigation for every media dispatcher path", async () => {
  const [player, plugin, styles] = await Promise.all([
    readFile(new URL("assets/bloom-player.js", pluginRoot), "utf8"),
    readFile(new URL("koba-i-audio.php", pluginRoot), "utf8"),
    readFile(new URL("assets/bloom-style.css", pluginRoot), "utf8"),
  ]);

  assert.match(player, /Back to Bookstore/);
  assert.match(player, /data-koba-authoritative-back/);
  assert.match(player, /JubileeConfig\.readerUrl/);
  assert.match(player, /resolved\.origin === window\.location\.origin/);
  assert.doesNotMatch(player, /history\.back\(/);
  assert.match(plugin, /function koba_get_authoritative_bookstore_url/);
  assert.match(plugin, /Version: 6\.1\.0/);
  assert.match(plugin, /define\( 'KOBA_IA_VERSION', '6\.1\.0' \);/);
  assert.match(plugin, /get_page_by_path\('bookshelf'/);
  assert.match(plugin, /get_page_by_path\('bookstore'/);
  assert.match(plugin, /'readerUrl'\s*=>\s*koba_get_authoritative_bookstore_url\(\)/);
  assert.match(plugin, /id="koba-app-viewport"[\s\S]*?data-koba-authoritative-back[\s\S]*?koba_render_sovereign_player_engine\(/);
  assert.match(styles, /\.k-bloom-back-to-store/);
  assert.match(styles, /z-index:\s*100001/);
});

test("video-mode Bloom bootstrap preserves the shared publication navigation control", async () => {
  const player = await readFile(new URL("assets/bloom-player.js", pluginRoot), "utf8");

  assert.match(player, /publicationIsVideo/);
  assert.match(player, /hasSharedPublicationNavigation/);
  assert.match(player, /const bookstoreNavigation = hasSharedPublicationNavigation\s*\? ''/);
  assert.match(player, /\$\{bookstoreNavigation\}[\s\S]*?k-video-viewport/);
});
