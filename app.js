/**
 * SoundDLib main module
 * Verifies dependencies and boots PopupController
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    console.log('[App] Initializing...');

    const REQUIRED = [
        'EventBus', 'RateLimiter', 'Storage', 'DownloadHistory',
        'AudioConverter', 'SingleTrackManager', 'PlaylistManager',
        'ConverterRegistry', 'ServiceRegistry',
        'TemplateLoader', 'HistoryController',
        'SingleTrackController', 'PlaylistController', 'PopupController'
    ];

    const missing = REQUIRED.filter(dep => typeof window[dep] === 'undefined');
    if (missing.length) {
        console.error('[App] Missing dependencies:', missing);
        document.body.innerHTML =
            `<div style="padding:20px;color:#f55">Ошибка загрузки: ${missing.join(', ')}</div>`;
        return;
    }

    console.log('[App] All dependencies loaded');

    function boot() {
        try {
            window.popupController = new window.PopupController();
        } catch (e) {
            console.error('[App] Boot failed:', e);
            document.getElementById('error').textContent = `Ошибка: ${e.message}`;
            document.getElementById('error').classList.remove('hidden');
        }
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', boot);
    else
        setTimeout(boot, 0);
})();
