/**
 * SoundDLib ui module
 * Controls the download history view (template: history.html)
 * @module ui/HistoryController
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const SERVICE_COLORS = { zvuk: '#22c375' };

    function formatDate(ts) {
        return new Date(ts).toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    const HistoryController = {
        init() {
            this._render();
            this._bindEvents();
        },

        _render() {
            const history = global.DownloadHistory.getAll();
            const list  = document.getElementById('historyList');
            const empty = document.getElementById('historyEmpty');
            const clear = document.getElementById('clearHistoryBtn');

            if (!history.length) {
                if (list)  list.style.display  = 'none';
                if (empty) empty.style.display = 'block';
                if (clear) clear.style.display = 'none';
                return;
            }

            if (list)  { list.style.display = 'flex'; list.innerHTML = ''; }
            if (empty) empty.style.display  = 'none';
            if (clear) clear.style.display  = 'block';

            history.forEach(entry => { if (list) list.appendChild(this._createCard(entry)); });
        },

        _createCard(entry) {
            const color = SERVICE_COLORS[entry.service] || '#22c375';

            const card = document.createElement('div');
            card.className = 'history-card';
            card.style.borderLeftColor = color;

            const titleRow = document.createElement('div');
            titleRow.className = 'history-card-title';
            titleRow.textContent = entry.title || '—';

            const meta = document.createElement('div');
            meta.className = 'history-card-meta';

            if (entry.artist) {
                const artist = document.createElement('span');
                artist.className = 'history-artist';
                artist.textContent = entry.artist;
                card.appendChild(titleRow);
                card.appendChild(artist);
            } else card.appendChild(titleRow);

            const badge = document.createElement('span');
            badge.className = 'history-badge';
            badge.textContent = (entry.format || '').toUpperCase();
            badge.style.borderColor = color;
            badge.style.color = color;

            const date = document.createElement('span');
            date.className = 'history-date';
            date.textContent = formatDate(entry.downloadedAt);

            meta.appendChild(badge);
            meta.appendChild(date);
            card.appendChild(meta);

            return card;
        },

        _bindEvents() {
            document.getElementById('backBtn')?.addEventListener('click', () => {
                const logoInfo = document.getElementById('logoInfo');
                if (logoInfo) logoInfo.textContent = '';
                global.popupController?._restoreMainView();
            });

            document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
                global.DownloadHistory.clear();
                this._render();
            });
        }
    };

    global.HistoryController = HistoryController;
    console.log('[HistoryController] Loaded');
})(typeof window !== 'undefined' ? window : self);
