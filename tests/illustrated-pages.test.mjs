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

test("durable page identity survives earlier-page replacement and reorder", () => {
  const original = { illustratedPageSettings: { spreadStart: "left", allowSpreads: false }, chapters: [{ id: "chapter-a", pages: [page("one"), page("two"), page("target"), page("four")] }] };
  const progress = { chapterId: "chapter-a", pageId: "target", chapterPageIndex: 2 };
  assert.equal(engine.locateProgress(engine.buildReaderPages(original, { width: 390, height: 844 }), progress), 2);
  const changed = { ...original, chapters: [{ id: "chapter-a", pages: [page("replacement"), page("four"), page("target"), page("two")] }] };
  assert.equal(engine.locateProgress(engine.buildReaderPages(changed, { width: 390, height: 844 }), progress), 2);
});

test("deleted page falls forward at its former chapter position, then clamps to chapter end", () => {
  const book = { illustratedPageSettings: { spreadStart: "left", allowSpreads: false }, chapters: [{ id: "chapter-a", pages: [page("one"), page("two"), page("four")] }, { id: "chapter-b", pages: [page("five")] }] };
  const presentations = engine.buildReaderPages(book, { width: 390, height: 844 });
  assert.equal(engine.locateProgress(presentations, { chapterId: "chapter-a", pageId: "deleted", chapterPageIndex: 2 }), 2);
  assert.equal(engine.locateProgress(presentations, { chapterId: "chapter-a", pageId: "deleted", chapterPageIndex: 99 }), 2);
});
