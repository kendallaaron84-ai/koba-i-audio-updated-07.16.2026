import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("paid storefront actions use the canonical dashboard launcher while free actions remain unchanged", async () => {
  const core = await readFile(new URL("assets/jubilee-core.js", pluginRoot), "utf8");

  assert.match(core, /reader\/open\?assetId=\$\{encodeURIComponent\(assetKey\)\}/);
  assert.match(core, /reader\/free\?assetId=\$\{encodeURIComponent\(assetKey\)\}/);
  assert.match(
    core,
    /reader\/open\?assetId=\$\{encodeURIComponent\(assetKey\)\}[^`]*already-purchased-link[^`]*Already purchased\? Sign in/
  );
  assert.doesNotMatch(
    core,
    /function buildCatalogOpenAction[\s\S]*?: publicationPath\(assetKey, false\)/
  );
  assert.doesNotMatch(core, /function publicationPath\(/);
});

test("direct paid Bloom and e-reader paths redirect before an anonymous manifest request", async () => {
  const [core, plugin] = await Promise.all([
    readFile(new URL("assets/jubilee-core.js", pluginRoot), "utf8"),
    readFile(new URL("koba-i-audio.php", pluginRoot), "utf8"),
  ]);

  assert.match(core, /data-paid-publication/);
  assert.match(
    core,
    /paidPublication && !canonicalSession[\s\S]*?reader\/open\?assetId=/
  );
  assert.match(plugin, /data-paid-publication=/);
  assert.match(
    plugin,
    /if \(!canonicalSession\)[\s\S]*?paidPublication \? '\/reader\/open' : '\/reader\/free'/
  );

  const eReaderRedirect = plugin.indexOf("if (!canonicalSession)");
  const eReaderManifest = plugin.indexOf("const response = await fetch(", eReaderRedirect);
  assert.ok(eReaderRedirect >= 0 && eReaderManifest > eReaderRedirect);
});
