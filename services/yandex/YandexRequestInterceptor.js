/**
 * SoundDLib services module
 * Request interceptor for Яндекс.Музыка service
 * @module services/yandex/YandexRequestInterceptor
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    if (!globalThis.serviceRequestInterceptors) globalThis.serviceRequestInterceptors = [];

    globalThis.serviceRequestInterceptors.push({
        serviceName: 'yandex',
        authUrls: [
            'https://music.yandex.ru/*',
            'https://music.yandex.com/*'
        ],
        keyUrls: [],

        setupKeyCapture(_browserAPI, _isFirefox) {
        },

        setupEarlyInjection(browserAPI) {
            if (!browserAPI?.tabs?.onUpdated || !browserAPI?.scripting?.executeScript) return;

            browserAPI.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
                if (changeInfo.status !== 'complete') return;
                if (!tab.url?.includes('music.yandex.')) return;
                try {
                    await browserAPI.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: () => {
                            if (window.__sounddlib_yandex_early) return;
                            window.__sounddlib_yandex_early = true;

                            const _fetch = window.fetch;
                            window.fetch = async function(...args) {
                                const res = await _fetch.apply(this, args);
                                try {
                                    const url = typeof args[0] === 'string'
                                        ? args[0] : (args[0]?.url ?? '');
                                    if (url.includes('music.yandex.') && url.includes('/download/m')) {
                                        res.clone().json().then(data => {
                                            if (data?.src) {
                                                window.postMessage({
                                                    __sounddlib: true,
                                                    type: 'YANDEX_STREAM_CAPTURED',
                                                    url: data.src,
                                                    codec: data.codec || 'mp3',
                                                    bitrate: data.bitrate || 0,
                                                    meta: {}
                                                }, '*');
                                            }
                                        }).catch(() => {});
                                    }
                                } catch {}
                                return res;
                            };
                            console.log('[SoundDLib] Yandex early fetch spy injected');
                        }
                    });
                } catch {}
            });

            console.log('[YandexRequestInterceptor] Early injection listener installed');
        }
    });

    console.log('[YandexRequestInterceptor] Loaded');
})();
