/**
 * SoundDLib services module
 * Message handler for Zvuk service
 * @module services/zvuk/ZvukMessageHandler
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    const browserAPI = typeof globalThis.getExtensionApi === 'function'
        ? globalThis.getExtensionApi()
        : (globalThis.browser || globalThis.chrome || null);
    const isFirefox = !!(typeof globalThis.getBrowserEnv === 'function'
        ? globalThis.getBrowserEnv() : { isFirefox: !!globalThis.browser }).isFirefox;

    if (!globalThis.serviceMessageHandlers) globalThis.serviceMessageHandlers = [];

    function tryNativeKey(nativeKey, xek, respond) {
        if (!nativeKey) return false;
        respond({ ok: true, data: nativeKey, source: 'native', xekValue: xek?.value ?? '' });
        return true;
    }

    async function tryContentScript(api, tabId, keyUrl, extraHeaders, xek, respond) {
        try {
            const csResult = await api.tabs.sendMessage(tabId, {
                action: 'fetchKeyFromMainWorld', url: keyUrl, extraHeaders, xekValue: xek?.value ?? ''
            });
            if (csResult?.ok) {
                if (!csResult.xekValue) csResult.xekValue = xek?.value ?? '';
                console.log('[fetchKeyFromTab] content-script result:', JSON.stringify(csResult));
                respond(csResult);
                return true;
            }
            console.warn('[fetchKeyFromTab] content-script returned not-ok:', csResult?.status);
        } catch (e) {
            console.warn('[fetchKeyFromTab] content-script sendMessage failed:', String(e));
        }
        return false;
    }

    async function tryExecuteScript(api, tabId, trackId, keyUrl, extraHeaders, xek, respond) {
        if (!api.scripting?.executeScript) return false;
        try {
            const results = await api.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: async (tid, url, hdrs) => {
                    const spyKey = window.__sounddlib_key_store?.[tid];
                    if (spyKey) return { ok: true, data: spyKey, source: 'spy' };
                    const xekValue =
                        window.__sounddlib_xek_store?.[tid] ||
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
                        const nativeData = window.__sounddlib_raw_key_store?.[tid];
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
            if (result) { respond(result); return true; }
        } catch (e) {
            console.warn('[fetchKeyFromTab] executeScript threw:', String(e));
        }
        return false;
    }

    async function resolveTabContext(msg, sender) {
        const [tabsRoot, tabsSub] = await Promise.all([
            browserAPI.tabs.query({ url: '*://zvuk.com/*' }),
            browserAPI.tabs.query({ url: '*://*.zvuk.com/*' })
        ]);
        const allTabs = [...(tabsRoot || []), ...(tabsSub || [])];
        const tabId = allTabs[0]?.id ?? sender?.tab?.id ?? null;
        const keyUrl = msg.url;
        const trackId = new URL(keyUrl).searchParams.get('track_id');
        const stored = globalThis.encryptedKeyStore?.[trackId];
        const extraHeaders = stored?.headers ?? [];
        const xek = extraHeaders.find(h => h.name.toLowerCase() === 'x-encrypted-key');
        const nativeKey = globalThis.nativeKeyStore?.[trackId];
        return { tabId, keyUrl, trackId, extraHeaders, xek, nativeKey };
    }

    const zvukHandlers = new Map([

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

        ['fetchKeyFromTab', (msg, sender, respond) => {
            (async () => {
                try {
                    const { tabId, keyUrl, trackId, extraHeaders, xek, nativeKey } =
                        await resolveTabContext(msg, sender);
                    if (!tabId) { respond({ ok: false, error: 'No zvuk.com tab found' }); return; }
                    console.log('[fetchKeyFromTab] trackId:', trackId,
                        '| stored headers:', extraHeaders.map(h => h.name).join(', ') || 'none',
                        '| x-encrypted-key value:', xek?.value ?? '(none)',
                        '| nativeKey bytes:', nativeKey ?? 'none');
                    if (tryNativeKey(nativeKey, xek, respond)) return;
                    if (await tryContentScript(browserAPI, tabId, keyUrl, extraHeaders, xek, respond)) return;
                    if (await tryExecuteScript(browserAPI, tabId, trackId, keyUrl, extraHeaders, xek, respond)) return;
                    respond({ ok: false, error: 'All key fetch methods failed' });
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

                    const store = globalThis.audioStore;

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
                            await globalThis.notifyPopup?.({
                                action: 'trackCaptured', trackId: actualId,
                                meta: stored?.meta || {}, url,
                                type: 'hls', qualities: entry.qualities || null
                            });
                            respond({
                                ok: true, trackId: actualId, masterUrl: url,
                                qualities: entry.qualities || null, suffix
                            });
                            return;
                        } catch {}
                    }
                    respond({ ok: false, error: 'All CDN suffixes returned non-200' });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }]

    ]);

    globalThis.serviceMessageHandlers.push(zvukHandlers);

    globalThis.registerZvukHandlers = function(handlersMap) {
        for (const [action, fn] of zvukHandlers) handlersMap.set(action, fn);
    };

    console.log('[ZvukMessageHandler] Loaded');
})();
