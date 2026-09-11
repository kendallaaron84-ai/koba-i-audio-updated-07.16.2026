import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("e-reader manifest lookup uses the same authoritative dashboard origin as canonical handoff", async () => {
  const plugin = await readFile(new URL("koba-i-audio.php", pluginRoot), "utf8");
  const readerStart = plugin.indexOf("function koba_render_sovereign_reader_engine");
  const readerEnd = plugin.indexOf("/* =========================================================================", readerStart + 1);
  const reader = plugin.slice(readerStart, readerEnd > readerStart ? readerEnd : undefined);

  assert.ok(readerStart >= 0, "the e-reader renderer must exist");
  assert.match(reader, /\$base_api_url\s*=\s*koba_get_dashboard_url\(\);/);
  assert.match(reader, /\/api\/media\/manifest/);
  assert.match(reader, /KobaReaderHandoff\.sessionForAsset\(assetKey, root\.dataset\.studioKey \|\| ""\)/);
  assert.match(reader, /canonicalSession\.globalReaderToken/);
  assert.match(reader, /Authorization: `Bearer \$\{readerToken\}`/);
  assert.doesNotMatch(reader, /KOBA_NEXTJS_API_URL/);
  assert.doesNotMatch(reader, /http:\/\/localhost:3000/);
});

test("canonical handoff and e-reader lookup share the configured dashboard resolver", async () => {
  const [plugin, handoff] = await Promise.all([
    readFile(new URL("koba-i-audio.php", pluginRoot), "utf8"),
    readFile(new URL("assets/reader-handoff.js", pluginRoot), "utf8"),
  ]);

  assert.match(plugin, /'dashboardUrl'\s*=>\s*\$dashboard_url/);
  assert.match(handoff, /config\.dashboardUrl/);
  assert.match(handoff, /\/api\/reader\/media\/handoff\/exchange/);
});
