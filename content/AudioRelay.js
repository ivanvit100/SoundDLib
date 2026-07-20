/**
 * SoundDLib content script — ISOLATED world
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    const api = (typeof browser !== 'undefined' && browser) || chrome;

    window.addEventListener('message', (event) => {
        if (!event.data?.__sounddlib) return;
        const { type, ...payload } = event.data;

        if (type === 'AUDIO_CAPTURED') {
            api.runtime.sendMessage({
                action: 'audioIntercepted',
                trackId: `zvuk_${Date.now()}`,
                type: 'audio',
                mimeType: payload.mimeType,
                data: payload.data,
                url: payload.url || null,
                meta: payload.meta || {}
            }).catch(() => {});
        }
    });

    api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === 'fetchKeyFromMainWorld') {
            (async () => {
                try {
                    const init = { credentials: 'include', mode: 'same-origin' };
                    const hdrs = message.extraHeaders || [];
                    if (hdrs.length) {
                        init.headers = {};
                        for (const h of hdrs) init.headers[h.name] = h.value;
                    }
                    const res = await fetch(message.url, init);
                    if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
                    const buf = await res.arrayBuffer();
                    sendResponse({ ok: true, data: Array.from(new Uint8Array(buf)) });
                } catch (e) {
                    sendResponse({ ok: false, error: String(e) });
                }
            })();
            return true;
        }

        if (message.action === 'fetchAudioFromTab') {
            (async () => {
                try {
                    const res = await fetch(message.url, {
                        credentials: 'include',
                        headers: message.headers || {}
                    });
                    if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
                    const buf = await res.arrayBuffer();
                    const mimeType = res.headers.get('content-type') || 'audio/mpeg';
                    sendResponse({ ok: true, data: Array.from(new Uint8Array(buf)), mimeType });
                } catch (e) {
                    sendResponse({ ok: false, error: String(e) });
                }
            })();
            return true;
        }

        if (message.action === 'getPlaybackState') {
            // Primary: read from DOM state bridge written by AudioInterceptor (MAIN world)
            const el = document.getElementById('__sdl_state');
            if (el?.dataset.t != null && parseFloat(el.dataset.d) > 0) {
                sendResponse({ ok: true, state: {
                    currentTime: parseFloat(el.dataset.t),
                    duration:    parseFloat(el.dataset.d),
                    paused:      el.dataset.p === '1'
                }});
            } else {
                // Fallback: audio element in DOM (rare, but possible)
                const media = document.querySelector('video, audio');
                sendResponse({ ok: true, state: media ? {
                    currentTime: media.currentTime,
                    duration:    isFinite(media.duration) ? media.duration : 0,
                    paused:      media.paused
                } : null });
            }
            return false;
        }

        if (message.action === 'playbackControl') {
            const ctrl = message.control;

            if (ctrl === 'seek' && message.position != null) {
                // Write seek request to DOM bridge; AudioInterceptor applies it
                const el = document.getElementById('__sdl_state');
                if (el) el.dataset.seekTo = message.position;
                // Direct fallback for in-DOM elements
                const media = document.querySelector('audio, video');
                if (media) media.currentTime = message.position;
            } else {
                // Click actual zvuk.com player buttons by DOM position
                const findBtns = () => {
                    const real = (el) => Array.from(el.querySelectorAll('button'))
                        .filter(b => !b.dataset.sdlDownload);
                    // Mini-player: [class*="mini__"] → [class*="controls__"] → 3 buttons (prev, play, next)
                    const mini = document.querySelector('[class*="mini__"] [class*="controls__"]');
                    if (mini) {
                        const b = real(mini);
                        if (b.length >= 3) return { prev: b[0], play: b[1], next: b[2] };
                    }
                    // Full player: find controls container with exactly 5 buttons (repeat,prev,play,next,shuffle)
                    for (const c of document.querySelectorAll('[class*="controls__"]')) {
                        const b = real(c);
                        if (b.length === 5) return { prev: b[1], play: b[2], next: b[3] };
                    }
                    return null;
                };
                const btns = findBtns();
                if (ctrl === 'playPause')  btns?.play?.click();
                else if (ctrl === 'prevTrack') btns?.prev?.click();
                else if (ctrl === 'nextTrack') btns?.next?.click();
            }

            sendResponse({ ok: true });
            return false;
        }

        if (message.action === 'getTabMeta') {
            const session = navigator.mediaSession?.metadata;
            const zvukTrackId = document.querySelector('[class*="mini__"] a[href*="/track/"]')
                ?.getAttribute('href')?.match(/\/track\/(\d+)/)?.[1] || null;

            if (session && (session.title || session.artist)) {
                const cover = session.artwork?.[0]?.src || null;
                sendResponse({ ok: true, meta: {
                    title:  session.title  || '',
                    artist: session.artist || '',
                    cover,
                    zvukTrackId
                }});
                return false;
            }

            const title = document.querySelector(
                '[class*="title"]:not([class*="album"]):not([class*="artist"]), ' +
                '[data-testid*="track-title"], h1'
            )?.textContent?.trim() || document.title || '';
            const artist = document.querySelector(
                '[class*="artist"], [data-testid*="artist"]'
            )?.textContent?.trim() || '';
            sendResponse({ ok: true, meta: { title, artist, cover: null, zvukTrackId } });
            return false;
        }

        return false;
    });

    // === Inject download button into zvuk.com mini/full player ===

    function sdlCreateBtn() {
        const btn = document.createElement('button');
        btn.dataset.sdlDownload = 'true';
        btn.title = 'Скачать трек (SoundDLib)';
        btn.style.cssText = [
            'background:none', 'border:none', 'cursor:pointer',
            'padding:6px', 'display:inline-flex', 'align-items:center',
            'justify-content:center', 'transition:opacity 0.15s', 'flex-shrink:0'
        ].join(';');
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"' +
            ' stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
            '<polyline points="7 10 12 15 17 10"/>' +
            '<line x1="12" y1="15" x2="12" y2="3"/></svg>';
        const svg = () => btn.querySelector('svg');
        btn.addEventListener('mouseover', () => { svg()?.setAttribute('stroke', '#fff'); });
        btn.addEventListener('mouseout',  () => { svg()?.setAttribute('stroke', '#bdbdbd'); });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            api.runtime.sendMessage({ action: 'openDownloadWindow' }).catch(() => {});
        });
        return btn;
    }

    function sdlInject() {
        // Desktop mini-player controls
        const mini = document.querySelector('[class*="mini__"] [class*="controls__"]');
        if (mini && !mini.querySelector('[data-sdl-download]'))
            mini.appendChild(sdlCreateBtn());

        // Desktop full player controls (exactly 5 real buttons)
        for (const c of document.querySelectorAll('[class*="controls__"]')) {
            const real = Array.from(c.querySelectorAll('button'))
                .filter(b => !b.dataset.sdlDownload);
            if (real.length === 5 && !c.querySelector('[data-sdl-download]'))
                c.appendChild(sdlCreateBtn());
        }

        // Mobile mini-player controls (insert before last child — the "add to collection" button)
        const mobile = document.querySelector('[class*="MiniPlayerMobile_controls__"]');
        if (mobile && !mobile.querySelector('[data-sdl-download]'))
            mobile.insertBefore(sdlCreateBtn(), mobile.lastElementChild);
    }

    let _sdlTimer = null;
    new MutationObserver(() => {
        clearTimeout(_sdlTimer);
        _sdlTimer = setTimeout(sdlInject, 250);
    }).observe(document.body, { childList: true, subtree: true });
    sdlInject();

    console.log('[SoundDLib] AudioRelay active');
})();
