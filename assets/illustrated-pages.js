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
                    groups.push({ chapterIndex, pages: [first, second], pageIndexes: [index, index + 1] });
                    index += 2;
                } else {
                    groups.push({ chapterIndex, pages: [first], pageIndexes: [index] });
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
            const pages = group.pages.map((page, groupIndex) => ({
                ...page,
                position: position + groupIndex + 1,
                chapterPageIndex: group.pageIndexes[groupIndex],
            }));
            position += pages.length;
            return {
                type: pages.length === 2 ? "illustrated-spread" : "illustrated-page",
                label: pages.length === 2 ? `Pages ${position - 1}–${position}` : `Page ${position}`,
                chapterId: String((book.chapters || [])[group.chapterIndex]?.id || `chapter_${group.chapterIndex + 1}`),
                chapterIndex: group.chapterIndex,
                pages,
                pageIds: pages.map(page => String(page.id || "")),
                node: null,
            };
        });
    }

    function hydratePresentation(presentation, background) {
        if (presentation.node) return presentation.node;
        const node = document.createElement("article");
        node.className = `koba-illustrated-page-view ${presentation.pages.length === 2 ? "is-spread" : "is-single"}`;
        node.style.setProperty("--koba-plate-background", background || "#111111");
        presentation.pages.forEach(page => node.appendChild(createPlate(page, page.position)));
        presentation.node = node;
        return node;
    }

    function disposePresentation(presentation) {
        if (!presentation?.node) return;
        presentation.node.querySelectorAll?.("img").forEach(image => {
            image.removeAttribute("src");
            image.removeAttribute("srcset");
        });
        presentation.node.replaceChildren?.();
        presentation.node.remove?.();
        presentation.node = null;
    }

    function maintainActiveWindow(presentations, activeIndex, background) {
        const lower = Math.max(0, activeIndex - 1);
        const upper = Math.min(presentations.length - 1, activeIndex + 1);
        presentations.forEach((presentation, index) => {
            if (!presentation?.pages) return;
            if (index >= lower && index <= upper) hydratePresentation(presentation, background);
            else disposePresentation(presentation);
        });
        return presentations[activeIndex]?.node || null;
    }

    function locateProgress(presentations, progress) {
        const chapterId = String(progress?.chapterId || "");
        const pageId = String(progress?.pageId || "");
        const exactIndex = presentations.findIndex(item => item.chapterId === chapterId && item.pageIds.includes(pageId));
        if (exactIndex >= 0) return exactIndex;
        const chapterPresentations = presentations
            .map((item, index) => ({ item, index }))
            .filter(entry => entry.item.chapterId === chapterId);
        if (!chapterPresentations.length) return 0;
        const requestedPageIndex = Math.max(0, Number(progress?.chapterPageIndex) || 0);
        const fallback = chapterPresentations.find(entry => entry.item.pages.some(page => Number(page.chapterPageIndex) >= requestedPageIndex));
        return (fallback || chapterPresentations[chapterPresentations.length - 1]).index;
    }

    global.KobaIllustratedPages = Object.freeze({
        MIN_SPREAD_PAGE_HEIGHT,
        MIN_SPREAD_PAGE_WIDTH,
        SPREAD_GUTTER,
        canPresentSpread,
        orderedGroups,
        buildReaderPages,
        maintainActiveWindow,
        locateProgress,
    });
})(window);
