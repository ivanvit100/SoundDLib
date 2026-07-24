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

    function getAllAuthUrls() {
        return (globalThis.serviceRequestInterceptors ?? []).flatMap(i => i.authUrls || []);
    }

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

    async function fetchTabMeta(tabId, actualId, store) {
        if (tabId <= 0) return;
        try {
            const metaResp = await browserAPI.tabs.sendMessage(tabId, { action: 'getTabMeta' });
            if (metaResp?.ok && (metaResp.meta.title || metaResp.meta.artist))
                store.updateMeta(actualId, metaResp.meta);
        } catch {}
    }

    async function handleCapturedUrl(details, store, registry) {
        if (details.statusCode !== 200 || !store || store.hasUrl(details.url)) return;
        const service = registry.getServiceByUrl(details.url);
        if (!service?.constructor?.captureFromUrl) return;

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
        await fetchTabMeta(details.tabId, actualId, store);

        const stored = store.get(actualId);
        globalThis.notifyPopup?.({
            action: 'trackCaptured',
            trackId: actualId,
            meta: stored?.meta || {},
            url: stored?.url || null,
            type: entry.type,
            qualities: entry.qualities || null
        })?.catch?.(() => {});
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
                const store = globalThis.audioStore;
                try {
                    await handleCapturedUrl(details, store, registry);
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
        const authUrls = getAllAuthUrls();
        if (!authUrls.length) {
            console.warn('[RequestInterceptor] No auth URLs registered yet, skipping Firefox listener');
            return;
        }
        browserAPI.webRequest.onBeforeSendHeaders.addListener(
            (details) => {
                const fromExt = isFromExtension(details);
                if (!fromExt) captureAuthToken(details);
                else rateLimiter.trackRequest('zvuk');
            },
            { urls: authUrls },
            ['requestHeaders']
        );
        console.log('[RequestInterceptor] Firefox: listener installed for', authUrls.length, 'URL pattern(s)');
    }

    function setupChromeRateLimiter() {
        if (!isChrome || !browserAPI?.webRequest) return;
        const authUrls = getAllAuthUrls();
        if (!authUrls.length) {
            console.warn('[RequestInterceptor] No auth URLs registered yet, skipping Chrome listener');
            return;
        }
        browserAPI.webRequest.onBeforeSendHeaders.addListener(
            async (details) => {
                const fromExt = isFromExtension(details);
                if (!fromExt) captureAuthToken(details);
                else await rateLimiter.trackRequest('zvuk');
            },
            { urls: authUrls },
            ['requestHeaders']
        );
        console.log('[RequestInterceptor] Chrome: rate limiter installed for', authUrls.length, 'URL pattern(s)');
    }

    globalThis.encryptedKeyStore = {};
    globalThis.nativeKeyStore = {};

    function setupServiceInterceptors() {
        const browserEnvLocal = typeof globalThis.getBrowserEnv === 'function'
            ? globalThis.getBrowserEnv() : { isFirefox: !!globalThis.browser };
        for (const interceptor of (globalThis.serviceRequestInterceptors ?? [])) {
            interceptor.setupKeyCapture?.(browserAPI, !!browserEnvLocal.isFirefox);
            interceptor.setupEarlyInjection?.(browserAPI);
        }
    }

    setupFirefoxListeners();
    setupChromeRateLimiter();
    setupServiceCapture();
    setupServiceInterceptors();

    console.log('[RequestInterceptor] Loaded');
})();
