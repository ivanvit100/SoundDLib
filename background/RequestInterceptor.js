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

    function setupKeyCapture() {
        if (!browserAPI?.webRequest?.onCompleted) return;
        browserAPI.webRequest.onCompleted.addListener((details) => {
            if (details.statusCode !== 200) return;
            try {
                const params = new URL(details.url).searchParams;
                const key = params.get('encrypted_key');
                const trackId = params.get('track_id');
                if (key && trackId) globalThis.encryptedKeyStore[trackId] = key;
            } catch {}
        }, { urls: ['*://zvuk.com/keyserver/api/v1/key*'] }, []);
    }

    setupFirefoxListeners();
    setupChromeRateLimiter();
    setupServiceCapture();
    setupKeyCapture();

    console.log('[RequestInterceptor] Loaded');
})();
