import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../assets/bloom-player.js", import.meta.url), "utf8");
const plugin = await readFile(new URL("../koba-i-audio.php", import.meta.url), "utf8");
const gatewaySecurity = await readFile(new URL("../includes/gateway-security.php", import.meta.url), "utf8");
const publicationWriteSource = `${plugin}\n${gatewaySecurity}`;

function loadIntegrityApi() {
  const window = {
    location: { href: "https://author.example/koba_publication/book/" },
    addEventListener() {},
  };
  const document = { readyState: "loading", addEventListener() {} };
  vm.runInNewContext(source, { window, document, URL, console, navigator: {} });
  return window.KobaBloomPublicationIntegrity;
}

test("playable media accepts safe absolute and same-origin relative HTTP sources", () => {
  const { resolvePlayableMediaSource } = loadIntegrityApi();
  assert.equal(
    resolvePlayableMediaSource({ url: "https://signed.example/chapter.mp3?token=short" }, "https://author.example/book/"),
    "https://signed.example/chapter.mp3?token=short",
  );
  assert.equal(
    resolvePlayableMediaSource({ src: "/protected/chapter.mp4" }, "https://author.example/book/"),
    "https://author.example/protected/chapter.mp4",
  );
});

test("missing, malformed, credentialed, and non-web media sources fail closed", () => {
  const { resolvePlayableMediaSource } = loadIntegrityApi();
  for (const track of [
    {},
    { url: "http://[" },
    { url: "javascript:alert(1)" },
    { url: "file:///private/chapter.mp3" },
    { url: "https://user:password@example.com/chapter.mp3" },
  ]) {
    assert.equal(resolvePlayableMediaSource(track, "https://author.example/book/"), "");
  }
});

test("empty and failed publications render controlled reader-facing states", () => {
  assert.match(source, /Publication unavailable/);
  assert.match(source, /does not contain playable chapters/);
  assert.match(source, /k-player-safe-error/);
  assert.match(source, /chapterMedia\.onerror = \(\) =>/);
  assert.match(source, /This chapter could not be loaded/);
  assert.match(source, /This chapter is temporarily unavailable/);
});

test("chapter order and transition behavior continue to use the authoritative manifest array", () => {
  assert.match(source, /const chapters = Array\.isArray\(data\.chapters\) \? data\.chapters : \[\]/);
  assert.match(source, /chapters\.forEach\(\(c, i\) =>/);
  assert.match(source, /loadChapter\(currentIndex \+ 1, \{ autoplay: true \}\)/);
  assert.match(source, /if \(index < 0 \|\| index >= chapters\.length\) return/);
});

test("publish-vault resolves WordPress posts by immutable asset identity before slug", () => {
  assert.match(publicationWriteSource, /function koba_find_publication_post_by_asset_key/);
  assert.match(publicationWriteSource, /koba_resolve_existing_publication_post/);
  assert.match(publicationWriteSource, /expectedPublicationId/);
  assert.match(publicationWriteSource, /expectedPageId/);
  assert.match(publicationWriteSource, /publication_identity_conflict/);
});

test("publish-vault uses update semantics for a resolved identity", () => {
  assert.match(plugin, /if \(\$pub_id > 0\)[\s\S]*?wp_update_post\(\$pub_data, true\)/);
  assert.match(plugin, /if \(\$existing_page_id > 0\)[\s\S]*?wp_update_post\(\$page_data, true\)/);
});

test("draft and ready deployments remain private while published deployments become public", () => {
  assert.match(plugin, /\$publication_status = sanitize_key\(\$params\['status'\] \?\? 'published'\)/);
  assert.match(plugin, /in_array\(\$publication_status, array\('draft', 'ready', 'published'\), true\)/);
  assert.match(plugin, /\$wordpress_post_status = \$publication_status === 'published' \? 'publish' : 'draft'/);
  assert.match(plugin, /'post_status' => \$wordpress_post_status/);
  assert.match(plugin, /'post_status'\s+=> \$wordpress_post_status/);
  assert.match(plugin, /_koba_publication_status/);
});
