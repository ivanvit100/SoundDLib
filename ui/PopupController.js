/**
 * SoundDLib ui module
 * @module ui/PopupController
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    console.log('[PopupController] Loading...');

    const browserAPI = typeof global.getExtensionApi === 'function'
        ? global.getExtensionApi()
        : (global.browser || global.chrome || null);

    function $el(id) { return document.getElementById(id); }

    class PopupController {
        constructor() {
            this._shellBound = false;
            this._init();
        }

        async _init() {
            global.TemplateLoader.init('view');
            this._bindShellEvents();
            await this._route();
        }

        async _route() {
            try {
                const params = new URLSearchParams(location.search);
                const forcedTabId = parseInt(params.get('tabId')) || null;
                const autoDownload = params.get('autoDownload') === '1';
                const zvukTrackId  = params.get('zvukTrackId') || null;
                const standalone   = forcedTabId !== null || autoDownload;
                const trackMeta    = zvukTrackId ? {
                    title:  params.get('trackTitle')  || '',
                    artist: params.get('trackArtist') || '',
                    cover:  params.get('trackCover')  || ''
                } : null;

                let tab;
                if (forcedTabId)
                    try { tab = await browserAPI.tabs.get(forcedTabId); } catch {}

                if (!tab) {
                    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
                    tab = tabs?.[0];
                }

                if (!tab?.url) { await this._showWrongService(); return; }

                const { url } = tab;
                const service = global.serviceRegistry.getServiceByUrl(url);

                if (!service) { await this._showWrongService(); return; }

                const siteLogo = $el('siteLogo');
                if (siteLogo) siteLogo.src = service.logo;

                document.body.style.setProperty('--primary-color', service.color);
                document.body.style.setProperty('--secondary-color', this._darken(service.color));

                if (service.constructor.isPlaylistPage(url)) {
                    const playlistId = service.extractPlaylistId(url);
                    const autoStart  = params.get('playlistAutoDownload') === '1';
                    const zip        = params.get('playlistZip') === '1';
                    await global.TemplateLoader.show('playlist', () => {
                        global.popupPlaylistController =
                            new global.PlaylistController(service, playlistId, { autoStart, zip });
                    });
                } else {
                    await global.TemplateLoader.show('single-track', () => {
                        global.popupSingleTrackController =
                            new global.SingleTrackController(
                                service, tab.id, { standalone, autoDownload, zvukTrackId, trackMeta }
                            );
                    });
                }
            } catch (e) {
                console.error('[PopupController] Route error:', e);
                await this._showWrongService();
            }
        }

        async _restoreMainView() {
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';
            await this._route();
        }

        _bindShellEvents() {
            if (this._shellBound) return;
            this._shellBound = true;

            const standalone = new URLSearchParams(location.search).has('tabId') ||
                                new URLSearchParams(location.search).has('autoDownload');

            const popoutBtn = $el('popoutBtn');
            if (standalone) {
                if (popoutBtn) popoutBtn.style.display = 'none';
            } else {
                popoutBtn?.addEventListener('click', async () => {
                    try {
                        const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
                        const tabId = tabs?.[0]?.id;
                        const qs = tabId ? `?tabId=${tabId}` : '';
                        await browserAPI.windows.create({
                            url: browserAPI.runtime.getURL(`popup.html${qs}`),
                            type: 'popup',
                            width: 340,
                            height: 590
                        });
                    } catch {}
                });
            }

            $el('historyBtn')?.addEventListener('click', () => {
                const logoInfo = $el('logoInfo');
                if (logoInfo) logoInfo.textContent = '';
                global.TemplateLoader.show('history', () => global.HistoryController.init());
            });
        }

        async _showWrongService() {
            const siteLogo = $el('siteLogo');
            if (siteLogo) siteLogo.src = 'icons/logo1.png';
            await global.TemplateLoader.show('wrong-service');
            $el('openZvuk')?.addEventListener('click', () =>
                browserAPI.tabs.create({ url: 'https://zvuk.com' }));
            $el('openGithub')?.addEventListener('click', () =>
                browserAPI.tabs.create({ url: 'https://github.com/ivanvit100/SoundDLib' }));
        }

        _darken(hex) {
            const n = parseInt(hex.replace('#', ''), 16);
            const r = Math.max(0, ((n >> 16) & 0xff) - 38);
            const g = Math.max(0, ((n >> 8)  & 0xff) - 38);
            const b = Math.max(0,  (n        & 0xff) - 38);
            return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
        }

        showError(message) {
            const el = $el('error');
            if (!el) return;
            el.textContent = message;
            el.classList.remove('hidden');
            setTimeout(() => el.classList.add('hidden'), 5000);
        }

        showSuccess(message) {
            const el = $el('success');
            if (!el) return;
            el.textContent = message;
            el.classList.remove('hidden');
            setTimeout(() => el.classList.add('hidden'), 4000);
        }
    }

    global.PopupController = PopupController;
    console.log('[PopupController] Loaded');
})(typeof window !== 'undefined' ? window : self);
