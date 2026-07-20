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
                window.__sounddlib_media_el = this;
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

    // Also capture via play() — handles detached elements (new Audio() not in DOM)
    const _origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
        window.__sounddlib_media_el = this;
        return _origPlay.call(this);
    };

    // Seed from DOM in case element already exists (page reuse)
    if (!window.__sounddlib_media_el)
        window.__sounddlib_media_el = document.querySelector('video, audio');

    // State DOM bridge: write playback state every 500ms for ISOLATED world to read
    setInterval(() => {
        const media = window.__sounddlib_media_el;
        if (!media || !document.body) return;
        let el = document.getElementById('__sdl_state');
        if (!el) {
            el = document.createElement('div');
            el.id = '__sdl_state';
            el.style.cssText = 'display:none;position:absolute;pointer-events:none;';
            document.body.appendChild(el);
        }
        el.dataset.t = media.currentTime;
        el.dataset.d = isFinite(media.duration) ? media.duration : 0;
        el.dataset.p = media.paused ? '1' : '0';
        // Handle seek requests written by ISOLATED world
        const seekTo = parseFloat(el.dataset.seekTo);
        if (!isNaN(seekTo)) {
            media.currentTime = seekTo;
            delete el.dataset.seekTo;
        }
    }, 500);

    window.__sounddlib_key_spy = true;
    window.__sounddlib_key_store = {};
    window.__sounddlib_raw_key_store = {};
    window.__sounddlib_pending_tid = null;

    const _fetch = window.fetch;
    window.fetch = async function(...args) {
        const res = await _fetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
            if (url.includes('/keyserver/api/v1/key')) {
                const tid = new URL(url).searchParams.get('track_id');
                if (tid) window.__sounddlib_pending_tid = tid;
            }
        } catch {}
        return res;
    };

    const _arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function() {
        const result = await _arrayBuffer.call(this);
        try {
            if (this.url?.includes('/keyserver/api/v1/key')) {
                const tid = new URL(this.url).searchParams.get('track_id');
                if (tid)
                    window.__sounddlib_raw_key_store[tid] = Array.from(new Uint8Array(result.slice(0)));
            }
        } catch {}
        return result;
    };

    const _importKey = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = async function(format, keyData, algorithm, extractable, usages) {
        const result = await _importKey(format, keyData, algorithm, extractable, usages);
        try {
            if (format === 'raw' && (algorithm?.name ?? algorithm) === 'AES-CBC') {
                const src = keyData instanceof ArrayBuffer
                    ? keyData
                    : ArrayBuffer.isView(keyData)
                        ? keyData.buffer.slice(keyData.byteOffset, keyData.byteOffset + keyData.byteLength)
                        : null;
                if (src && src.byteLength === 16 && window.__sounddlib_pending_tid)
                    window.__sounddlib_key_store[window.__sounddlib_pending_tid] = Array.from(new Uint8Array(src));
            }
        } catch {}
        return result;
    };

    const _xhrOpen = XMLHttpRequest.prototype.open;
    const _xhrUrls = new WeakMap();
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        _xhrUrls.set(this, String(url));
        return _xhrOpen.call(this, method, url, ...rest);
    };
    const _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        const xhrUrl = _xhrUrls.get(this) || '';
        if (xhrUrl.includes('/keyserver/api/v1/key')) {
            try {
                const tid = new URL(xhrUrl, location.origin).searchParams.get('track_id');
                if (tid) {
                    window.__sounddlib_pending_tid = tid;
                    this.addEventListener('loadend', () => {
                        try {
                            if (this.status === 200 && this.response instanceof ArrayBuffer)
                                window.__sounddlib_raw_key_store[tid] = Array.from(new Uint8Array(this.response));
                        } catch {}
                    });
                }
            } catch {}
        }
        return _xhrSend.call(this, body);
    };

    const _workerSpy = '(function(){try{' +
        'var _pm=self.postMessage.bind(self);' +
        'var _ik=self.crypto.subtle.importKey.bind(self.crypto.subtle);' +
        'self.crypto.subtle.importKey=async function(fmt,kd,alg,ext,usg){' +
            'var r=await _ik(fmt,kd,alg,ext,usg);' +
            'try{' +
                'var n=typeof alg==="string"?alg:(alg&&alg.name);' +
                'if(fmt==="raw"&&n==="AES-CBC"){' +
                    'var ab=kd instanceof ArrayBuffer?kd:' +
                        '(ArrayBuffer.isView(kd)?kd.buffer.slice(kd.byteOffset,kd.byteOffset+kd.byteLength):null);' +
                    'if(ab&&ab.byteLength===16)_pm({__sounddlib_wk:Array.from(new Uint8Array(ab))});' +
                '}' +
            '}catch(e){}' +
            'return r;' +
        '};' +
    '}catch(e){}})();\n';

    const _Blob = window.Blob;
    window.Blob = function(parts, options) {
        if (Array.isArray(parts) && typeof parts[0] === 'string' && parts[0].length > 200) {
            const t = options?.type ?? '';
            if (!t || t.includes('javascript') || t.includes('ecmascript'))
                parts = [_workerSpy, ...parts];
        }
        return new _Blob(parts, options);
    };

    const _Worker = window.Worker;
    window.Worker = function(url, options) {
        const w = new _Worker(url, options);
        w.addEventListener('message', e => {
            try {
                if (e.data?.__sounddlib_wk && window.__sounddlib_pending_tid)
                    window.__sounddlib_key_store[window.__sounddlib_pending_tid] = e.data.__sounddlib_wk;
            } catch {}
        });
        return w;
    };

    console.log('[SoundDLib] AudioInterceptor active');
})();
