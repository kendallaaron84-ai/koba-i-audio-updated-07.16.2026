/**
 * KOBA-I UNIVERSAL PLAYER
 * Version 6.0 - Mobile Lock Screen, Media Session API & Fullscreen
 */

document.addEventListener('DOMContentLoaded', function() {
    
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

    function initPlayer(root, data, mode) {
        const chapters = data.chapters || [];
        if(chapters.length === 0) return;

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
        let currentIndex = 0;
        let isPlaying = false;
        let mediaEl = null; 
        let transcriptData = null;

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
            root.innerHTML = `
                <div class="k-bloom-bg" style="background-image: url('${escapedBgImage}')"></div>
                <img src="${data.logoUrl}" class="k-bloom-logo" alt="KOBA-I">
                <div class="k-bloom-interface">
                    <div class="k-bloom-stage">
                        <div id="k-media-container" class="k-media-box" style="display: none;"></div>
                        
                        <!-- 🚀 Video Viewport Container -->
                        <div class="k-video-viewport" style="display: none; width: 100%; height: 100%; max-height: 70vh;"></div>

                        <!-- 🚀 Cover Art Stage Container -->
                        <div class="k-cover-art-stage" style="display: none;">
                            <img src="${escapedCoverUrl}" class="k-bloom-cover-img" alt="Cover Art" style="width: 260px; height: 260px; object-fit: cover; border-radius: 8px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 35px;">
                        </div>

                        <!-- 🚀 E-Book / Reader Surface Container -->
                        <div class="k-reader-surface" style="display: none; width: 100%; max-width: 650px;"></div>

                        <!-- 🚀 Transcript Scrollbox Container -->
                        <div class="k-transcript-pane" style="display: none; width: 100%; max-width: 650px; height: 120px; overflow-y: auto; text-align: center; margin-bottom: 20px;"></div>

                        <div class="k-bloom-controls">
                            <div class="k-scrubber" id="k-scrubber"><div class="k-progress" id="k-progress"></div></div>
                            <div class="k-time-row"><span id="k-curr-time">0:00</span><span id="k-dur-time">0:00</span></div>
                            <div class="k-buttons">
                                <button class="k-btn-icon" id="k-speed-btn" title="Speed">1x</button>
                                <button class="k-btn-icon" id="k-rw-btn" title="Rewind 30s">${icons.rw30}</button>
                                <button class="k-btn-icon" id="k-prev-btn" title="Previous Chapter">${icons.prev}</button>
                                <button class="k-btn-main" id="k-play-btn">${icons.play}</button>
                                <button class="k-btn-icon" id="k-next-btn" title="Next Chapter">${icons.next}</button>
                                <button class="k-btn-icon" id="k-ff-btn" title="Forward 30s">${icons.ff30}</button>
                                <div class="k-actions">
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
                if (rSurface) rSurface.style.display = "block";
                return; // Terminate execution here to keep audio layout elements dark and locked down
            }

            // 3. State 2: Video Playback Mode
            const activeSrc = activeTrack ? (activeTrack.src || activeTrack.url || "") : "";
            const isVideoFile = activeTrack && (activeTrack.type === "video" || activeSrc.endsWith(".mp4"));
            if (data.mediaType === "Video" || isVideoFile) {
                rootEl.classList.add("k-mode-video");
                if (vViewport) vViewport.style.display = "block";
                return; // The video node handles its own canvas, hide the cover art image completely
            }

            // 4. State 3: Audio + Read-Along Enabled Mode
            const hasTranscript = data.transcript || (activeTrack && (activeTrack.transcriptUrl || activeTrack.transcript_file_url));
            if (hasTranscript) {
                rootEl.classList.add("k-mode-audio");
                if (cArtContainer) cArtContainer.style.display = "block";
                if (tPane) tPane.style.display = "block"; // Open side-by-side scrolling pane
                return;
            }

            // 5. State 4: Standard Immersive Audiobook Mode (Default Fallback)
            rootEl.classList.add("k-mode-audio");
            if (cArtContainer) {
                cArtContainer.style.display = "block";
                // Ensure cover art image source is cleanly updated to the active publication background image path
                const coverImg = cArtContainer.querySelector("img");
                if (coverImg) {
                    coverImg.src = data.coverUrl || data.coverArtUrl || (data.theme && data.theme.coverUrl) || "";
                }
            }
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
        });
        
        function loadChapter(index) {
            if (index < 0 || index >= chapters.length) return;
            currentIndex = index;
            const chap = chapters[index];

            // 🚀 Call visibility guard engine
            if (mode === 'full') {
                enforcePlayerInterfaceState(data, chap);
            }

            // Clean up old media element and pause playback
            if (mediaEl) { 
                mediaEl.pause(); 
                mediaEl.removeAttribute('src'); 
                mediaEl = null; 
            }

            // State 1: Pure E-Book Mode
            if (data.mediaType === 'E-Book' || chap.type === 'text' || chap.textContent) {
                if (readerSurface) {
                    const rawText = chap.textContent || `<p style="opacity:0.5; padding-top:120px; text-align:center;">Parsing chapter data...</p>`;
                    
                    // Wraps each paragraph in .k-ebook-page for the CSS snap engine
                    const formattedText = rawText
                        .split('\n')
                        .map(line => {
                            const trimmed = line.trim();
                            if (trimmed === '') return '';
                            const style = line.startsWith(' ') ? 'padding-left: 1.5em;' : '';
                            return `<div class="k-ebook-page"><p style="${style}">${trimmed}</p></div>`;
                        })
                        .join('');

                    // Inject the content and force block display
                    readerSurface.innerHTML = `<div class="k-ebook-content">${formattedText}</div>`;
                    readerSurface.style.display = 'block'; 
                    readerSurface.scrollLeft = 0; 
                }
                
                renderList(); 
                return; 
            }

            // State 2: Video Playback Mode
            const activeSrc = chap ? (chap.src || chap.url || "") : "";
            const isVideoFile = chap && (chap.type === 'video' || activeSrc.endsWith(".mp4"));
            if (data.mediaType === 'Video' || isVideoFile) {
                if (videoViewport) {
                    videoViewport.innerHTML = '';
                    mediaEl = document.createElement('video');
                    mediaEl.className = 'k-video-element';
                    mediaEl.setAttribute('playsinline', 'true');
                    mediaEl.setAttribute('webkit-playsinline', 'true'); 
                    mediaEl.style.width = "100%";
                    mediaEl.style.height = "100%";
                    mediaEl.style.objectFit = "contain"; 
                    videoViewport.appendChild(mediaEl);
                }
            } else {
                // Audiobook Mode (State 3 & 4)
                mediaEl = document.createElement('audio');
                if (mediaBox) {
                    mediaBox.innerHTML = '';
                    mediaBox.appendChild(mediaEl);
                }
            }
            
            mediaEl.src = chap.url || chap.src;
            mediaEl.preload = 'metadata';

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
                navigator.mediaSession.setActionHandler('previoustrack', () => { loadChapter(currentIndex - 1); setTimeout(togglePlay, 500); });
                navigator.mediaSession.setActionHandler('nexttrack', () => { loadChapter(currentIndex + 1); setTimeout(togglePlay, 500); });
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (mediaEl && details.seekTime) mediaEl.currentTime = details.seekTime;
                });
            }

            mediaEl.addEventListener('timeupdate', updateProgress);
            mediaEl.addEventListener('ended', () => { if(mode === 'full') loadChapter(currentIndex + 1); });
            mediaEl.addEventListener('loadedmetadata', () => { if(durTimeEl) durTimeEl.innerText = formatTime(mediaEl.duration); });

            if(playBtn) playBtn.innerHTML = icons.play;
            isPlaying = false;
            
            if(mode === 'full') { renderList(); loadTranscript(chap); }
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
                mediaEl.play()
                    .then(() => {
                        playBtn.innerHTML = icons.pause; 
                        isPlaying = true;
                        if('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
                    })
                    .catch(e => console.log("Play interrupted:", e));
            } else { 
                mediaEl.pause(); 
                playBtn.innerHTML = icons.play; 
                isPlaying = false;
                if('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
            }
        }

        function updateProgress() {
            if (!mediaEl) return;
            const pct = (mediaEl.currentTime / mediaEl.duration) * 100;
            if(progressBar) progressBar.style.width = `${pct}%`;
            if(currTimeEl) currTimeEl.innerText = formatTime(mediaEl.currentTime);
            
            if (transcriptData && root.classList.contains('k-mode-audio')) syncText(mediaEl.currentTime);
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
                row.onclick = () => { loadChapter(i); setTimeout(togglePlay, 500); };
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
        if (prevBtn) prevBtn.onclick = () => { loadChapter(currentIndex - 1); setTimeout(togglePlay, 500); };
        if (nextBtn) nextBtn.onclick = () => { loadChapter(currentIndex + 1); setTimeout(togglePlay, 500); };

        // Read along / Mark buttons
        const markBtn = root.querySelector('#k-mark-btn');
        if (markBtn) markBtn.onclick = () => {
            // Return to standard mode (cover art stage)
            if (coverArtContainer) coverArtContainer.style.display = 'block';
            if (transcriptPane) transcriptPane.style.display = 'none';
        };
        if (textBtn) textBtn.onclick = () => {
            if (transcriptData && transcriptData.length > 0) {
                if (coverArtContainer) coverArtContainer.style.display = 'block';
                if (transcriptPane) transcriptPane.style.display = 'block';
            }
        };

        loadChapter(0);
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
}); // This closes DOMContentLoaded
