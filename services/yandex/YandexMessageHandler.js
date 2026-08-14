/**
 * SoundDLib services module
 * Message handler for Яндекс.Музыка service
 * @module services/yandex/YandexMessageHandler
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    const browserAPI = typeof globalThis.getExtensionApi === 'function'
        ? globalThis.getExtensionApi()
        : (globalThis.browser || globalThis.chrome || null);

    if (!globalThis.serviceMessageHandlers) globalThis.serviceMessageHandlers = [];

    const YANDEX_TAB_PATTERNS = ['*://music.yandex.ru/*', '*://music.yandex.com/*'];

    async function findYandexTab(sender) {
        for (const pattern of YANDEX_TAB_PATTERNS) {
            try {
                const tabs = await browserAPI.tabs.query({ url: pattern });
                if (tabs?.length) return tabs[0].id;
            } catch {}
        }
        return sender?.tab?.id ?? null;
    }

    const yandexHandlers = new Map([

        ['resolveYandexStreamUrl', (msg, sender, respond) => {
            (async () => {
                try {
                    const tabId = await findYandexTab(sender);
                    if (!tabId) {
                        respond({ ok: false, error: 'Нет открытой вкладки Яндекс.Музыки' });
                        return;
                    }
                    const result = await browserAPI.tabs.sendMessage(tabId, {
                        action: 'getYandexTrackUrl',
                        trackId: msg.trackId
                    });
                    respond(result || { ok: false, error: 'Нет ответа от вкладки' });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }],

        ['fetchFromYandexTab', (msg, sender, respond) => {
            (async () => {
                try {
                    const tabId = await findYandexTab(sender);
                    if (!tabId) {
                        respond({ ok: false, error: 'Нет открытой вкладки Яндекс.Музыки' });
                        return;
                    }
                    const result = await browserAPI.tabs.sendMessage(tabId, {
                        action: 'fetchFromTab',
                        url: msg.url,
                        headers: msg.headers || {}
                    });
                    respond(result || { ok: false, error: 'Нет ответа от вкладки' });
                } catch (e) {
                    respond({ ok: false, error: String(e) });
                }
            })();
            return true;
        }]

    ]);

    globalThis.serviceMessageHandlers.push(yandexHandlers);

    globalThis.registerYandexHandlers = function(handlersMap) {
        for (const [action, fn] of yandexHandlers) handlersMap.set(action, fn);
    };

    console.log('[YandexMessageHandler] Loaded');
})();
