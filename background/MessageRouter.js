/**
 * SoundDLib background module
 * Routes runtime messages between content scripts, popup, and background
 * @module background/MessageRouter
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    console.log('[MessageRouter] Loading...');

    const browserAPI = typeof globalThis.getExtensionApi === 'function'
        ? globalThis.getExtensionApi()
        : (globalThis.browser || globalThis.chrome || null);
    const browserEnv = typeof globalThis.getBrowserEnv === 'function'
        ? globalThis.getBrowserEnv()
        : { isFirefox: !!globalThis.browser, isChromium: !!globalThis.chrome };
    const isFirefox = !!browserEnv.isFirefox;

    const rateLimiter = globalThis.globalRateLimiter
        ?? new globalThis.RateLimiter({ maxRequestsPerMinute: 80 });

    const store = globalThis.audioStore;

    async function openPopupWindow(url) {
        if (browserAPI.windows) {
            const win = await browserAPI.windows.create({
                url, type: 'popup', width: 360, height: 620, focused: true, state: 'normal'
            });
            if (win?.id) browserAPI.windows.update(win.id, { focused: true });
            return !!win;
        } else if (browserAPI.tabs)
            return !!(await browserAPI.tabs.create({ url, active: true }));
        return false;
    }

    async function notifyPopup(message) {
        try {
            const views = browserAPI.extension?.getViews?.({ type: 'popup' }) ?? [];
            for (const view of views)
                view.postMessage?.(message, '*');
        } catch {}

        try {
            await browserAPI.runtime.sendMessage(message);
        } catch {}
    }

    const handlers = new Map([

        ['audioIntercepted', (msg, _sender, respond) => {
            (async () => {
                try {
                    const { trackId, type, mimeType, data, meta, url, masterUrl, qualities } = msg;
                    const id = trackId || `track_${Date.now()}`;

                    if (!data && !url && !masterUrl) {
                        await notifyPopup({ action: 'trackCaptured', trackId: id, meta });
                        respond({ ok: true, trackId: id });
                        return;
                    }

                    store.put(id, {
                        id,
                        type: type || 'audio',
                        mimeType: mimeType || 'audio/mpeg',
                        data: data ? new Uint8Array(data) : null,
                        url: url || null,
                        masterUrl: masterUrl || null,
                        qualities: qualities || null,
                        meta: meta || {},
                        capturedAt: Date.now()
                    });

                    await notifyPopup({
                        action: 'trackCaptured', trackId: id, meta,
                        type: type || 'audio', qualities: qualities || null
                    });
                    respond({ ok: true, trackId: id });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['getLatestTrack', (_msg, _sender, respond) => {
            const entry = store.getLatest();
            if (!entry) { respond({ ok: false, error: 'No track captured yet' }); return true; }
            respond({
                ok: true,
                trackId: entry.id,
                type: entry.type || 'audio',
                mimeType: entry.mimeType,
                data: entry.data ? Array.from(entry.data) : null,
                url: entry.url || null,
                masterUrl: entry.masterUrl || null,
                qualities: entry.qualities || null,
                meta: entry.meta
            });
            return true;
        }],

        ['getTrack', (msg, _sender, respond) => {
            const entry = store.get(msg.trackId);
            if (!entry) { respond({ ok: false, error: 'Track not found' }); return true; }
            respond({
                ok: true,
                trackId: entry.id,
                type: entry.type || 'audio',
                mimeType: entry.mimeType,
                data: entry.data ? Array.from(entry.data) : null,
                url: entry.url || null,
                masterUrl: entry.masterUrl || null,
                qualities: entry.qualities || null,
                meta: entry.meta
            });
            return true;
        }],

        ['listTracks', (_msg, _sender, respond) => {
            respond({ ok: true, tracks: store.list() });
            return true;
        }],

        ['fetchAudioTrack', (msg, sender, respond) => {
            (async () => {
                try {
                    const { url } = msg;
                    await rateLimiter.trackRequest('zvuk');

                    const token = globalThis.authTokenStore?.zvuk;
                    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

                    const tabs = await browserAPI.tabs.query({ url: '*://*.zvuk.com/*' });
                    const tabId = tabs?.[0]?.id ?? sender?.tab?.id ?? null;

                    if (tabId) {
                        const result = await browserAPI.tabs.sendMessage(tabId, {
                            action: 'fetchAudioFromTab', url, headers: authHeaders
                        });
                        if (result?.ok) {
                            respond({ ok: true, data: result.data, mimeType: result.mimeType });
                            return;
                        }
                    }

                    const res = await fetch(url, {
                        credentials: isFirefox ? 'include' : 'omit',
                        headers: { 'Referer': 'https://zvuk.com/', ...authHeaders }
                    });
                    if (!res.ok) { respond({ ok: false, status: res.status }); return; }
                    const buf = await res.arrayBuffer();
                    const mimeType = res.headers.get('content-type') || 'audio/mpeg';
                    respond({ ok: true, data: Array.from(new Uint8Array(buf)), mimeType });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['setRateLimit', (msg, _sender, respond) => {
            rateLimiter.setLimit(msg.limit);
            respond({ ok: true });
            return true;
        }],

        ['fetchWithRateLimit', (msg, _sender, respond) => {
            (async () => {
                try {
                    const { url, options = {} } = msg;
                    if (!options.credentials)
                        options.credentials = isFirefox ? 'include' : 'omit';

                    const MAX_RETRIES = 4;
                    let response;
                    for (let i = 0; i < MAX_RETRIES; i++) {
                        await rateLimiter.trackRequest('zvuk');
                        response = await fetch(url, options);
                        if (response.status !== 429) break;
                        rateLimiter.throttle(30000);
                        await rateLimiter.trackRequest('429-retry');
                    }

                    if (!response.ok) {
                        respond({ ok: false, status: response.status, statusText: response.statusText });
                        return;
                    }

                    const body = await response.text();
                    respond({ ok: true, status: response.status, body,
                        contentType: response.headers.get('content-type') });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['fetchBinary', (msg, _sender, respond) => {
            (async () => {
                try {
                    const res = await fetch(msg.url, {
                        credentials: 'omit',
                        headers: { 'Referer': 'https://zvuk.com/' }
                    });
                    if (!res.ok) { respond({ ok: false, status: res.status }); return; }
                    const buf = await res.arrayBuffer();
                    respond({ ok: true, data: new Uint8Array(buf) });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['fetchKeyFromTab', (msg, sender, respond) => {
            (async () => {
                try {
                    const tabs = await browserAPI.tabs.query({ url: '*://*.zvuk.com/*' });
                    const tabId = tabs?.[0]?.id ?? sender?.tab?.id ?? null;
                    if (!tabId) { respond({ ok: false, error: 'No zvuk.com tab found' }); return; }

                    // Enrich key URL with encrypted_key captured from native player
                    const keyUrlObj = new URL(msg.url);
                    const trackId = keyUrlObj.searchParams.get('track_id');
                    const storedKey = globalThis.encryptedKeyStore?.[trackId];
                    if (storedKey && !keyUrlObj.searchParams.has('encrypted_key'))
                        keyUrlObj.searchParams.set('encrypted_key', storedKey);
                    const keyUrl = keyUrlObj.toString();

                    if (browserAPI.scripting?.executeScript) {
                        try {
                            const results = await browserAPI.scripting.executeScript({
                                target: { tabId },
                                world: 'MAIN',
                                func: async (url) => {
                                    try {
                                        const res = await fetch(url, { credentials: 'include', mode: 'same-origin' });
                                        if (!res.ok) return { ok: false, status: res.status };
                                        const buf = await res.arrayBuffer();
                                        return { ok: true, data: Array.from(new Uint8Array(buf)) };
                                    } catch (e) {
                                        return { ok: false, error: String(e) };
                                    }
                                },
                                args: [keyUrl]
                            });
                            const result = results?.[0]?.result;
                            if (result) { respond(result); return; }
                        } catch (_) { }
                    }

                    const result = await browserAPI.tabs.sendMessage(tabId, {
                        action: 'fetchKeyFromMainWorld', url: keyUrl
                    });
                    respond(result ?? { ok: false, error: 'No response from content script' });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['openWindowWithUrl', (msg, _sender, respond) => {
            (async () => {
                try {
                    respond({ ok: await openPopupWindow(msg.url) });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }]
    ]);

    if (browserAPI?.runtime?.onMessage) {
        browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const handler = handlers.get(message.action);
            if (handler) return handler(message, sender, sendResponse);
            return false;
        });
        console.log('[MessageRouter] Listener installed');
    }

    globalThis.notifyPopup = notifyPopup;

    console.log('[MessageRouter] Loaded');
})();
