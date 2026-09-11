import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function loadGroupingFunctions() {
  const core = await readFile(new URL("assets/jubilee-core.js", root), "utf8");
  const start = core.indexOf("function normalizeCatalogType");
  const end = core.indexOf("function buildCatalogGridUI");
  assert.ok(start >= 0 && end > start, "catalog grouping functions must remain testable");
  return Function(`${core.slice(start, end)}; return { normalizeCatalogType, groupCatalogProducts };`)();
}

test("audiobooks and e-books render into independent storefront rows", async () => {
  const { groupCatalogProducts } = await loadGroupingFunctions();
  const groups = groupCatalogProducts([
    { assetKey: "abk_audio-one", type: "audiobook", title: "Audio One" },
    { assetKey: "ebk_ebook-one", type: "ebook", title: "E-book One" },
    { assetKey: "abk_audio-two", assetType: "audio_book", title: "Audio Two" },
  ]);

  assert.deepEqual(groups.map(({ key, label }) => ({ key, label })), [
    { key: "audiobook", label: "Audiobooks" },
    { key: "ebook", label: "E-books" },
  ]);
  assert.deepEqual(groups[0].products.map((product) => product.assetKey), ["abk_audio-one", "abk_audio-two"]);
  assert.deepEqual(groups[1].products.map((product) => product.assetKey), ["ebk_ebook-one"]);
});

test("unknown publication taxonomy is isolated instead of merged into a book row", async () => {
  const { groupCatalogProducts, normalizeCatalogType } = await loadGroupingFunctions();
  const groups = groupCatalogProducts([
    { assetKey: "vid_interview", type: "video", title: "Interview" },
    { assetKey: "ebk_story", type: "e-book", title: "Story" },
  ]);

  assert.equal(normalizeCatalogType({ assetKey: "ebk_story", type: "e-book" }), "ebook");
  assert.deepEqual(groups.map((group) => group.key), ["ebook", "publication"]);
  assert.equal(groups[1].products[0].assetKey, "vid_interview");
});

test("grouping remains downstream of the authenticated tenant-scoped catalog request", async () => {
  const core = await readFile(new URL("assets/jubilee-core.js", root), "utf8");
  const render = core.slice(core.indexOf("async function renderAuthorLibrary"), core.indexOf("function renderCatalogError"));
  assert.match(render, /requestJson\(targetUrl\.toString\(\)\)/);
  assert.match(render, /buildCatalogGridUI\(container, result\.products\)/);
  assert.doesNotMatch(render, /X-Studio-Key|searchParams\.set\("author"/);
});
