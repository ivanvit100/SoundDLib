/**
 * SoundDLib services module
 * Intercepts zvuk.com web page to capture track metadata, stream URLs and decryption keys
 * @module services/zvuk/ZvukInterceptor
 * @author ivanvit
 * @version 0.0.1
 */

(function(global) {
    class ZvukInterceptor extends global.BaseInterceptor {
        install() {
            if (window.__sounddlib_interceptor) return;
            window.__sounddlib_interceptor = true;
            this._hookMediaElement();
            this._hookStateBridge();
            this._hookKeyCapture();
            this._hookWorkerSpy();
            console.log('[SoundDLib] ZvukInterceptor active');
        }

        _hookMediaElement() {
            const _post = (t, p) => this._post(t, p);

            function extractMeta() {
                return {
                    title: document.querySelector(
                        '[class*="title"]:not([class*="album"]):not([class*="artist"]),' +
                        '[data-testid*="track-title"],h1'
                    )?.textContent?.trim() || document.title || '',
                    artist: document.querySelector(
                        '[class*="artist"],[data-testid*="artist"]'
                    )?.textContent?.trim() || ''
                };
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
                                const [mimeType] = value.slice(5, comma).split(';');
                                const binary = atob(value.slice(comma + 1));
                                const bytes = new Uint8Array(binary.length);
                                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                                _post('AUDIO_CAPTURED', {
                                    url: null, mimeType, data: Array.from(bytes), meta: extractMeta()
                                });
                            }
                        }
                        _srcDesc.set.call(this, value);
                    }
                });
            }
            const _origPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function() {
                window.__sounddlib_media_el = this;
                return _origPlay.call(this);
            };
            if (!window.__sounddlib_media_el)
                window.__sounddlib_media_el = document.querySelector('video, audio');
        }

        _hookStateBridge() {
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
                const seekTo = parseFloat(el.dataset.seekTo);
                if (!isNaN(seekTo)) { media.currentTime = seekTo; delete el.dataset.seekTo; }
            }, 500);
        }

        _hookKeyCapture() {
            window.__sounddlib_key_spy = true;
            window.__sounddlib_key_store = {};
            window.__sounddlib_raw_key_store = {};
            window.__sounddlib_pending_tid = null;

            const _post = (t, p) => this._post(t, p);
            const _fetch = window.fetch;
            window.fetch = async function(...args) {
                const res = await _fetch.apply(this, args);
                try {
                    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
                    if (url.includes('/keyserver/api/v1/key')) {
                        const tid = new URL(url).searchParams.get('track_id');
                        if (tid) {
                            window.__sounddlib_pending_tid = tid;
                            const init = args[1] || {};
                            let h = {};
                            if (init.headers instanceof Headers)
                                h = Object.fromEntries(init.headers.entries());
                            else if (typeof init.headers === 'object' && init.headers)
                                h = init.headers;
                            const xek = h['x-encrypted-key'] || h['X-Encrypted-Key'] || '';
                            if (xek) {
                                window.__sounddlib_xek_store = window.__sounddlib_xek_store || {};
                                window.__sounddlib_xek_store[tid] = xek;
                                window.__sounddlib_latest_xek = xek;
                            }
                        }
                    }

                    if (/zvuk\.com\/(?:api|gateway|track)/.test(url) && !url.includes('cdn-hls-slicer')) {
                        res.clone().text().then(text => {
                            if (!text.includes('cdn-hls-slicer.zvuk.com/drm/track/')) return;
                            try {
                                const found = [];
                                const scan = (v) => {
                                    if (typeof v === 'string' &&
                                        v.includes('cdn-hls-slicer.zvuk.com/drm/track/'))
                                        found.push(v);
                                    else if (v && typeof v === 'object')
                                        Object.values(v).forEach(scan);
                                };
                                scan(JSON.parse(text));
                                for (const streamUrl of found) {
                                    const m = streamUrl.match(/\/track\/([^/?#]+)/);
                                    if (m) _post('STREAM_URL_CAPTURED', { cdnTrackId: m[1], streamUrl, apiUrl: url });
                                }
                            } catch {}
                        }).catch(() => {});
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
                            {window.__sounddlib_raw_key_store[tid] =
                                Array.from(new Uint8Array(result.slice(0)));}
                    }
                } catch {}
                return result;
            };

            const _importKey = crypto.subtle.importKey.bind(crypto.subtle);
            crypto.subtle.importKey = async function(format, keyData, algorithm, extractable, usages) {
                const result = await _importKey(format, keyData, algorithm, extractable, usages);
                try {
                    if (format === 'raw' && (algorithm?.name ?? algorithm) === 'AES-CBC') {
                        let src = null;
                        if (keyData instanceof ArrayBuffer)
                            src = keyData;
                        else if (ArrayBuffer.isView(keyData))
                            {src = keyData.buffer.slice(
                                keyData.byteOffset, keyData.byteOffset + keyData.byteLength
                            );}

                        if (src && src.byteLength === 16 && window.__sounddlib_pending_tid)
                            {window.__sounddlib_key_store[window.__sounddlib_pending_tid] =
                                Array.from(new Uint8Array(src));}
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
                                        {window.__sounddlib_raw_key_store[tid] =
                                            Array.from(new Uint8Array(this.response));}
                                } catch {}
                            });
                        }
                    } catch {}
                }
                return _xhrSend.call(this, body);
            };
        }

        _hookWorkerSpy() {
            const _workerSpy =
                '(function(){try{' +
                'var _pm=self.postMessage.bind(self);' +
                'var _ik=self.crypto.subtle.importKey.bind(self.crypto.subtle);' +
                'self.crypto.subtle.importKey=async function(fmt,kd,alg,ext,usg){' +
                'var r=await _ik(fmt,kd,alg,ext,usg);' +
                'try{var n=typeof alg==="string"?alg:(alg&&alg.name);' +
                'if(fmt==="raw"&&n==="AES-CBC"){' +
                'var ab=kd instanceof ArrayBuffer?kd:' +
                '(ArrayBuffer.isView(kd)?kd.buffer.slice(kd.byteOffset,kd.byteOffset+kd.byteLength):null);' +
                'if(ab&&ab.byteLength===16)_pm({__sounddlib_wk:Array.from(new Uint8Array(ab))});' +
                '}}catch(e){}return r;};' +
                '}catch(e){}})();\n';

            const _Blob = window.Blob;
            window.Blob = function(parts, options) {
                if (Array.isArray(parts) && typeof parts[0] === 'string' && parts[0].length > 200) {
                    const t = options?.type ?? '';
                    if (!t || t.includes('javascript') || t.includes('ecmascript')) {
                        const newParts = [_workerSpy, ...parts];
                        return new _Blob(newParts, options);
                    }
                }
                return new _Blob(parts, options);
            };

            const _Worker = window.Worker;
            window.Worker = function(url, options) {
                const w = new _Worker(url, options);
                w.addEventListener('message', e => {
                    try { if (e.data?.__sounddlib_wk && window.__sounddlib_pending_tid)
                        window.__sounddlib_key_store[window.__sounddlib_pending_tid] = e.data.__sounddlib_wk; } catch {}
                });
                return w;
            };
        }
    }

    global.ZvukInterceptor = ZvukInterceptor;
    new ZvukInterceptor().install();
})(typeof window !== 'undefined' ? window : self);
