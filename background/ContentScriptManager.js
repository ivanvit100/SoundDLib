'use strict';

(function() {
    const api = typeof globalThis.getExtensionApi === 'function'
        ? globalThis.getExtensionApi() : null;

    async function registerAll() {
        if (!api?.scripting?.registerContentScripts) return;

        const defs = globalThis.SERVICE_DEFINITIONS || [];
        const scripts = defs.flatMap(svc => [
            {
                id: `svc-main-${svc.name}`,
                matches: svc.matches,
                js: svc.scripts.contentMain,
                world: 'MAIN',
                runAt: 'document_start',
                persistAcrossSessions: true
            },
            {
                id: `svc-isolated-${svc.name}`,
                matches: svc.matches,
                js: svc.scripts.contentIsolated,
                runAt: 'document_start',
                persistAcrossSessions: true
            }
        ]);

        for (const script of scripts) {
            try { await api.scripting.unregisterContentScripts({ ids: [script.id] }); } catch {}

            try {
                await api.scripting.registerContentScripts([script]);
            } catch (e) {
                console.error('[ContentScriptManager] Failed to register', script.id, ':', e.message);
            }
        }

        for (const script of scripts) {
            try {
                const tabs = await api.tabs.query({ url: script.matches });
                for (const tab of tabs) {
                    await api.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: script.js,
                        world: script.world ?? 'ISOLATED'
                    }).catch(() => {});
                }
            } catch {}
        }

        console.log('[ContentScriptManager] Registered', scripts.length, 'content scripts');
    }

    if (api?.runtime?.onInstalled)
        api.runtime.onInstalled.addListener(registerAll);

    registerAll();
})();
