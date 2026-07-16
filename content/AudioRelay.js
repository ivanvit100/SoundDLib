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

        if (message.action === 'getTabMeta') {
            const title = document.querySelector(
                '[class*="title"]:not([class*="album"]):not([class*="artist"]), ' +
                '[data-testid*="track-title"], h1'
            )?.textContent?.trim() || document.title || '';
            const artist = document.querySelector(
                '[class*="artist"], [data-testid*="artist"]'
            )?.textContent?.trim() || '';
            sendResponse({ ok: true, meta: { title, artist } });
            return false;
        }

        return false;
    });

    console.log('[SoundDLib] AudioRelay active');
})();
