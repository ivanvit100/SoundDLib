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

        ['fetchFromTab', (msg, sender, respond) => {
            (async () => {
                try {
                    const [tabsRootA, tabsSubA] = await Promise.all([
                        browserAPI.tabs.query({ url: '*://zvuk.com/*' }),
                        browserAPI.tabs.query({ url: '*://*.zvuk.com/*' })
                    ]);
                    const tabId = [...(tabsRootA || []), ...(tabsSubA || [])][0]?.id
                        ?? sender?.tab?.id ?? null;
                    if (!tabId) { respond({ ok: false, error: 'No zvuk.com tab found' }); return; }
                    const result = await browserAPI.tabs.sendMessage(tabId, {
                        action: 'fetchFromTab', url: msg.url, headers: msg.headers || {}
                    });
                    respond(result ?? { ok: false, error: 'No response from tab' });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['fetchAudioTrack', (msg, sender, respond) => {
            (async () => {
                try {
                    const { url } = msg;
                    await rateLimiter.trackRequest('zvuk');

                    const token = globalThis.authTokenStore?.zvuk;
                    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

                    const [tabsRootA, tabsSubA] = await Promise.all([
                        browserAPI.tabs.query({ url: '*://zvuk.com/*' }),
                        browserAPI.tabs.query({ url: '*://*.zvuk.com/*' })
                    ]);
                    const tabId = [...(tabsRootA || []), ...(tabsSubA || [])][0]?.id ?? sender?.tab?.id ?? null;

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
                    const [tabsRoot, tabsSub] = await Promise.all([
                        browserAPI.tabs.query({ url: '*://zvuk.com/*' }),
                        browserAPI.tabs.query({ url: '*://*.zvuk.com/*' })
                    ]);
                    const allTabs = [...(tabsRoot || []), ...(tabsSub || [])];
                    const tabId = allTabs[0]?.id ?? sender?.tab?.id ?? null;
                    if (!tabId) { respond({ ok: false, error: 'No zvuk.com tab found' }); return; }

                    const keyUrl = msg.url;
                    const trackId = new URL(keyUrl).searchParams.get('track_id');
                    const stored = globalThis.encryptedKeyStore?.[trackId];
                    const extraHeaders = stored?.headers ?? [];

                    const xek = extraHeaders.find(h => h.name.toLowerCase() === 'x-encrypted-key');
                    const nativeKey = globalThis.nativeKeyStore?.[trackId];
                    console.log('[fetchKeyFromTab] trackId:', trackId,
                        '| stored headers:', extraHeaders.map(h => h.name).join(', ') || 'none',
                        '| x-encrypted-key value:', xek?.value ?? '(none)',
                        '| nativeKey bytes:', nativeKey ?? 'none');

                    if (nativeKey) {
                        respond({ ok: true, data: nativeKey, source: 'native', xekValue: xek?.value ?? '' });
                        return;
                    }

                    // Fast path: content script is already loaded — no injection overhead.
                    try {
                        const csResult = await browserAPI.tabs.sendMessage(tabId, {
                            action: 'fetchKeyFromMainWorld',
                            url: keyUrl,
                            extraHeaders,
                            xekValue: xek?.value ?? ''
                        });
                        if (csResult?.ok) {
                            if (csResult?.ok && !csResult.xekValue) csResult.xekValue = xek?.value ?? '';
                            console.log('[fetchKeyFromTab] content-script result:', JSON.stringify(csResult));
                            respond(csResult);
                            return;
                        }
                        console.warn('[fetchKeyFromTab] content-script returned not-ok:', csResult?.status);
                    } catch (e) {
                        console.warn('[fetchKeyFromTab] content-script sendMessage failed:', String(e));
                    }

                    // Fallback: inject into MAIN world to access window.__sounddlib_key_store
                    if (browserAPI.scripting?.executeScript) {
                        try {
                            const results = await browserAPI.scripting.executeScript({
                                target: { tabId },
                                world: 'MAIN',
                                func: async (trackId, url, hdrs) => {
                                    const spyKey = window.__sounddlib_key_store?.[trackId];
                                    if (spyKey) return { ok: true, data: spyKey, source: 'spy' };

                                    const xekValue =
                                        window.__sounddlib_xek_store?.[trackId] ||
                                        window.__sounddlib_latest_xek ||
                                        Array.from(crypto.getRandomValues(new Uint8Array(16)))
                                            .map(b => b.toString(16).padStart(2, '0')).join('');

                                    try {
                                        const headers = {};
                                        for (const h of hdrs) headers[h.name] = h.value;
                                        headers['x-encrypted-key'] = xekValue;
                                        const res = await fetch(url, { credentials: 'include', headers });
                                        if (!res.ok) return { ok: false, status: res.status };
                                        const buf = await res.arrayBuffer();
                                        const ourData = Array.from(new Uint8Array(buf));
                                        const nativeData = window.__sounddlib_raw_key_store?.[trackId];
                                        return { ok: true, data: ourData, source: 'fetch', xekValue, nativeRaw: nativeData ?? null };
                                    } catch (e) {
                                        return { ok: false, error: String(e) };
                                    }
                                },
                                args: [trackId, keyUrl, extraHeaders]
                            });
                            const result = results?.[0]?.result;
                            if (result?.ok && !result.xekValue) result.xekValue = xek?.value ?? '';
                            console.log('[fetchKeyFromTab] executeScript result:', JSON.stringify(result));
                            if (result) { respond(result); return; }
                        } catch (e) {
                            console.warn('[fetchKeyFromTab] executeScript threw:', String(e));
                        }
                    }

                    respond({ ok: false, error: 'All key fetch methods failed' });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['getTrackByZvukId', (msg, _sender, respond) => {
            const entry = store.findByZvukId(msg.zvukId);
            if (!entry) { respond({ ok: false }); return true; }
            respond({
                ok: true,
                trackId: entry.id,
                type: entry.type || 'audio',
                mimeType: entry.mimeType,
                masterUrl: entry.masterUrl || null,
                url: entry.url || null,
                qualities: entry.qualities || null,
                meta: entry.meta
            });
            return true;
        }],

        ['streamUrlCaptured', (msg, _sender, respond) => {
            if (!globalThis.streamUrlStore) globalThis.streamUrlStore = new Map();
            globalThis.streamUrlStore.set(msg.cdnTrackId, msg.streamUrl);
            console.log('[StreamUrlStore] Captured CDN ID:', msg.cdnTrackId);
            respond({ ok: true });
            return true;
        }],

        ['getStreamUrlByZvukId', (msg, _sender, respond) => {
            const su = globalThis.streamUrlStore;
            if (!su) { respond({ ok: false }); return true; }
            const prefix = msg.zvukId + '_';
            for (const [cdnId, streamUrl] of su) {
                if (cdnId === msg.zvukId || cdnId.startsWith(prefix)) {
                    respond({ ok: true, streamUrl, cdnTrackId: cdnId });
                    return true;
                }
            }
            respond({ ok: false });
            return true;
        }],

        ['resolveCdnUrl', (msg, _sender, respond) => {
            (async () => {
                try {
                    const { zvukId } = msg;
                    const registry = globalThis.serviceRegistry;
                    const service  = registry?.getAllServices?.().find(
                        s => s.constructor.capturePatterns?.some(p => p.includes('cdn-hls-slicer'))
                    );

                    const probe = async (suffix) => {
                        const url = `https://cdn-hls-slicer.zvuk.com/drm/track/${zvukId}_${suffix}/master.m3u8`;
                        const res = await fetch(url, {
                            credentials: isFirefox ? 'include' : 'omit',
                            headers: { 'Referer': 'https://zvuk.com/', 'Origin': 'https://zvuk.com' }
                        });
                        if (!res.ok) throw new Error('not ok');
                        const text = await res.text();
                        if (!text.startsWith('#EXTM3U')) throw new Error('not m3u8');
                        const entry = service?.constructor?.captureFromUrl?.(url, text);
                        if (!entry?.qualities?.length) throw new Error('no qualities');
                        return { masterUrl: url, qualities: entry.qualities };
                    };

                    for (const suffix of ['2', '3', '1', '4', '0']) {
                        try {
                            const result = await probe(suffix);
                            respond({ ok: true, ...result });
                            return;
                        } catch {}
                    }
                    respond({ ok: false, error: `All CDN suffixes failed for ${zvukId}` });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['probeCdnForTrack', (msg, _sender, respond) => {
            (async () => {
                try {
                    const { zvukId, meta } = msg;
                    const registry = globalThis.serviceRegistry;
                    const service  = registry?.getAllServices?.().find(
                        s => s.constructor.capturePatterns?.some(p => p.includes('cdn-hls-slicer'))
                    );

                    for (const suffix of ['2', '1', '3', '4', '0']) {
                        const url = `https://cdn-hls-slicer.zvuk.com/drm/track/${zvukId}_${suffix}/master.m3u8`;
                        try {
                            const res = await fetch(url, {
                                credentials: isFirefox ? 'include' : 'omit',
                                headers: { 'Referer': 'https://zvuk.com/', 'Origin': 'https://zvuk.com' }
                            });
                            if (!res.ok) continue;
                            const text = await res.text();
                            if (!text.startsWith('#EXTM3U')) continue;

                            const entry = service?.constructor?.captureFromUrl?.(url, text);
                            if (!entry) continue;

                            const trackId  = `zvuk_${Date.now()}`;
                            const actualId = store.put(trackId, { id: trackId, capturedAt: Date.now(), ...entry });
                            if (meta) store.updateMeta(actualId, meta);

                            const stored = store.get(actualId);
                            await notifyPopup({
                                action: 'trackCaptured', trackId: actualId,
                                meta: stored?.meta || {}, url,
                                type: 'hls', qualities: entry.qualities || null
                            });
                            respond({ ok: true, trackId: actualId, masterUrl: url, qualities: entry.qualities || null, suffix });
                            return;
                        } catch {}
                    }
                    respond({ ok: false, error: 'All CDN suffixes returned non-200' });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['openDownloadWindowForTrack', (msg, sender, respond) => {
            (async () => {
                try {
                    const tabId = sender?.tab?.id;
                    const qs = new URLSearchParams({ autoDownload: '1', zvukTrackId: msg.zvukTrackId });
                    if (tabId)       qs.set('tabId',       String(tabId));
                    if (msg.title)   qs.set('trackTitle',  msg.title);
                    if (msg.artist)  qs.set('trackArtist', msg.artist);
                    if (msg.cover)   qs.set('trackCover',  msg.cover);
                    respond({ ok: await openPopupWindow(
                        browserAPI.runtime.getURL(`popup.html?${qs}`)
                    )});
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['openDownloadWindow', (_msg, sender, respond) => {
            (async () => {
                try {
                    const tabId = sender?.tab?.id;
                    const qs = new URLSearchParams({ autoDownload: '1' });
                    if (tabId) qs.set('tabId', String(tabId));
                    respond({ ok: await openPopupWindow(
                        browserAPI.runtime.getURL(`popup.html?${qs}`)
                    )});
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['openPlaylistDownloadWindow', (msg, sender, respond) => {
            (async () => {
                try {
                    const tabId = sender?.tab?.id;
                    const qs = new URLSearchParams({ playlistAutoDownload: '1' });
                    if (tabId) qs.set('tabId', String(tabId));
                    if (msg.zip) qs.set('playlistZip', '1');
                    respond({ ok: await openPopupWindow(
                        browserAPI.runtime.getURL(`popup.html?${qs}`)
                    )});
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
