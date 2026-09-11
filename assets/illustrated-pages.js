(function (global) {
    "use strict";

    const MIN_SPREAD_PAGE_HEIGHT = 480;
    const MIN_SPREAD_PAGE_WIDTH = 320;
    const SPREAD_GUTTER = 16;

    function pageScale(page, width, height) {
        return Math.min(1, width / Number(page.width), height / Number(page.height));
    }

    function canPresentSpread(left, right, viewport) {
        if (!left || !right) return false;
        const pageWidth = (viewport.width - SPREAD_GUTTER) / 2;
        const leftScale = pageScale(left, pageWidth, viewport.height);
        const rightScale = pageScale(right, pageWidth, viewport.height);
        return Math.min(left.width * leftScale, right.width * rightScale) >= MIN_SPREAD_PAGE_WIDTH &&
            Math.min(left.height * leftScale, right.height * rightScale) >= MIN_SPREAD_PAGE_HEIGHT;
    }

    function orderedGroups(book, viewport) {
        const settings = book.illustratedPageSettings || {};
        const allowSpreads = settings.allowSpreads !== false;
        const groups = [];
        (Array.isArray(book.chapters) ? book.chapters : []).forEach((chapter, chapterIndex) => {
            const pages = Array.isArray(chapter.pages) ? chapter.pages : [];
            for (let index = 0; index < pages.length;) {
                const first = pages[index];
                const second = pages[index + 1];
                const firstIsOpeningRight = index === 0 && settings.spreadStart !== "left";
                const forcedSingle = firstIsOpeningRight || first.facingIntent === "right" || second?.facingIntent === "left";
                if (allowSpreads && !forcedSingle && canPresentSpread(first, second, viewport)) {
                    groups.push({ chapterIndex, pages: [first, second] });
                    index += 2;
                } else {
                    groups.push({ chapterIndex, pages: [first] });
                    index += 1;
                }
            }
        });
        return groups;
    }

    function createPlate(page, position) {
        const frame = document.createElement("figure");
        frame.className = "koba-illustrated-page-plate";
        frame.dataset.pagePosition = String(position);
        const image = document.createElement("img");
        image.src = String(page.url || "");
        image.alt = String(page.alt || `Illustrated page ${position}`);
        image.width = Number(page.width) || 1;
        image.height = Number(page.height) || 1;
        image.draggable = false;
        image.decoding = "async";
        frame.appendChild(image);
        return frame;
    }

    function buildReaderPages(book, viewport) {
        let position = 0;
        return orderedGroups(book, viewport).map((group) => {
            const node = document.createElement("article");
            node.className = `koba-illustrated-page-view ${group.pages.length === 2 ? "is-spread" : "is-single"}`;
            node.style.setProperty("--koba-plate-background", book.illustratedPageSettings?.pageBackground || "#111111");
            group.pages.forEach((page) => node.appendChild(createPlate(page, ++position)));
            return {
                type: group.pages.length === 2 ? "illustrated-spread" : "illustrated-page",
                label: group.pages.length === 2 ? `Pages ${position - 1}–${position}` : `Page ${position}`,
                node,
            };
        });
    }

    global.KobaIllustratedPages = Object.freeze({
        MIN_SPREAD_PAGE_HEIGHT,
        MIN_SPREAD_PAGE_WIDTH,
        SPREAD_GUTTER,
        canPresentSpread,
        orderedGroups,
        buildReaderPages,
    });
})(window);
