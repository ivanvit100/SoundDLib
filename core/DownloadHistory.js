/**
 * SoundDLib history module
 * Persists the 20 most recent successful downloads
 * @module core/DownloadHistory
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const HISTORY_KEY = 'sounddlib_download_history';
    const MAX_ENTRIES = 20;

    const DownloadHistory = {
        _storage: new global.Storage(),

        add(entry) {
            const history = this.getAll();
            history.unshift({ ...entry, downloadedAt: Date.now() });
            this._storage.setJSON(HISTORY_KEY, history.slice(0, MAX_ENTRIES));
        },

        getAll() {
            return this._storage.getJSON(HISTORY_KEY) || [];
        },

        clear() {
            this._storage.remove(HISTORY_KEY);
        }
    };

    global.DownloadHistory = DownloadHistory;
    console.log('[DownloadHistory] Loaded');
})(typeof window !== 'undefined' ? window : self);
