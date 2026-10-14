(function (global) {
    "use strict";

    const MIN_SPREAD_PAGE_HEIGHT = 480;
    const MIN_SPREAD_PAGE_WIDTH = 320;
    const SPREAD_GUTTER = 16;
    const EXPANDED_ZOOM_MIN = 1;
    const EXPANDED_ZOOM_MAX = 5;
    const EXPANDED_ZOOM_STEP = 0.25;
    let expandedViewer = null;

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

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function findPageTrigger(chapterId, pageId) {
        return [...document.querySelectorAll(".koba-illustrated-page-expand")]
            .find(button => button.dataset.chapterId === chapterId && button.dataset.pageId === pageId) || null;
    }

    function focusPageTrigger(identity, options = {}) {
        const chapterId = String(identity?.chapterId || "");
        const pageId = String(identity?.pageId || "");
        if (!chapterId || !pageId) return false;
        const target = findPageTrigger(chapterId, pageId);
        if (!target) return false;
        target.focus({ preventScroll: options.preventScroll !== false });
        return document.activeElement === target;
    }

    function closeExpandedViewer(options = {}) {
        const state = expandedViewer;
        if (!state) return false;
        expandedViewer = null;
        state.releasePointers();
        state.removeResizeListener();
        state.overlay.querySelectorAll("img").forEach(image => {
            image.removeAttribute("src");
            image.removeAttribute("srcset");
        });
        state.overlay.replaceChildren();
        state.overlay.remove();
        document.body.classList.remove("koba-illustrated-zoom-open");
        document.body.style.overflow = state.previousBodyOverflow;
        state.backgroundElements.forEach(({ element, wasInert, ariaHidden }) => {
            element.inert = wasInert;
            if (ariaHidden === null) element.removeAttribute("aria-hidden");
            else element.setAttribute("aria-hidden", ariaHidden);
        });
        if (options.restoreFocus !== false) {
            const target = state.trigger.isConnected ? state.trigger : findPageTrigger(state.chapterId, state.pageId);
            target?.focus?.({ preventScroll: true });
        }
        return true;
    }

    function getExpandedViewerIdentity() {
        if (!expandedViewer) return null;
        return Object.freeze({
            chapterId: expandedViewer.chapterId,
            pageId: expandedViewer.pageId,
            chapterPageIndex: expandedViewer.chapterPageIndex,
        });
    }

    function openExpandedViewer(trigger, sourceImage, page, chapterId) {
        if (!trigger || !sourceImage || !page) return null;
        closeExpandedViewer({ restoreFocus: false });

        const pageId = String(page.id || "");
        const imageAlt = String(page.alt || `Illustrated page ${page.position || ""}`).trim() || "Illustrated page";
        const overlay = document.createElement("div");
        overlay.className = "koba-illustrated-zoom-overlay";
        overlay.dataset.pageId = pageId;
        overlay.dataset.chapterId = String(chapterId || "");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "koba-illustrated-zoom-title");

        const heading = document.createElement("h2");
        heading.id = "koba-illustrated-zoom-title";
        heading.className = "koba-illustrated-visually-hidden";
        heading.textContent = `Expanded view: ${imageAlt}`;

        const toolbar = document.createElement("div");
        toolbar.className = "koba-illustrated-zoom-toolbar";
        toolbar.setAttribute("role", "toolbar");
        toolbar.setAttribute("aria-label", "Expanded illustration controls");

        const createControl = (text, label, action) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = text;
            button.setAttribute("aria-label", label);
            button.addEventListener("click", event => {
                event.stopPropagation();
                action();
            });
            return button;
        };

        const zoomOutButton = createControl("−", "Zoom out", () => setScale(scale - EXPANDED_ZOOM_STEP, null, true));
        const zoomInButton = createControl("+", "Zoom in", () => setScale(scale + EXPANDED_ZOOM_STEP, null, true));
        const fitButton = createControl("Fit", "Fit the complete illustration in the viewer", () => fitView(true));
        const resetButton = createControl("Reset", "Reset zoom and position", () => {
            fitView(true);
            viewport.focus({ preventScroll: true });
        });
        const closeButton = createControl("Close", "Close expanded illustration", () => closeExpandedViewer());
        const zoomStatus = document.createElement("span");
        zoomStatus.className = "koba-illustrated-zoom-status";
        zoomStatus.setAttribute("aria-live", "polite");
        zoomStatus.setAttribute("aria-atomic", "true");

        toolbar.append(zoomOutButton, zoomStatus, zoomInButton, fitButton, resetButton, closeButton);

        const viewport = document.createElement("div");
        viewport.className = "koba-illustrated-zoom-viewport";
        viewport.tabIndex = 0;
        viewport.setAttribute("aria-label", "Expanded illustration. Pinch or use the controls to zoom; drag or use arrow keys to pan.");
        const surface = document.createElement("div");
        surface.className = "koba-illustrated-zoom-surface";
        const image = document.createElement("img");
        image.src = sourceImage.currentSrc || sourceImage.src;
        image.alt = imageAlt;
        image.width = Number(page.width) || sourceImage.naturalWidth || 1;
        image.height = Number(page.height) || sourceImage.naturalHeight || 1;
        image.draggable = false;
        image.decoding = "async";
        const imageError = document.createElement("p");
        imageError.className = "koba-illustrated-zoom-error";
        imageError.hidden = true;
        imageError.setAttribute("role", "status");
        imageError.textContent = "This illustration is unavailable in expanded view.";
        image.addEventListener("error", () => {
            image.hidden = true;
            imageError.hidden = false;
        }, { once: true });
        surface.appendChild(image);
        surface.appendChild(imageError);
        viewport.appendChild(surface);
        overlay.append(heading, toolbar, viewport);

        let scale = EXPANDED_ZOOM_MIN;
        let translateX = 0;
        let translateY = 0;
        const pointers = new Map();
        let gesture = null;
        let platformGestureStartScale = null;

        function constrainTranslation() {
            if (scale <= EXPANDED_ZOOM_MIN) {
                translateX = 0;
                translateY = 0;
                return;
            }
            const viewportWidth = Math.max(1, viewport.clientWidth);
            const viewportHeight = Math.max(1, viewport.clientHeight);
            const imageWidth = Math.max(1, image.offsetWidth) * scale;
            const imageHeight = Math.max(1, image.offsetHeight) * scale;
            const maximumX = Math.max(0, (imageWidth - viewportWidth) / 2);
            const maximumY = Math.max(0, (imageHeight - viewportHeight) / 2);
            translateX = clamp(translateX, -maximumX, maximumX);
            translateY = clamp(translateY, -maximumY, maximumY);
        }

        function renderTransform(announce = false) {
            constrainTranslation();
            surface.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
            const percent = Math.round(scale * 100);
            zoomStatus.textContent = `${percent}%`;
            zoomOutButton.disabled = scale <= EXPANDED_ZOOM_MIN;
            zoomInButton.disabled = scale >= EXPANDED_ZOOM_MAX;
            viewport.classList.toggle("is-zoomed", scale > EXPANDED_ZOOM_MIN);
            if (announce) zoomStatus.setAttribute("aria-label", `Zoom ${percent} percent`);
        }

        function setScale(nextScale, focalPoint = null, announce = false) {
            const previousScale = scale;
            const normalizedScale = clamp(Number(nextScale) || EXPANDED_ZOOM_MIN, EXPANDED_ZOOM_MIN, EXPANDED_ZOOM_MAX);
            if (normalizedScale === previousScale) {
                renderTransform(announce);
                return;
            }
            if (focalPoint) {
                const bounds = viewport.getBoundingClientRect();
                const focalX = focalPoint.clientX - bounds.left - (bounds.width / 2);
                const focalY = focalPoint.clientY - bounds.top - (bounds.height / 2);
                const ratio = normalizedScale / previousScale;
                translateX = focalX - ((focalX - translateX) * ratio);
                translateY = focalY - ((focalY - translateY) * ratio);
            }
            scale = normalizedScale;
            renderTransform(announce);
        }

        function fitView(announce = false) {
            scale = EXPANDED_ZOOM_MIN;
            translateX = 0;
            translateY = 0;
            renderTransform(announce);
        }

        function pointerDistance(first, second) {
            return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
        }

        function pointerMidpoint(first, second) {
            return { clientX: (first.clientX + second.clientX) / 2, clientY: (first.clientY + second.clientY) / 2 };
        }

        viewport.addEventListener("pointerdown", event => {
            event.preventDefault();
            event.stopPropagation();
            pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
            try { viewport.setPointerCapture(event.pointerId); } catch (error) {}
            if (pointers.size === 2) {
                const [first, second] = [...pointers.values()];
                gesture = {
                    type: "pinch",
                    distance: Math.max(1, pointerDistance(first, second)),
                    midpoint: pointerMidpoint(first, second),
                    scale,
                    translateX,
                    translateY,
                };
            } else if (pointers.size === 1) {
                gesture = { type: "pan", clientX: event.clientX, clientY: event.clientY };
            }
            viewport.focus({ preventScroll: true });
        });

        viewport.addEventListener("pointermove", event => {
            if (!pointers.has(event.pointerId)) return;
            event.preventDefault();
            event.stopPropagation();
            pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
            if (pointers.size >= 2 && gesture?.type === "pinch") {
                const [first, second] = [...pointers.values()];
                const midpoint = pointerMidpoint(first, second);
                const nextScale = clamp(gesture.scale * (pointerDistance(first, second) / gesture.distance), EXPANDED_ZOOM_MIN, EXPANDED_ZOOM_MAX);
                const bounds = viewport.getBoundingClientRect();
                const startX = gesture.midpoint.clientX - bounds.left - (bounds.width / 2);
                const startY = gesture.midpoint.clientY - bounds.top - (bounds.height / 2);
                const currentX = midpoint.clientX - bounds.left - (bounds.width / 2);
                const currentY = midpoint.clientY - bounds.top - (bounds.height / 2);
                const ratio = nextScale / gesture.scale;
                scale = nextScale;
                translateX = currentX - ((startX - gesture.translateX) * ratio);
                translateY = currentY - ((startY - gesture.translateY) * ratio);
                renderTransform(false);
            } else if (pointers.size === 1 && gesture?.type === "pan" && scale > EXPANDED_ZOOM_MIN) {
                translateX += event.clientX - gesture.clientX;
                translateY += event.clientY - gesture.clientY;
                gesture.clientX = event.clientX;
                gesture.clientY = event.clientY;
                renderTransform(false);
            }
        }, { passive: false });

        const finishPointer = event => {
            if (!pointers.has(event.pointerId)) return;
            event.preventDefault();
            event.stopPropagation();
            pointers.delete(event.pointerId);
            try { viewport.releasePointerCapture(event.pointerId); } catch (error) {}
            if (pointers.size === 1) {
                const remaining = [...pointers.values()][0];
                gesture = { type: "pan", clientX: remaining.clientX, clientY: remaining.clientY };
            } else if (!pointers.size) {
                gesture = null;
                renderTransform(true);
            }
        };
        viewport.addEventListener("pointerup", finishPointer, { passive: false });
        viewport.addEventListener("pointercancel", finishPointer, { passive: false });
        viewport.addEventListener("lostpointercapture", finishPointer, { passive: false });

        viewport.addEventListener("wheel", event => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            const multiplier = event.deltaY < 0 ? 1.15 : (1 / 1.15);
            setScale(scale * multiplier, { clientX: event.clientX, clientY: event.clientY }, true);
        }, { passive: false });

        viewport.addEventListener("gesturestart", event => {
            event.preventDefault();
            event.stopPropagation();
            platformGestureStartScale = scale;
        }, { passive: false });
        viewport.addEventListener("gesturechange", event => {
            if (platformGestureStartScale === null) return;
            event.preventDefault();
            event.stopPropagation();
            setScale(platformGestureStartScale * (Number(event.scale) || 1), {
                clientX: Number(event.clientX) || (viewport.getBoundingClientRect().left + viewport.clientWidth / 2),
                clientY: Number(event.clientY) || (viewport.getBoundingClientRect().top + viewport.clientHeight / 2),
            }, false);
        }, { passive: false });
        viewport.addEventListener("gestureend", event => {
            if (platformGestureStartScale === null) return;
            event.preventDefault();
            event.stopPropagation();
            platformGestureStartScale = null;
            renderTransform(true);
        }, { passive: false });

        viewport.addEventListener("dblclick", event => {
            event.preventDefault();
            event.stopPropagation();
            if (scale > EXPANDED_ZOOM_MIN) fitView(true);
            else setScale(2, { clientX: event.clientX, clientY: event.clientY }, true);
        });

        overlay.addEventListener("pointerdown", event => event.stopPropagation());
        overlay.addEventListener("touchstart", event => event.stopPropagation(), { passive: true });
        overlay.addEventListener("click", event => event.stopPropagation());
        overlay.addEventListener("keydown", event => {
            const controls = [...overlay.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex='-1'])")];
            if (event.key === "Tab" && controls.length) {
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
                event.stopPropagation();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeExpandedViewer();
                return;
            }
            const zoomIn = event.key === "+" || event.key === "=";
            const zoomOut = event.key === "-" || event.key === "_";
            const fit = event.key === "0" || event.key.toLowerCase() === "f";
            const reset = event.key.toLowerCase() === "r";
            if (zoomIn || zoomOut || fit || reset) {
                event.preventDefault();
                event.stopPropagation();
                if (zoomIn) setScale(scale + EXPANDED_ZOOM_STEP, null, true);
                else if (zoomOut) setScale(scale - EXPANDED_ZOOM_STEP, null, true);
                else fitView(true);
                return;
            }
            const panDelta = event.shiftKey ? 100 : 40;
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                if (scale > EXPANDED_ZOOM_MIN) {
                    if (event.key === "ArrowLeft") translateX += panDelta;
                    if (event.key === "ArrowRight") translateX -= panDelta;
                    if (event.key === "ArrowUp") translateY += panDelta;
                    if (event.key === "ArrowDown") translateY -= panDelta;
                    renderTransform(false);
                }
            }
        });

        const readerShell = trigger.closest(".koba-reader-shell");
        const overlayHost = readerShell || document.body;
        const backgroundElements = readerShell
            ? [...readerShell.children].map(element => ({
                element,
                wasInert: Boolean(element.inert),
                ariaHidden: element.getAttribute("aria-hidden"),
            }))
            : [];
        const state = {
            overlay,
            trigger,
            pageId,
            chapterId: String(chapterId || ""),
            chapterPageIndex: Number(page.chapterPageIndex) || 0,
            readerShell,
            backgroundElements,
            previousBodyOverflow: document.body.style.overflow,
            removeResizeListener: () => window.removeEventListener("resize", handleResize),
            releasePointers: () => {
                [...pointers.keys()].forEach(pointerId => {
                    try { viewport.releasePointerCapture(pointerId); } catch (error) {}
                });
                pointers.clear();
                gesture = null;
                platformGestureStartScale = null;
            },
        };
        function handleResize() { window.requestAnimationFrame(() => renderTransform(false)); }
        expandedViewer = state;
        global.dispatchEvent(new global.CustomEvent("koba:illustrated-page-selected", {
            detail: Object.freeze({
                chapterId: state.chapterId,
                pageId: state.pageId,
                chapterPageIndex: state.chapterPageIndex,
            }),
        }));
        overlayHost.appendChild(overlay);
        document.body.classList.add("koba-illustrated-zoom-open");
        document.body.style.overflow = "hidden";
        backgroundElements.forEach(({ element }) => {
            element.inert = true;
            element.setAttribute("aria-hidden", "true");
        });
        window.addEventListener("resize", handleResize, { passive: true });
        fitView(false);
        closeButton.focus({ preventScroll: true });
        return overlay;
    }

    function createPlate(page, position, chapterId) {
        const frame = document.createElement("figure");
        frame.className = "koba-illustrated-page-plate";
        frame.dataset.pagePosition = String(position);
        const expandButton = document.createElement("button");
        expandButton.type = "button";
        expandButton.className = "koba-illustrated-page-expand";
        expandButton.dataset.pageId = String(page.id || "");
        expandButton.dataset.chapterId = String(chapterId || "");
        expandButton.setAttribute("aria-haspopup", "dialog");
        expandButton.setAttribute("aria-label", `Open ${String(page.alt || `illustrated page ${position}`)} in expanded view`);
        const image = document.createElement("img");
        image.src = String(page.url || "");
        image.alt = String(page.alt || `Illustrated page ${position}`);
        image.width = Number(page.width) || 1;
        image.height = Number(page.height) || 1;
        image.draggable = false;
        image.decoding = "async";
        expandButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            openExpandedViewer(expandButton, image, page, chapterId);
        });
        expandButton.appendChild(image);
        frame.appendChild(expandButton);
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
        presentation.pages.forEach(page => node.appendChild(createPlate(page, page.position, presentation.chapterId)));
        presentation.node = node;
        return node;
    }

    function disposePresentation(presentation) {
        if (!presentation?.node) return;
        const identity = getExpandedViewerIdentity();
        if (identity && presentation.chapterId === identity.chapterId && presentation.pageIds?.includes(identity.pageId)) {
            closeExpandedViewer({ restoreFocus: false });
        }
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
        EXPANDED_ZOOM_MIN,
        EXPANDED_ZOOM_MAX,
        EXPANDED_ZOOM_STEP,
        canPresentSpread,
        orderedGroups,
        buildReaderPages,
        maintainActiveWindow,
        locateProgress,
        closeExpandedViewer,
        getExpandedViewerIdentity,
        focusPageTrigger,
    });
})(window);
