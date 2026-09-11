/**
 * KOBA-I UNIVERSAL PLAYER
 * Version 6.2.0 - Illustrated Pages, Illustrated EPUB, Mobile Lock Screen, Media Session API & Fullscreen
 */

(function() {
    const PLAYER_BUILD = '6.2.0-illustrated-pages';
    const RESUME_VERSION = 1;
    const RESUME_PREFIX = 'koba_bloom_resume_v1';
    const RESUME_THROTTLE_MS = 5000;
    const RESUME_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    const RESUME_MAX_POSITION_SECONDS = 7 * 24 * 60 * 60;
    const EPUB_TAGS = new Set(['A','ABBR','B','BLOCKQUOTE','BR','CITE','CODE','DIV','EM','FIGCAPTION','FIGURE','H1','H2','H3','H4','H5','H6','HR','I','IMG','LI','OL','P','PRE','SECTION','SMALL','SPAN','STRONG','SUB','SUP','UL']);
    const EPUB_IMAGE_TYPE = /\.(?:jpe?g|png|gif|svg)(?:[?#].*)?$/i;

    function safeEpubUrl(value, baseUrl) {
        const source = String(value || '').trim();
        if (!source || /^(?:data|blob|javascript):/i.test(source)) return '';
        try {
            const resolved = new URL(source, baseUrl || window.location.href);
            return /^https?:$/.test(resolved.protocol) && EPUB_IMAGE_TYPE.test(resolved.pathname) ? resolved.href : '';
        } catch (_error) { return ''; }
    }

    function renderEpubChapter(surface, chapter, publication) {
        const source = String(chapter.xhtml || chapter.html || chapter.textContent || chapter.body || chapter.content || '');
        if (!/<[a-z][\s\S]*>/i.test(source)) {
            const paragraphs = source.split('\n').filter(line => line.trim()).map(line => {
                const page = document.createElement('div');
                page.className = 'k-ebook-page';
                const paragraph = document.createElement('p');
                paragraph.textContent = line.trim();
                page.appendChild(paragraph);
                return page;
            });
            surface.replaceChildren(Object.assign(document.createElement('div'), { className: 'k-ebook-content' }));
            surface.firstElementChild.append(...paragraphs);
            return;
        }
        const parsed = new DOMParser().parseFromString(`<div>${source}</div>`, 'text/html');
        const root = parsed.body.firstElementChild;
        root.querySelectorAll('script,style,iframe,object,embed,form,link,meta,svg').forEach(node => node.remove());
        [...root.querySelectorAll('*')].forEach(node => {
            if (!EPUB_TAGS.has(node.tagName)) { node.replaceWith(...node.childNodes); return; }
            [...node.attributes].forEach(attribute => {
                if (attribute.name.toLowerCase().startsWith('on') || !['href','src','alt','title','class','role','aria-label'].includes(attribute.name.toLowerCase())) node.removeAttribute(attribute.name);
            });
            if (node.tagName === 'IMG') {
                const resolved = safeEpubUrl(node.getAttribute('src'), chapter.assetBaseUrl || chapter.contentBaseUrl || publication.epubAssetBaseUrl || publication.assetBaseUrl);
                if (!resolved) { node.replaceWith(Object.assign(parsed.createElement('span'), { className: 'koba-reader-image-unavailable', textContent: `Image unavailable${node.alt ? `: ${node.alt}` : ''}` })); return; }
                node.src = resolved;
                node.alt = node.getAttribute('alt') || 'Illustration';
                node.loading = 'lazy';
                node.addEventListener('error', () => node.replaceWith(Object.assign(document.createElement('span'), { className: 'koba-reader-image-unavailable', textContent: `Image unavailable: ${node.alt}` })), { once: true });
            }
        });
        const content = document.createElement('div');
        content.className = 'k-ebook-content';
        content.append(...root.childNodes);
        surface.replaceChildren(content);
    }

    function resumeScopeValue(value) {
        const normalized = String(value || '').trim();
        return normalized && normalized.length <= 160 ? normalized : '';
    }

    function createResumeController(data, chapterCount, storage, clock = () => Date.now()) {
        const tenantId = resumeScopeValue(
            data.tenantId || data.studioKey ||
            (window.JubileeConfig && window.JubileeConfig.studioKey)
        );
        const assetId = resumeScopeValue(data.assetId || data.assetKey);
        const storageKey = tenantId && assetId
            ? `${RESUME_PREFIX}:${encodeURIComponent(tenantId)}:${encodeURIComponent(assetId)}`
            : '';
        let lastSavedAt = 0;

        function remove() {
            if (!storageKey || !storage) return;
            try { storage.removeItem(storageKey); } catch (_error) {}
        }

        function read() {
            if (!storageKey || !storage || !Number.isInteger(chapterCount) || chapterCount < 1) return null;
            let parsed;
            try {
                parsed = JSON.parse(storage.getItem(storageKey) || 'null');
            } catch (_error) {
                remove();
                return null;
            }
            const now = clock();
            const valid = parsed &&
                parsed.version === RESUME_VERSION &&
                Number.isInteger(parsed.chapterIndex) &&
                parsed.chapterIndex >= 0 &&
                parsed.chapterIndex < chapterCount &&
                Number.isFinite(parsed.position) &&
                parsed.position >= 0 &&
                parsed.position <= RESUME_MAX_POSITION_SECONDS &&
                Number.isFinite(parsed.savedAt) &&
                parsed.savedAt <= now + 5 * 60 * 1000 &&
                now - parsed.savedAt <= RESUME_MAX_AGE_MS;
            if (!valid) {
                remove();
                return null;
            }
            return {
                chapterIndex: parsed.chapterIndex,
                position: parsed.position,
                savedAt: parsed.savedAt,
            };
        }

        function save(chapterIndex, position, options = {}) {
            if (!storageKey || !storage ||
                !Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= chapterCount ||
                !Number.isFinite(position) || position < 0 || position > RESUME_MAX_POSITION_SECONDS) return false;
            const now = clock();
            if (options.force !== true && now - lastSavedAt < RESUME_THROTTLE_MS) return false;
            try {
                storage.setItem(storageKey, JSON.stringify({
                    version: RESUME_VERSION,
                    chapterIndex,
                    position,
                    savedAt: now,
                }));
                lastSavedAt = now;
                return true;
            } catch (_error) {
                return false;
            }
        }

        function positionForDuration(state, duration) {
            if (!state || !Number.isFinite(duration) || duration <= 0 ||
                !Number.isFinite(state.position) || state.position < 0 || state.position >= duration) {
                remove();
                return null;
            }
            return state.position;
        }

        return { storageKey, read, save, clear: remove, positionForDuration };
    }

    window.KobaBloomResume = Object.freeze({ createResumeController });

    function resolvePlayableMediaSource(track, baseHref = window.location.href) {
        const source = String(track && (track.url || track.src || track.mediaUrl || track.audioUrl || track.videoUrl) || '').trim();
        if (!source) return '';
        try {
            const resolved = new URL(source, baseHref);
            if (!['http:', 'https:'].includes(resolved.protocol) || resolved.username || resolved.password) return '';
            return resolved.href;
        } catch (_error) {
            return '';
        }
    }

    window.KobaBloomPublicationIntegrity = Object.freeze({ resolvePlayableMediaSource });
    function initializeExistingPlayers() {
        // 1. INIT MAIN PLAYER
        const mainRoot = document.getElementById('koba-bloom-root');
        if (mainRoot && window.kobaData) {
            initPlayer(mainRoot, window.kobaData, 'full');
        }

        // 2. INIT MINI PLAYERS
        const miniRoots = document.querySelectorAll('.koba-mini-root');
        miniRoots.forEach(root => {
            if(root.dataset.config) {
                const config = JSON.parse(root.dataset.config);
                initPlayer(root, config, 'mini');
            }
        });
    }

    // Public hydration bridge used after the server verifies audiobook access.
    window.initKobaBloomPlayer = function(root, data, mode = 'full') {
        console.info(`[KOBA-I Bloom Player] ${PLAYER_BUILD}`, {
            mode,
            chapters: Array.isArray(data && data.chapters) ? data.chapters.length : 0,
            autoAdvance: !data || data.autoAdvance !== false
        });
        return initPlayer(root, data, mode);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeExistingPlayers);
    } else {
        initializeExistingPlayers();
    }

    function initPlayer(root, data, mode) {
        const chapters = Array.isArray(data.chapters) ? data.chapters : [];
        if (chapters.length === 0) {
            root.innerHTML = `
                <div class="koba-media-processing-state" role="status" aria-live="polite" style="min-height:100%; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; background:#070a0f; color:#fff;">
                    <div style="width:min(100%, 520px); padding:32px; box-sizing:border-box; text-align:center; background:#0d1117; border:1px solid #30363d; border-radius:12px; box-shadow:0 16px 40px rgba(0,0,0,0.45);">
                        <h2 style="margin:0 0 12px; color:#fff; font-size:clamp(1.25rem, 4vw, 1.75rem);">Publication unavailable</h2>
                        <p style="margin:0; color:#c9d1d9; font-size:1rem; line-height:1.6;">This publication does not contain playable chapters yet. Please try again later or contact support.</p>
                    </div>
                </div>
            `;
            return;
        }

        // Add media-type classes for styling controls selectively
        if (data.mediaType === 'E-Book' || data.mediaType === 'Ebook' || data.mediaType === 'ebook' || data.mediaType === 'E-book') {
            root.classList.add('k-media-ebook');
        } else {
            root.classList.add('k-media-audiobook');
        }
        
        // --- CUSTOM ICONS ---
        const icons = {
            play:  `<svg viewBox="0 0 40 40" fill="currentColor"><path d="M13.5 11.855L27.98 20 13.5 28.145z"/></svg>`,
            pause: `<svg viewBox="0 0 40 40" fill="currentColor"><path d="M23.5 11.5H27.5V28.5H23.5z"/><path d="M12.5 11.5H16.5V28.5H12.5z"/></svg>`,
            prev:   `<svg viewBox="0 0 40 40" fill="currentColor"><path d="M12.571 20L24 10 24 30z"/></svg>`,
            next:   `<svg viewBox="0 0 40 40" fill="currentColor"><path d="M27.429 20L16 10 16 30z"/></svg>`,
            rw30:  `<svg viewBox="0 0 40 40" fill="currentColor"><path d="M18.878 20L30.5 11.954 30.5 28.046z"/><path d="M7.878 20L19.5 11.954 19.5 28.046z"/></svg>`,
            ff30:  `<svg viewBox="0 0 40 40" fill="currentColor"><path d="M9.5 11.954L21.122 20 9.5 28.046z"/><path d="M20.5 11.954L32.122 20 20.5 28.046z"/></svg>`,
            menu:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`,
            text:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 17H4v2h10v-2zm6-8H4v2h16V9zM4 15h16v-2H4v2zM4 5v2h16V5H4z"/></svg>`,
            fullscreen:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`,
            exit_full: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`
        };

        // STATE
        const ebookPublication = ['e-book', 'ebook'].includes(String(data.mediaType || '').toLowerCase());
        let resumeStorage = null;
        try { resumeStorage = window.localStorage; } catch (_error) {}
        const resumeController = mode === 'full' && !ebookPublication
            ? createResumeController(data, chapters.length, resumeStorage)
            : null;
        let pendingResumeState = resumeController ? resumeController.read() : null;
        let currentIndex = pendingResumeState ? pendingResumeState.chapterIndex : 0;
        let isPlaying = false;
        let mediaEl = null; 
        let transcriptData = null;
        let chapterLoadSequence = 0;
        let suppressResumeSave = false;

        function resolveBookstoreUrl() {
            const configuredUrl = String(
                data.readerUrl ||
                (window.JubileeConfig && window.JubileeConfig.readerUrl) ||
                '/bookshelf/'
            ).trim();
            try {
                const resolved = new URL(configuredUrl, window.location.origin);
                return resolved.origin === window.location.origin
                    ? resolved.href
                    : new URL('/bookshelf/', window.location.origin).href;
            } catch (_error) {
                return new URL('/bookshelf/', window.location.origin).href;
            }
        }

        function escapeAttribute(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        // --- RENDER HTML ---
        if (mode === 'mini') {
            const activeCoverUrl = data.coverArtUrl || data.coverUrl || (data.theme && data.theme.coverUrl) || '';
            const escapedCoverUrl = activeCoverUrl.replace(/'/g, "\\'");
            root.classList.add('k-mini-container');
            root.innerHTML = `
                <div class="k-mini-shell">
                    <div class="k-mini-cover" style="background-image:url('${escapedCoverUrl}')"></div>
                    <button class="k-mini-play-btn">${icons.play}</button>
                    <div class="k-mini-info">
                        <div class="k-mini-title">${data.title}</div>
                        <div class="k-mini-scrubber"><div class="k-mini-progress"></div></div>
                    </div>
                </div>`;
        } else {
            const activeBgImage = data.bgImage || (data.theme && data.theme.backgroundImage) || '';
            const escapedBgImage = activeBgImage.replace(/'/g, "\\'");
            const activeCoverUrl = data.coverArtUrl || data.coverUrl || (data.theme && data.theme.coverUrl) || '';
            const escapedCoverUrl = activeCoverUrl.replace(/'/g, "\\'");
            const bookstoreUrl = escapeAttribute(resolveBookstoreUrl());
            const hasSharedPublicationNavigation = Boolean(
                document.querySelector('[data-koba-authoritative-back]')
            );
            const bookstoreNavigation = hasSharedPublicationNavigation
                ? ''
                : `<a class="k-bloom-back-to-store" href="${bookstoreUrl}" aria-label="Back to Bookstore">&larr; Back to Bookstore</a>`;
            root.innerHTML = `
                <div class="k-bloom-bg" style="background-image: url('${escapedBgImage}')"></div>
                ${bookstoreNavigation}
                <img src="${data.logoUrl}" class="k-bloom-logo" alt="KOBA-I">
                <div class="k-bloom-interface">
                    <div class="k-bloom-stage">
                        <div id="k-media-container" class="k-media-box" style="display: none;"></div>
                        
                        <!-- 🚀 Video Viewport Container -->
                        <div class="k-video-viewport" style="display: none; width: 100%; height: 100%; max-height: 70vh;"></div>
                        <button class="k-video-presentation-exit" type="button" aria-label="Exit landscape video presentation">&times;</button>

                        <!-- 🚀 Cover Art Stage Container -->
                        <div class="k-cover-art-stage" style="display: none;">
                            <img src="${escapedCoverUrl}" class="k-bloom-cover-img" alt="Cover Art">
                        </div>

                        <!-- 🚀 E-Book / Reader Surface Container -->
                        <div class="k-reader-surface" style="display: none; width: 100%; max-width: 650px;"></div>

                        <!-- 🚀 Transcript Scrollbox Container -->
                        <div class="k-transcript-pane" style="display: none; width: 100%; max-width: 650px; height: 120px; overflow-y: auto; text-align: center; margin-bottom: 20px;"></div>

                        <div class="k-player-safe-error" role="alert" aria-live="polite" hidden style="position:absolute; z-index:8; left:50%; top:50%; transform:translate(-50%,-50%); width:min(88%,520px); box-sizing:border-box; padding:24px; border:1px solid #7f1d1d; border-radius:12px; background:#0d1117; color:#fff; text-align:center; box-shadow:0 16px 40px rgba(0,0,0,.45);"></div>

                        <div class="k-bloom-controls">
                            <div class="k-scrubber" id="k-scrubber"><div class="k-progress" id="k-progress"></div></div>
                            <div class="k-time-row"><span id="k-curr-time">0:00</span><span id="k-dur-time">0:00</span></div>
                            <div class="k-buttons">
                                <div class="k-primary-transport" aria-label="Playback controls">
                                    <button class="k-btn-icon" id="k-rw-btn" title="Rewind 30s">${icons.rw30}</button>
                                    <button class="k-btn-icon" id="k-prev-btn" title="Previous Chapter">${icons.prev}</button>
                                    <button class="k-btn-main" id="k-play-btn" aria-label="Play">${icons.play}</button>
                                    <button class="k-btn-icon" id="k-next-btn" title="Next Chapter">${icons.next}</button>
                                    <button class="k-btn-icon" id="k-ff-btn" title="Forward 30s">${icons.ff30}</button>
                                </div>
                                <div class="k-actions" aria-label="Player tools">
                                    <button class="k-btn-icon" id="k-speed-btn" title="Speed">1x</button>
                                    <button class="k-btn-icon" id="k-mark-btn" title="Chapters">${icons.menu}</button>
                                    <button class="k-btn-icon" id="k-text-btn" title="Read Along" style="opacity:0.3; cursor:default;">${icons.text}</button>
                                    <button class="k-btn-icon" id="k-fullscreen-btn" title="Full Screen">${icons.fullscreen}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="k-bloom-sidebar">
                        <div class="k-tabs">
                            <button class="k-tab active">Chapters</button>
                            <button class="k-tab" style="opacity: 0.4; cursor: not-allowed;">Bookmarks</button>
                        </div>
                        <div class="k-list" id="k-list-container"></div>
                    </div>
                </div>
            `;
        }

        // REFERENCES
        const playBtn = root.querySelector(mode === 'mini' ? '.k-mini-play-btn' : '#k-play-btn');
        const progressBar = root.querySelector(mode === 'mini' ? '.k-mini-progress' : '#k-progress');
        const scrubber = root.querySelector(mode === 'mini' ? '.k-mini-scrubber' : '#k-scrubber');
        const mediaBox = root.querySelector('#k-media-container');
        const listContainer = root.querySelector('#k-list-container');
        const currTimeEl = root.querySelector('#k-curr-time');
        const durTimeEl = root.querySelector('#k-dur-time');
        const fullscreenBtn = root.querySelector('#k-fullscreen-btn');
        const textBtn = root.querySelector('#k-text-btn');
        
        const readerSurface = root.querySelector('.k-reader-surface');
        const coverArtContainer = root.querySelector('.k-cover-art-stage');
        const videoViewport = root.querySelector('.k-video-viewport');
        const transcriptPane = root.querySelector('.k-transcript-pane');
        const playerError = root.querySelector('.k-player-safe-error');
        const videoPresentationExit = root.querySelector('.k-video-presentation-exit');
        const sharedBookstoreNavigation = document.querySelector('[data-koba-authoritative-back]');

        function isVideoTrack(track) {
            if (!track) return false;

            const declaredType = String(
                track.type || track.mediaType || track.media_type ||
                track.mimeType || track.mime_type || track.contentType || ''
            ).toLowerCase();

            if (declaredType === 'video' || declaredType.startsWith('video/')) {
                return true;
            }

            const source = String(
                track.src || track.url || track.mediaUrl || track.videoUrl || ''
            );

            // Signed media URLs carry query parameters after the extension, so
            // endsWith('.mp4') incorrectly classifies them as audio.
            return /\.(mp4|m4v|webm|mov|ogv)(?:$|[?#])/i.test(source);
        }

        function showPlayerError(message) {
            setPlaybackState(false);
            if (!playerError) return;
            playerError.textContent = message;
            playerError.hidden = false;
        }

        function hidePlayerError() {
            if (!playerError) return;
            playerError.hidden = true;
            playerError.textContent = '';
        }

        function persistResume(force = false) {
            if (!resumeController || !mediaEl) return false;
            return resumeController.save(currentIndex, Number(mediaEl.currentTime) || 0, { force });
        }

        // 🚀 UNIVERSAL LAYOUT VISIBILITY GUARD Engine
        function enforcePlayerInterfaceState(data, activeTrack) {
            const rootEl = document.getElementById("koba-bloom-root") || root;
            const rSurface = rootEl.querySelector(".k-reader-surface");
            const cArtContainer = rootEl.querySelector(".k-cover-art-stage");
            const vViewport = rootEl.querySelector(".k-video-viewport");
            const tPane = rootEl.querySelector(".k-transcript-pane");

            // 1. Reset all view states to hidden by default to prevent overlapping artifacts
            if (rSurface) rSurface.style.display = "none";
            if (cArtContainer) cArtContainer.style.display = "none";
            if (vViewport) vViewport.style.display = "none";
            if (tPane) tPane.style.display = "none";
            rootEl.classList.remove("k-mode-reading", "k-mode-video", "k-mode-audio");

            // 2. State 1: Pure E-Book Mode
            if (data.mediaType === "E-Book" || (activeTrack && activeTrack.type === "text")) {
                rootEl.classList.add("k-mode-reading");
                rootEl.dataset.mediaMode = "reader";
                if (rSurface) rSurface.style.display = "block";
                updateResponsivePresentation();
                return; // Terminate execution here to keep audio layout elements dark and locked down
            }

            // 3. State 2: Video Playback Mode
            const publicationIsVideo = String(data.mediaType || '').toLowerCase() === 'video';
            if (publicationIsVideo || isVideoTrack(activeTrack)) {
                rootEl.classList.add("k-mode-video");
                rootEl.dataset.mediaMode = "video";
                if (vViewport) vViewport.style.display = "block";
                updateResponsivePresentation();
                return; // The video node handles its own canvas, hide the cover art image completely
            }

            // 4. State 3: Audio + Read-Along Enabled Mode
            const hasTranscript = data.transcript || (activeTrack && (activeTrack.transcriptUrl || activeTrack.transcript_file_url));
            if (hasTranscript) {
                rootEl.classList.add("k-mode-audio");
                rootEl.dataset.mediaMode = "audio";
                if (cArtContainer) cArtContainer.style.display = "block";
                if (tPane) tPane.style.display = "block"; // Open side-by-side scrolling pane
                updateResponsivePresentation();
                return;
            }

            // 5. State 4: Standard Immersive Audiobook Mode (Default Fallback)
            rootEl.classList.add("k-mode-audio");
            rootEl.dataset.mediaMode = "audio";
            if (cArtContainer) {
                cArtContainer.style.display = "block";
                // Ensure cover art image source is cleanly updated to the active publication background image path
                const coverImg = cArtContainer.querySelector("img");
                if (coverImg) {
                    coverImg.src = data.coverUrl || data.coverArtUrl || (data.theme && data.theme.coverUrl) || "";
                }
            }
            updateResponsivePresentation();
        }

        // Fullscreen Toggle Logic
        if (fullscreenBtn) {
            fullscreenBtn.onclick = () => {
                if (!document.fullscreenElement) {
                    root.requestFullscreen().catch(err => {
                        console.log(`Error attempting to enable full-screen mode: ${err.message}`);
                    });
                } else {
                    document.exitFullscreen();
                }
            };
        }

        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement) {
                if(fullscreenBtn) fullscreenBtn.innerHTML = icons.exit_full;
                root.classList.add('is-fullscreen');
            } else {
                if(fullscreenBtn) fullscreenBtn.innerHTML = icons.fullscreen;
                root.classList.remove('is-fullscreen');
            }
            root.dataset.fullscreen = document.fullscreenElement === root ? 'true' : 'false';
        });
        
        function loadChapter(index, options = {}) {
            if (index < 0 || index >= chapters.length) return;
            if (index !== currentIndex) {
                persistResume(true);
                if (mediaEl) mediaEl.onpause = null;
            }
            currentIndex = index;
            suppressResumeSave = false;
            chapterLoadSequence += 1;
            const activeLoadSequence = chapterLoadSequence;
            const chap = chapters[index];

            // 🚀 Call visibility guard engine
            if (mode === 'full') {
                enforcePlayerInterfaceState(data, chap);
            }

            // State 1: Pure E-Book Mode
            if (data.mediaType === 'E-Book' || chap.type === 'text' || chap.textContent) {
                hidePlayerError();
                if (mediaEl) {
                    mediaEl.pause();
                    mediaEl.removeAttribute('src');
                    mediaEl.load();
                    mediaEl.remove();
                    mediaEl = null;
                }
                if (readerSurface) {
                    renderEpubChapter(readerSurface, chap, data);
                    readerSurface.style.display = 'block'; 
                    readerSurface.scrollLeft = 0; 
                }
                
                renderList(); 
                return; 
            }

            // State 2: Video Playback Mode
            const publicationIsVideo = String(data.mediaType || '').toLowerCase() === 'video';
            const requiredMediaTag = publicationIsVideo || isVideoTrack(chap) ? 'VIDEO' : 'AUDIO';
            const mediaSource = resolvePlayableMediaSource(chap);
            if (!mediaSource) {
                if (mediaEl) {
                    mediaEl.pause();
                    mediaEl.removeAttribute('src');
                    mediaEl.load();
                }
                pendingResumeState = null;
                showPlayerError('This chapter is temporarily unavailable. Please choose another chapter or try again later.');
                if (mode === 'full') renderList();
                return;
            }
            hidePlayerError();

            // Reuse the current media element whenever the next chapter uses the
            // same media type. Replacing an <audio> element at the chapter
            // boundary causes some browsers to treat the next play() call as a
            // brand-new autoplay request instead of continuation of the
            // reader-authorized playback session.
            if (mediaEl && mediaEl.tagName !== requiredMediaTag) {
                mediaEl.pause();
                mediaEl.removeAttribute('src');
                mediaEl.load();
                mediaEl.remove();
                mediaEl = null;
            }

            if (requiredMediaTag === 'VIDEO') {
                if (!mediaEl) {
                    mediaEl = document.createElement('video');
                    mediaEl.className = 'k-video-element';
                    mediaEl.setAttribute('playsinline', 'true');
                    mediaEl.setAttribute('webkit-playsinline', 'true');
                    mediaEl.style.width = "100%";
                    mediaEl.style.height = "100%";
                    mediaEl.style.objectFit = "contain";
                }
                if (videoViewport && mediaEl.parentElement !== videoViewport) {
                    videoViewport.innerHTML = '';
                    videoViewport.appendChild(mediaEl);
                }
            } else {
                // Audiobook Mode (State 3 & 4)
                if (!mediaEl) {
                    mediaEl = document.createElement('audio');
                }
                if (mediaBox && mediaEl.parentElement !== mediaBox) {
                    mediaBox.innerHTML = '';
                    mediaBox.appendChild(mediaEl);
                }
            }

            const chapterMedia = mediaEl;
            const shouldAutoplay = options.autoplay === true;

            chapterMedia.onpause = null;
            chapterMedia.pause();
            chapterMedia.src = mediaSource;
            mediaEl.preload = options.autoplay === true ? 'auto' : 'metadata';
            mediaEl.autoplay = shouldAutoplay;

            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: chap.title,
                    artist: data.title,
                    album: "KOBA-I Audio",
                    artwork: [
                        { src: data.coverArtUrl || data.coverUrl || (data.theme && data.theme.coverUrl) || '', sizes: '512x512', type: 'image/jpeg' }
                    ]
                });

                navigator.mediaSession.setActionHandler('play', () => { togglePlay(); });
                navigator.mediaSession.setActionHandler('pause', () => { togglePlay(); });
                navigator.mediaSession.setActionHandler('previoustrack', () => { loadChapter(currentIndex - 1, { autoplay: true }); });
                navigator.mediaSession.setActionHandler('nexttrack', () => { loadChapter(currentIndex + 1, { autoplay: true }); });
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (mediaEl && details.seekTime) mediaEl.currentTime = details.seekTime;
                });
            }

            // Property handlers replace the previous chapter's handlers rather
            // than accumulating duplicate listeners on the reused element.
            chapterMedia.ontimeupdate = updateProgress;
            chapterMedia.onended = handleMediaEnded;
            chapterMedia.onpause = () => {
                if (chapterMedia === mediaEl && !suppressResumeSave) persistResume(true);
            };
            chapterMedia.onerror = () => {
                if (chapterMedia !== mediaEl) return;
                pendingResumeState = null;
                showPlayerError('This chapter could not be loaded. Please choose another chapter or try again later.');
            };
            chapterMedia.onloadedmetadata = () => {
                if (chapterMedia === mediaEl && durTimeEl) {
                    durTimeEl.innerText = formatTime(chapterMedia.duration);
                }
                if (chapterMedia === mediaEl && options.restore === true && pendingResumeState &&
                    pendingResumeState.chapterIndex === currentIndex) {
                    const restoredPosition = resumeController
                        ? resumeController.positionForDuration(pendingResumeState, chapterMedia.duration)
                        : null;
                    pendingResumeState = null;
                    if (restoredPosition !== null) chapterMedia.currentTime = restoredPosition;
                }
            };
            chapterMedia.oncanplay = () => {
                if (
                    shouldAutoplay &&
                    activeLoadSequence === chapterLoadSequence &&
                    chapterMedia === mediaEl &&
                    chapterMedia.paused
                ) {
                    playMediaElement(chapterMedia, 'chapter transition after canplay');
                }
            };
            chapterMedia.onloadeddata = () => {
                if (
                    shouldAutoplay &&
                    activeLoadSequence === chapterLoadSequence &&
                    chapterMedia === mediaEl &&
                    chapterMedia.paused
                ) {
                    playMediaElement(chapterMedia, 'chapter transition after loadeddata');
                }
            };

            if(playBtn) playBtn.innerHTML = icons.play;
            isPlaying = false;
            
            if(mode === 'full') { renderList(); loadTranscript(chap); }

            chapterMedia.load();
            if (options.restore !== true && resumeController) {
                resumeController.save(currentIndex, 0, { force: true });
            }
            if (shouldAutoplay) {
                // Start synchronously from the ended event to preserve the
                // existing media activation. oncanplay provides a second,
                // source-ready attempt for slower browsers and connections.
                setPlaybackState(true);
                playMediaElement(chapterMedia, 'chapter transition');
                window.setTimeout(() => {
                    if (
                        activeLoadSequence === chapterLoadSequence &&
                        chapterMedia === mediaEl &&
                        chapterMedia.paused
                    ) {
                        playMediaElement(chapterMedia, 'chapter transition retry');
                    }
                }, 250);
            }
        }

        function setPlaybackState(playing) {
            isPlaying = playing;
            root.dataset.playback = playing ? 'playing' : 'paused';
            if (playBtn) playBtn.innerHTML = playing ? icons.pause : icons.play;
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
            }
        }

        function playMediaElement(targetMedia, reason) {
            if (!targetMedia) return;

            const playPromise = targetMedia.play();
            if (!playPromise || typeof playPromise.then !== 'function') {
                if (targetMedia === mediaEl) setPlaybackState(true);
                return;
            }

            playPromise
                .then(() => {
                    if (targetMedia === mediaEl) setPlaybackState(true);
                })
                .catch((error) => {
                    if (targetMedia === mediaEl) setPlaybackState(false);
                    console.warn(`[KOBA-I Bloom Player] ${reason} playback was blocked:`, error);
                });
        }

        function handleMediaEnded() {
            const hasNextChapter = currentIndex < chapters.length - 1;

            if (hasNextChapter) {
                const completedChapter = currentIndex + 1;
                console.info(
                    `[KOBA-I Bloom Player] Chapter ${completedChapter} completed. Advancing to chapter ${completedChapter + 1}.`
                );
                loadChapter(currentIndex + 1, { autoplay: true });
                return;
            }

            setPlaybackState(false);
            if (!hasNextChapter) {
                suppressResumeSave = true;
                if (resumeController) resumeController.clear();
                console.info('[KOBA-I Bloom Player] Final chapter completed.');
            }
        }

        // 🚀 SWIPE GESTURE ENGINE (For Reader Surface)
        let touchStartX = 0;
        let touchEndX = 0;

        if (readerSurface) {
            readerSurface.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
            }, false);

            readerSurface.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                handleSwipe();
            }, false);
        }

        function handleSwipe() {
            const threshold = 50; 
            const pageSlideDistance = readerSurface.clientWidth;
            const diff = touchStartX - touchEndX;

            if (Math.abs(diff) > threshold) {
                // If diff > 0, we swiped left (next), else right (prev)
                const direction = diff > 0 ? 1 : -1;
                const targetScroll = readerSurface.scrollLeft + (direction * pageSlideDistance);
                
                readerSurface.scrollTo({ 
                    left: targetScroll, 
                    behavior: 'smooth' 
                });
            }
        }

        function togglePlay() {
            if (!mediaEl) return;
            if (mediaEl.paused) { 
                playMediaElement(mediaEl, 'requested');
            } else { 
                mediaEl.pause(); 
                setPlaybackState(false);
            }
        }

        function updateProgress() {
            if (!mediaEl) return;
            const pct = (mediaEl.currentTime / mediaEl.duration) * 100;
            if(progressBar) progressBar.style.width = `${pct}%`;
            if(currTimeEl) currTimeEl.innerText = formatTime(mediaEl.currentTime);
            
            if (transcriptData && root.classList.contains('k-mode-audio')) syncText(mediaEl.currentTime);
            persistResume(false);
        }

        function formatTime(s) {
            if (!s || isNaN(s)) return "0:00";
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return `${m}:${sec < 10 ? '0' : ''}${sec}`;
        }

        function renderList() {
            if(!listContainer) return;
            listContainer.innerHTML = '';
            
            // The speaker icon from your mockup
            const speakerIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;

            chapters.forEach((c, i) => {
                const row = document.createElement('div');
                row.className = `k-list-item ${i === currentIndex ? 'active' : ''}`;
                
                // Formatted to match your pristine mockup
                row.innerHTML = `<div class="k-item-info"><span class="k-item-title">${c.title}</span></div> ${i === currentIndex ? speakerIcon : ''}`;
                row.onclick = () => {
                    setChapterMenuOpen(false);
                    loadChapter(i, { autoplay: true });
                };
                listContainer.appendChild(row);
            });
        }

        function loadTranscript(chap) {
            if(!textBtn) return;
            transcriptData = null;
            textBtn.style.opacity = '0.3';
            textBtn.style.cursor = 'default';
            
            const transcriptUrl = chap.transcriptUrl || chap.transcript_file_url;
            if (transcriptUrl && transcriptUrl.includes('.json')) {
                fetch(transcriptUrl)
                    .then(r => r.json())
                    .then(json => {
                        transcriptData = [];
                        if(json.results) {
                            json.results.forEach(res => {
                                if(res.alternatives) res.alternatives[0].words.forEach(w => {
                                    transcriptData.push({ word: w.word, start: parseFloat(w.startOffset.replace('s','')), end: parseFloat(w.endOffset.replace('s','')) });
                                });
                            });
                        }
                        if(transcriptData.length > 0) {
                            textBtn.style.opacity = '1';
                            textBtn.style.cursor = 'pointer';
                            if(transcriptPane) {
                                transcriptPane.innerHTML = '';
                                transcriptData.forEach(t => {
                                    const span = document.createElement('span');
                                    span.className = 'k-word'; span.innerText = t.word + ' ';
                                    span.dataset.start = t.start; span.dataset.end = t.end;
                                    span.onclick = () => { if(mediaEl) { mediaEl.currentTime = t.start; mediaEl.play(); isPlaying = true; playBtn.innerHTML = icons.pause; }};
                                    transcriptPane.appendChild(span);
                                });
                            }
                            // Re-apply visibility engine to display transcript
                            enforcePlayerInterfaceState(data, chap);
                        }
                    })
                    .catch(err => {
                        console.log('Transcript load failed', err);
                        if(transcriptPane) transcriptPane.innerHTML = '<div style="opacity:0.5; padding-top:40px;">Transcript Not Available</div>';
                    });
            } else {
                 if(transcriptPane) transcriptPane.innerHTML = '<div style="opacity:0.5; padding-top:40px;">Transcript Not Available</div>';
            }
        }

        function syncText(time) {
            if(!transcriptPane) return;
            const words = transcriptPane.querySelectorAll('.k-word');
            let activeWord = null;
            words.forEach(w => {
                const start = parseFloat(w.dataset.start);
                const end = parseFloat(w.dataset.end);
                if (time >= start && time <= end) {
                    w.classList.add('active');
                    activeWord = w;
                } else {
                    w.classList.remove('active');
                }
            });
            if(activeWord) {
                activeWord.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"});
            }
        }

        if(playBtn) playBtn.onclick = togglePlay;
        if(scrubber) scrubber.onclick = (e) => {
            if(!mediaEl) return;
            const rect = scrubber.getBoundingClientRect();
            mediaEl.currentTime = ((e.clientX - rect.left) / rect.width) * mediaEl.duration;
        };
        
        // Speed toggle
        const speedBtn = root.querySelector('#k-speed-btn');
        if (speedBtn) {
            speedBtn.onclick = () => {
                if(!mediaEl) return;
                let currentRate = mediaEl.playbackRate;
                if(currentRate === 1) mediaEl.playbackRate = 1.25;
                else if(currentRate === 1.25) mediaEl.playbackRate = 1.5;
                else if(currentRate === 1.5) mediaEl.playbackRate = 2.0;
                else mediaEl.playbackRate = 1.0;
                speedBtn.innerText = mediaEl.playbackRate + 'x';
            };
        }

        // Skip buttons
        const rwBtn = root.querySelector('#k-rw-btn');
        const ffBtn = root.querySelector('#k-ff-btn');
        if (rwBtn) rwBtn.onclick = () => { if(mediaEl) mediaEl.currentTime = Math.max(0, mediaEl.currentTime - 30); };
        if (ffBtn) ffBtn.onclick = () => { if(mediaEl) mediaEl.currentTime = Math.min(mediaEl.duration, mediaEl.currentTime + 30); };

        // Previous / Next Buttons
        const prevBtn = root.querySelector('#k-prev-btn');
        const nextBtn = root.querySelector('#k-next-btn');
        if (prevBtn) prevBtn.onclick = () => { loadChapter(currentIndex - 1, { autoplay: true }); };
        if (nextBtn) nextBtn.onclick = () => { loadChapter(currentIndex + 1, { autoplay: true }); };

        // Read along / Mark buttons
        const markBtn = root.querySelector('#k-mark-btn');
        function compactChapterMenuLayout() {
            return window.matchMedia('(max-width: 1023px), (orientation: landscape) and (max-height: 600px)').matches;
        }
        function setChapterMenuOpen(open) {
            const shouldOpen = Boolean(open && compactChapterMenuLayout());
            root.classList.toggle('k-chapter-menu-open', shouldOpen);
            root.dataset.drawer = shouldOpen ? 'chapters' : 'closed';
            if (markBtn) markBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            if (!shouldOpen) enforcePlayerInterfaceState(data, chapters[currentIndex]);
        }
        if (markBtn) {
            markBtn.setAttribute('aria-controls', 'k-list-container');
            markBtn.setAttribute('aria-expanded', 'false');
            markBtn.onclick = () => {
                if (!compactChapterMenuLayout()) return;
                setChapterMenuOpen(!root.classList.contains('k-chapter-menu-open'));
            };
        }

        let landscapePresentationDismissed = false;
        let wasShortLandscape = false;
        let responsiveLayoutTimer = null;

        function isShortLandscapeViewport() {
            return window.matchMedia('(orientation: landscape) and (max-height: 600px) and (pointer: coarse)').matches;
        }

        function updateResponsivePresentation() {
            const shortLandscape = isShortLandscapeViewport();
            if (shortLandscape && !wasShortLandscape) landscapePresentationDismissed = false;
            if (!shortLandscape) landscapePresentationDismissed = false;
            wasShortLandscape = shortLandscape;

            root.dataset.orientation = shortLandscape || window.innerWidth > window.innerHeight
                ? 'landscape'
                : 'portrait';

            const videoPresentation = mode === 'full' &&
                root.dataset.mediaMode === 'video' &&
                shortLandscape &&
                !landscapePresentationDismissed;

            root.classList.toggle('k-video-presentation', videoPresentation);
            if (sharedBookstoreNavigation) {
                sharedBookstoreNavigation.classList.toggle('k-hidden-for-video-presentation', videoPresentation);
            }
            if (videoPresentationExit) {
                videoPresentationExit.hidden = !videoPresentation;
                videoPresentationExit.setAttribute('aria-hidden', videoPresentation ? 'false' : 'true');
            }
        }

        function stabilizeResponsiveLayout() {
            window.clearTimeout(responsiveLayoutTimer);
            responsiveLayoutTimer = window.setTimeout(() => {
                setChapterMenuOpen(false);
                updateResponsivePresentation();
            }, 120);
        }

        if (videoPresentationExit) {
            videoPresentationExit.hidden = true;
            videoPresentationExit.onclick = () => {
                landscapePresentationDismissed = true;
                root.classList.remove('k-video-presentation');
                if (sharedBookstoreNavigation) sharedBookstoreNavigation.classList.remove('k-hidden-for-video-presentation');
                videoPresentationExit.hidden = true;
            };
        }

        root.dataset.drawer = 'closed';
        root.dataset.fullscreen = 'false';
        root.dataset.playback = 'paused';
        window.addEventListener('orientationchange', () => {
            setChapterMenuOpen(false);
            stabilizeResponsiveLayout();
        });
        window.addEventListener('resize', stabilizeResponsiveLayout, { passive: true });
        window.addEventListener('pagehide', () => persistResume(true));
        window.addEventListener('beforeunload', () => persistResume(true));
        if (textBtn) textBtn.onclick = () => {
            if (transcriptData && transcriptData.length > 0) {
                if (coverArtContainer) coverArtContainer.style.display = 'block';
                if (transcriptPane) transcriptPane.style.display = 'block';
            }
        };

        loadChapter(currentIndex, { restore: Boolean(pendingResumeState), autoplay: false });
    }

    // 🚀 FIXED: Properly closed applyBloomTheme function and main DOMContentLoaded wrapper
    function applyBloomTheme(bgHex, panelHex, textHex, accentHex) {
        const root = document.getElementById('bloom-player-root');
        if (root) {
            root.style.background = bgHex;
            root.style.color = textHex;
        }
        
        const sticky = document.getElementById('bloom-sticky-footer');
        if (sticky) {
            sticky.style.background = panelHex;
            sticky.style.borderColor = bgHex === '#f8fafc' ? '#e2e8f0' : '#30363d';
        }
        
        const headers = document.querySelectorAll('#bloom-player-root h1, #bloom-player-root h4');
        headers.forEach(h => {
            h.style.color = bgHex === '#f8fafc' ? '#0f172a' : '#ffffff';
        });

        const playBtn = document.getElementById('bloom-master-play');
        const scrubBar = document.getElementById('bloom-scrub-bar');
        if (playBtn) {
            playBtn.style.background = accentHex;
            playBtn.style.color = bgHex === '#f8fafc' ? '#ffffff' : '#000000';
            playBtn.style.boxShadow = `0 4px 12px ${accentHex}40`;
        }
        if (scrubBar) {
            scrubBar.style.accentColor = accentHex;
        }
    } // This closes applyBloomTheme()
})(); // This closes KOBA player runtime
