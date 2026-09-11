import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../assets/illustrated-pages.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window });
const engine = window.KobaIllustratedPages;

const page = (id, facingIntent = "auto") => ({ id, width: 1200, height: 1800, facingIntent, url: `https://example.test/${id}.jpg` });

test("approved presentation constants are fixed", () => {
  assert.equal(engine.MIN_SPREAD_PAGE_HEIGHT, 480);
  assert.equal(engine.MIN_SPREAD_PAGE_WIDTH, 320);
  assert.equal(engine.SPREAD_GUTTER, 16);
});

test("phone widths fall back to single-page containment", () => {
  const book = { illustratedPageSettings: { spreadStart: "left" }, chapters: [{ pages: [page("one"), page("two")] }] };
  for (const width of [390, 430]) {
    assert.equal(JSON.stringify(engine.orderedGroups(book, { width, height: 800 }).map((group) => group.pages.length)), "[1,1]");
  }
});

test("eligible laptop and desktop geometry forms same-chapter spreads", () => {
  const book = { illustratedPageSettings: { spreadStart: "left" }, chapters: [{ pages: [page("one"), page("two")] }] };
  for (const viewport of [{ width: 1366, height: 900 }, { width: 1920, height: 1080 }]) {
    assert.equal(JSON.stringify(engine.orderedGroups(book, viewport).map((group) => group.pages.length)), "[2]");
  }
});

test("spread pairing never crosses a chapter boundary", () => {
  const book = { illustratedPageSettings: { spreadStart: "left" }, chapters: [{ pages: [page("one")] }, { pages: [page("two")] }] };
  const groups = engine.orderedGroups(book, { width: 1920, height: 1080 });
  assert.equal(JSON.stringify(groups.map((group) => [group.chapterIndex, group.pages.length])), "[[0,1],[1,1]]");
});

test("facing intent can force a deterministic single page", () => {
  const book = { illustratedPageSettings: { spreadStart: "left" }, chapters: [{ pages: [page("one", "right"), page("two")] }] };
  assert.equal(JSON.stringify(engine.orderedGroups(book, { width: 1920, height: 1080 }).map((group) => group.pages.length)), "[1,1]");
});
