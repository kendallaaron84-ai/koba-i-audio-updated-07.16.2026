import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);
const releaseRoot = pluginRoot;

function compareNumericVersion(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

test("6.2.2 package metadata and production updater release agree", async () => {
  const [plugin, player, updater, composer, manifest, notes] = await Promise.all([
    readFile(new URL("koba-i-audio.php", pluginRoot), "utf8"),
    readFile(new URL("assets/bloom-player.js", pluginRoot), "utf8"),
    readFile(new URL("includes/updater.php", pluginRoot), "utf8"),
    readFile(new URL("composer.json", pluginRoot), "utf8").then(JSON.parse),
    readFile(new URL("info.json", releaseRoot), "utf8").then(JSON.parse),
    readFile(new URL("RELEASE-NOTES-6.2.2.md", releaseRoot), "utf8"),
  ]);

  assert.match(plugin, /\* Version: 6\.2\.2/);
  assert.match(plugin, /\* Description: Version 6\.2\.2:/);
  assert.match(plugin, /define\( 'KOBA_IA_VERSION', '6\.2\.2' \);/);
  assert.match(player, /const PLAYER_BUILD = '6\.2\.2-mobile-controls';/);
  assert.equal(composer.version, "6.2.2");
  assert.equal(manifest.version, "6.2.2");
  assert.match(manifest.download_url, /koba-i-audio\.zip$/);
  assert.match(notes, /authoritative shared updater release/i);
  assert.match(updater, /version_compare\( \$this->github_response\['version'\], \$checked\[ \$this->plugin \], 'gt' \)/);
});

test("6.2.2 is newer than the 6.2.1 Reader release and 6.2.0 production baseline", () => {
  assert.equal(compareNumericVersion("6.2.2", "6.2.1"), 1);
  assert.equal(compareNumericVersion("6.2.2", "6.2.0"), 1);
});
