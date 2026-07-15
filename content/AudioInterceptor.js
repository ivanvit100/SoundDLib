/**
 * SoundDLib content script — MAIN world
 *
 * Minimal fallback interceptor for services that deliver audio via data: URLs
 * or other mechanisms not visible to the background's webRequest listener.
 *
 * HLS master playlist detection (the primary Zvuk.com mechanism) is handled
 * exclusively in the background via webRequest.onCompleted in RequestInterceptor.
 *
 * Chrome MV3 + Firefox MV3 (128+): loaded via manifest "world": "MAIN".
 * Communicates with AudioRelay.js (isolated world) via window.postMessage.
 *
 * @author ivanvit
 * @version 0.0.1
 */

(function() {
    if (window.__sounddlib_interceptor) return;
    window.__sounddlib_interceptor = true;

    function post(type, payload) {
        window.postMessage({ __sounddlib: true, type, ...payload }, '*');
    }

    function extractMeta() {
        const title = document.querySelector(
            '[class*="title"]:not([class*="album"]):not([class*="artist"]), ' +
            '[data-testid*="track-title"], h1'
        )?.textContent?.trim() || document.title || '';
        const artist = document.querySelector(
            '[class*="artist"], [data-testid*="artist"]'
        )?.textContent?.trim() || '';
        return { title, artist };
    }

    const _srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (_srcDesc?.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            configurable: true,
            get() { return _srcDesc.get.call(this); },
            set(value) {
                if (typeof value === 'string' && value.startsWith('data:audio')) {
                    const comma = value.indexOf(',');
                    if (comma !== -1) {
                        const mimeType = value.slice(5, comma).split(';')[0];
                        const binary = atob(value.slice(comma + 1));
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                        post('AUDIO_CAPTURED', {
                            url: null, mimeType,
                            data: Array.from(bytes),
                            meta: extractMeta()
                        });
                    }
                }
                _srcDesc.set.call(this, value);
            }
        });
    }

    console.log('[SoundDLib] AudioInterceptor active');
})();
