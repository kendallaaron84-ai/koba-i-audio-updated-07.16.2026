import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../assets/illustrated-pages.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window });
const engine = window.KobaIllustratedPages;

const pages = Array.from({ length: 22 }, (_, index) => {
  const number = index + 1;
  return {
    id: number === 1 ? "cover" : `page-${number - 1}`,
    width: 1800,
    height: 2400,
    facingIntent: "auto",
    url: `https://media.example.test/protected/dr-sylvia/${number}.webp?token=fixture-${number}`,
    alt: number === 1 ? "Book cover" : `Illustrated story page ${number - 1}`,
  };
});

const book = {
  layoutMode: "illustrated_pages",
  illustratedPageSettings: { spreadStart: "left", allowSpreads: true },
  chapters: [{ id: "ink-and-oil", pages }],
};

const flatten = (groups) => groups.flatMap((group) => group.pages);

test("the essential illustrated-book fixture retains all 22 canonical pages", () => {
  const phone = engine.orderedGroups(book, { width: 390, height: 844 });
  const desktop = engine.orderedGroups(book, { width: 1440, height: 1000 });

  assert.equal(phone.length, 22);
  assert.ok(phone.every((group) => group.pages.length === 1));
  assert.equal(flatten(desktop).length, 22);
  assert.deepEqual(
    Array.from(flatten(desktop), (page) => page.id),
    Array.from(pages, (page) => page.id)
  );
  assert.equal(new Set(flatten(desktop).map((page) => page.id)).size, 22);
});

test("selected page identity survives single-page and spread layout transitions", () => {
  const selected = { chapterId: "ink-and-oil", pageId: "page-21", chapterPageIndex: 21 };
  const phone = engine.buildReaderPages(book, { width: 390, height: 844 });
  const desktop = engine.buildReaderPages(book, { width: 1440, height: 1000 });

  const phoneIndex = engine.locateProgress(phone, selected);
  const desktopIndex = engine.locateProgress(desktop, selected);
  assert.equal(phone[phoneIndex].pages.some((page) => page.id === "page-21"), true);
  assert.equal(desktop[desktopIndex].pages.some((page) => page.id === "page-21"), true);
  assert.equal(engine.locateProgress(phone, selected), phoneIndex);
});

test("responsive grouping never rewrites protected illustration URLs or aspect ratios", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    const renderedPages = flatten(engine.orderedGroups(book, viewport));
    assert.equal(renderedPages.length, 22);
    renderedPages.forEach((page, index) => {
      assert.equal(page.url, pages[index].url);
      assert.equal(page.width / page.height, 0.75);
    });
  }
});
