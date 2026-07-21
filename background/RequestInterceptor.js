/**
 * SoundDLib background module
 * Intercepts network requests for zvuk.com: rate limiting and auth token capture
 * @module background/RequestInterceptor
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    console.log('[RequestInterceptor] Loading...');

    const browserAPI = typeof globalThis.getExtensionApi === 'function'
        ? globalThis.getExtensionApi()
        : (globalThis.browser || globalThis.chrome || null);
    const browserEnv = typeof globalThis.getBrowserEnv === 'function'
        ? globalThis.getBrowserEnv()
        : {
            isFirefox: !!globalThis.browser,
            isChromium: !!globalThis.chrome,
            supportsDnr: !!globalThis.chrome?.declarativeNetRequest
        };
    const isFirefox = !!browserEnv.isFirefox;
    const isChrome = !!browserEnv.isChromium || !!browserEnv.supportsDnr;

    if (!globalThis.authTokenStore) globalThis.authTokenStore = {};
    const authTokens = globalThis.authTokenStore;

    const rateLimiter = globalThis.globalRateLimiter
        ?? new globalThis.RateLimiter({ maxRequestsPerMinute: 80 });

    const ZVUK_URLS = [
        'https://zvuk.com/*',
        'https://*.zvuk.com/*'
    ];

    function isFromExtension(details) {
        if (details.tabId === -1 && !details.documentUrl && !details.originUrl) return true;
        const schemes = ['moz-extension://', 'chrome-extension://'];
        const candidates = [details.originUrl, details.documentUrl, details.initiator].filter(Boolean);
        if (candidates.some(u => schemes.some(s => u.startsWith(s)))) return true;
        return details.requestHeaders?.some(h =>
            h.name.toLowerCase() === 'x-extension-request' && h.value === 'true'
        ) ?? false;
    }

    function captureAuthToken(details) {
        const auth = details.requestHeaders?.find(h => h.name.toLowerCase() === 'authorization');
        if (auth?.value?.startsWith('Bearer ')) {
            const token = auth.value.slice(7);
            if (authTokens.zvuk !== token) {
                authTokens.zvuk = token;
                console.log('[RequestInterceptor] Captured zvuk auth token');
            }
        }
    }

    function setupServiceCapture() {
        if (!browserAPI?.webRequest?.onCompleted) return;

        const registry = globalThis.serviceRegistry;
        if (!registry) return;

        const allPatterns = registry
            .getAllServices()
            .flatMap(s => s.constructor.capturePatterns || []);

        if (!allPatterns.length) return;

        browserAPI.webRequest.onCompleted.addListener(
            async (details) => {
                if (details.statusCode !== 200) return;

                const store = globalThis.audioStore;
                if (!store || store.hasUrl(details.url)) return;

                const service = registry.getServiceByUrl(details.url);
                if (!service?.constructor?.captureFromUrl) return;

                try {
                    const res = await fetch(details.url, {
                        credentials: isFirefox ? 'include' : 'omit',
                        headers: { 'Referer': 'https://zvuk.com/' }
                    });
                    if (!res.ok) return;
                    const text = await res.text();

                    const entry = await service.constructor.captureFromUrl(details.url, text);
                    if (!entry) return;

                    const trackId = `zvuk_${Date.now()}`;
                    const actualId = store.put(trackId, { id: trackId, capturedAt: Date.now(), ...entry });

                    if (details.tabId > 0) {
                        try {
                            const metaResp = await browserAPI.tabs.sendMessage(
                                details.tabId, { action: 'getTabMeta' }
                            );
                            if (metaResp?.ok && (metaResp.meta.title || metaResp.meta.artist))
                                store.updateMeta(actualId, metaResp.meta);
                        } catch {}
                    }

                    const stored = store.get(actualId);
                    globalThis.notifyPopup?.({
                        action: 'trackCaptured',
                        trackId: actualId,
                        meta: stored?.meta || {},
                        url: stored?.url || null,
                        type: entry.type,
                        qualities: entry.qualities || null
                    })?.catch?.(() => {});
                } catch (e) {
                    console.error('[RequestInterceptor] captureFromUrl error:', e);
                }
            },
            { urls: allPatterns },
            []
        );

        console.log(`[RequestInterceptor] Service capture: watching ${allPatterns.length} pattern(s)`);
    }

    function setupFirefoxListeners() {
        if (!isFirefox || !browserAPI?.webRequest) return;

        browserAPI.webRequest.onBeforeSendHeaders.addListener(
            (details) => {
                const fromExt = isFromExtension(details);
                if (!fromExt) captureAuthToken(details);
                else rateLimiter.trackRequest('zvuk');
            },
            { urls: ZVUK_URLS },
            ['requestHeaders']
        );

        console.log('[RequestInterceptor] Firefox: listener installed');
    }

    function setupChromeRateLimiter() {
        if (!isChrome || !browserAPI?.webRequest) return;

        browserAPI.webRequest.onBeforeSendHeaders.addListener(
            async (details) => {
                const fromExt = isFromExtension(details);
                if (!fromExt) captureAuthToken(details);
                else await rateLimiter.trackRequest('zvuk');
            },
            { urls: ZVUK_URLS },
            ['requestHeaders']
        );

        console.log('[RequestInterceptor] Chrome: rate limiter installed');
    }

    globalThis.encryptedKeyStore = {};

    const KEY_URLS = ['*://zvuk.com/keyserver/api/v1/key*'];
    const SKIP_HEADERS = new Set([
        'host', 'content-length', 'connection', 'transfer-encoding',
        'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user',
        'origin', 'referer', 'cookie', 'user-agent', 'accept-encoding'
    ]);

    globalThis.nativeKeyStore = {};

    function setupKeyCapture() {
        if (!browserAPI?.webRequest) return;

        const pending = new Map();

        if (typeof browserAPI.webRequest.filterResponseData === 'function') {
            console.log('[KeyCapture] filterResponseData available, attaching to onBeforeRequest (blocking)');
            browserAPI.webRequest.onBeforeRequest.addListener((details) => {
                try {
                    const trackId = new URL(details.url).searchParams.get('track_id');
                    if (!trackId) return;
                    console.log('[KeyCapture] filterResponseData: intercepting track', trackId);
                    const filter = browserAPI.webRequest.filterResponseData(details.requestId);
                    const chunks = [];
                    filter.ondata = (e) => { chunks.push(new Uint8Array(e.data)); filter.write(e.data); };
                    filter.onstop = () => {
                        try {
                            let len = 0;
                            for (const c of chunks) len += c.length;
                            const buf = new Uint8Array(len);
                            let off = 0;
                            for (const c of chunks) { buf.set(c, off); off += c.length; }
                            globalThis.nativeKeyStore[trackId] = Array.from(buf);
                            console.log('[KeyCapture] native response for track', trackId, ':', globalThis.nativeKeyStore[trackId]);
                        } catch (e) {
                            console.warn('[KeyCapture] onstop error:', e);
                        }
                        filter.close();
                    };
                    filter.onerror = () => console.warn('[KeyCapture] filter error for track', trackId, filter.error);
                } catch (e) {
                    console.warn('[KeyCapture] filterResponseData error:', e);
                }
            }, { urls: KEY_URLS }, ['blocking']);
        } else {
            console.log('[KeyCapture] filterResponseData NOT available');
        }

        if (browserAPI.webRequest.onBeforeSendHeaders) {
            browserAPI.webRequest.onBeforeSendHeaders.addListener((details) => {
                try {
                    const trackId = new URL(details.url).searchParams.get('track_id');
                    if (trackId) pending.set(details.requestId, { trackId, headers: details.requestHeaders || [] });
                } catch {}
            }, { urls: KEY_URLS }, ['requestHeaders']);
        }

        if (browserAPI.webRequest.onCompleted) {
            browserAPI.webRequest.onCompleted.addListener((details) => {
                console.log('[KeyCapture] keyserver hit:', details.statusCode, details.url.slice(0, 160));
                const info = pending.get(details.requestId);
                pending.delete(details.requestId);

                if (details.statusCode !== 200 || !info) return;

                const hdrs = info.headers.filter(h => !SKIP_HEADERS.has(h.name.toLowerCase()));
                globalThis.encryptedKeyStore[info.trackId] = { headers: hdrs };
                console.log('[KeyCapture] stored key headers for track', info.trackId,
                    hdrs.map(h => h.name).join(', '));
            }, { urls: KEY_URLS }, []);
        }
    }

    function setupEarlyInjection() {
        if (!browserAPI?.tabs?.onUpdated || !browserAPI?.scripting?.executeScript) return;

        browserAPI.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (changeInfo.status !== 'complete') return;
            if (!tab.url?.includes('zvuk.com')) return;
            try {
                await browserAPI.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    func: () => {
                        if (window.__sounddlib_key_spy) return;
                        window.__sounddlib_key_spy = true;
                        window.__sounddlib_key_store = {};
                        window.__sounddlib_raw_key_store = {};
                        window.__sounddlib_pending_tid = null;

                        const _f = window.fetch;
                        window.fetch = async function(...args) {
                            const res = await _f.apply(this, args);
                            try {
                                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
                                if (url.includes('/keyserver/api/v1/key')) {
                                    const tid = new URL(url).searchParams.get('track_id');
                                    if (tid) {
                                        window.__sounddlib_pending_tid = tid;
                                        // Capture x-encrypted-key from request headers
                                        const init = args[1] || {};
                                        const h = init.headers instanceof Headers
                                            ? Object.fromEntries(init.headers.entries())
                                            : (typeof init.headers === 'object' && init.headers ? init.headers : {});
                                        const xek = h['x-encrypted-key'] || h['X-Encrypted-Key'] || '';
                                        if (xek) {
                                            window.__sounddlib_xek_store  = window.__sounddlib_xek_store || {};
                                            window.__sounddlib_xek_store[tid] = xek;
                                            window.__sounddlib_latest_xek = xek;
                                        }
                                    }
                                }
                                // Spy on zvuk.com API responses for CDN stream URLs
                                if (/zvuk\.com\/(api|gateway|track)/.test(url) && !url.includes('cdn-hls-slicer')) {
                                    res.clone().text().then(text => {
                                        if (!text.includes('cdn-hls-slicer.zvuk.com/drm/track/')) return;
                                        try {
                                            const found = [];
                                            const scan = (v) => {
                                                if (typeof v === 'string' && v.includes('cdn-hls-slicer.zvuk.com/drm/track/')) found.push(v);
                                                else if (v && typeof v === 'object') Object.values(v).forEach(scan);
                                            };
                                            scan(JSON.parse(text));
                                            for (const streamUrl of found) {
                                                const m = streamUrl.match(/\/track\/([^/?#]+)/);
                                                if (m) window.postMessage({ __sounddlib: true, type: 'STREAM_URL_CAPTURED', cdnTrackId: m[1], streamUrl, apiUrl: url }, '*');
                                            }
                                        } catch {}
                                    }).catch(() => {});
                                }
                            } catch {}
                            return res;
                        };

                        const _ab = Response.prototype.arrayBuffer;
                        Response.prototype.arrayBuffer = async function() {
                            const result = await _ab.call(this);
                            try {
                                if (this.url?.includes('/keyserver/api/v1/key')) {
                                    const tid = new URL(this.url).searchParams.get('track_id');
                                    if (tid)
                                        window.__sounddlib_raw_key_store[tid] = Array.from(new Uint8Array(result.slice(0)));
                                }
                            } catch {}
                            return result;
                        };

                        const _ik = crypto.subtle.importKey.bind(crypto.subtle);
                        crypto.subtle.importKey = async function(format, keyData, algorithm, extractable, usages) {
                            const result = await _ik(format, keyData, algorithm, extractable, usages);
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

                        console.log('[SoundDLib] Key spy v3 injected');
                    }
                });
            } catch {}
        });

        console.log('[RequestInterceptor] Early injection listener installed');
    }

    setupFirefoxListeners();
    setupChromeRateLimiter();
    setupServiceCapture();
    setupKeyCapture();
    setupEarlyInjection();

    console.log('[RequestInterceptor] Loaded');
})();
