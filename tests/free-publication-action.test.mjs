import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("free storefront actions use the central human-verification page while paid paths remain unchanged", async () => {
  const source = await readFile(new URL("assets/jubilee-core.js", pluginRoot), "utf8");
  assert.match(source, /buildCatalogOpenAction\(assetKey, openLabel, true\)/);
  assert.match(source, /\/reader\/free\?assetId=/);
  assert.match(source, /buildCatalogOpenAction\(assetKey, openLabel, false\)/);
  assert.match(source, /startListenerPurchase/);
  assert.match(source, /\/api\/checkout\/listener-session/);
  assert.match(source, /error\.canonicalHandoff = true/);
});
