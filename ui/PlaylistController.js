/**
 * SoundDLib ui module
 * Controls the playlist download view
 * @module ui/PlaylistController
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const FORMAT_KEY = 'sounddlib_selected_format';

    function $el(id) { return document.getElementById(id); }

    function isStandaloneWindow() {
        const p = new URLSearchParams(location.search);
        return p.has('tabId') || p.has('autoDownload') || p.has('playlistAutoDownload');
    }

    class PlaylistController {
        constructor(service, playlistId, options = {}) {
            this.service = service;
            this.playlistId = playlistId;
            this.manager = new global.PlaylistManager();
            this.converter = new global.AudioConverter();
            this._tracks = [];
            this._title = 'playlist';
            this._isDownloading = false;
            this._autoStart = options.autoStart || false;
            this._autoStartZip = options.zip || false;
            this._init();
        }

        async _init() {
            this._populateFormatSelector();
            this._bindEvents();
            await this._discover();
        }

        async _discover() {
            this._showPhase('discovering');
            try {
                this.manager.eventBus.on('playlist:discovery', ({ loaded, total }) => {
                    const s = $el('discoveryStatus');
                    const p = $el('discoveryBar');
                    if (s) {
                        s.textContent = total
                            ? `Загрузка треков... ${loaded} / ${total}`
                            : `Загрузка треков... ${loaded}`;
                    }
                    if (p && total) p.value = Math.round((loaded / total) * 100);
                });

                [this._tracks] = await Promise.all([
                    this.manager.loadPlaylist(this.service, this.playlistId),
                    this.service.fetchPlaylistMeta(this.playlistId)
                        .then(m => { this._title = m.title || 'playlist'; })
                        .catch(() => {})
                ]);
                this._renderTrackList();
                this._showPhase('ready');

                if (this._autoStart)
                    await this._startDownload(this._autoStartZip);
            } catch (e) {
                console.error('[PlaylistController] Discovery failed:', e);
                const s = $el('discoveryStatus');
                if (s) s.textContent = `Ошибка загрузки: ${e.message}`;
            }
        }

        _renderTrackList() {
            const list = $el('trackList');
            if (!list) return;
            list.innerHTML = '';

            this._tracks.forEach((track) => {
                const item = document.createElement('div');
                item.className = 'track-item';

                const cover = document.createElement('img');
                cover.className = 'track-cover';
                cover.alt = '';
                cover.loading = 'lazy';
                if (track.cover) {
                    cover.src = track.cover;
                } else {
                    cover.src = 'data:image/svg+xml,' + encodeURIComponent(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
                        '<rect width="32" height="32" rx="3" fill="#3d3d3f"/>' +
                        '<circle cx="16" cy="16" r="6" fill="none" stroke="#666" stroke-width="1.5"/>' +
                        '<circle cx="16" cy="16" r="2" fill="#666"/>' +
                        '</svg>'
                    );
                }

                const info = document.createElement('span');
                info.className = 'track-info';

                const title = document.createElement('span');
                title.className = 'track-title';
                title.textContent = track.title || '—';

                const artist = document.createElement('span');
                artist.className = 'track-artist';
                artist.textContent = track.artist || '';

                info.appendChild(title);
                if (track.artist) info.appendChild(artist);
                item.appendChild(cover);
                item.appendChild(info);
                list.appendChild(item);
            });

            const count = $el('trackCount');
            if (count) count.textContent = `${this._tracks.length} треков`;
        }

        async _startDownload(zip = false) {
            if (this._isDownloading || !this._tracks.length) return;

            if (!isStandaloneWindow()) {
                const api = typeof global.getExtensionApi === 'function'
                    ? global.getExtensionApi()
                    : (global.chrome || global.browser);
                await api.runtime.sendMessage({ action: 'openPlaylistDownloadWindow', zip });
                return;
            }

            this._isDownloading = true;
            const format = $el('formatSelector')?.value || 'mp3';

            this._showPhase('downloading');
            this._bindDownloadEvents();

            try {
                if (zip)
                    await this.manager.downloadAllAsZip(this._tracks, format, this.converter, this._title, this.service);
                else
                    await this.manager.downloadAll(this._tracks, format, this.converter, this.service);
            } catch {}
        }

        _bindDownloadEvents() {
            this.manager.eventBus.on('download:progress', ({ message, percent, trackIndex }) => {
                const s = $el('status');
                const p = $el('progress');
                if (s) s.textContent = message;
                if (p) p.value = percent ?? 0;
                this._highlightTrack(trackIndex);
            });

            this.manager.eventBus.once('download:completed', ({ done, failed, total }) => {
                this._isDownloading = false;
                this._showPhase('done');
                const s = $el('status');
                if (s) {
                    s.textContent = failed
                        ? `Готово: ${done}/${total} треков (${failed} ошибок)`
                        : `Готово: ${done} треков`;
                }
            });

            this.manager.eventBus.once('download:failed', ({ error }) => {
                this._isDownloading = false;
                this._showPhase('ready');
                if (global.popupController) global.popupController.showError(error.message);
            });
        }

        _highlightTrack(index) {
            const items = document.querySelectorAll('.track-item');
            items.forEach((el, i) => {
                el.classList.toggle('track-item--active', i === index);
                el.classList.toggle('track-item--done', i < index);
            });
            items[index]?.scrollIntoView({ block: 'nearest' });
        }

        _showPhase(phase) {
            const discovery  = $el('discoverySection');
            const trackList  = $el('trackListSection');
            const controls   = $el('downloadControls');
            const dlBtns     = $el('downloadButtons');
            const progress   = $el('progress');
            const fmtC       = $el('formatContainer');
            const doneMsg    = $el('doneSection');

            const show = (el, v) => { if (el) el.style.display = v ? 'block' : 'none'; };
            const flex = (el, v) => { if (el) el.style.display = v ? 'flex' : 'none'; };

            show(discovery,  phase === 'discovering');
            show(trackList,  phase === 'ready' || phase === 'downloading' || phase === 'done');
            show(fmtC,       phase === 'ready');
            flex(dlBtns,     phase === 'ready');
            show(progress,   phase === 'downloading');
            flex(controls,   phase === 'downloading');
            show(doneMsg,    phase === 'done');
        }

        _populateFormatSelector() {
            const sel = $el('formatSelector');
            if (!sel) return;
            const saved = localStorage.getItem(FORMAT_KEY);
            global.ConverterRegistry.getFormats().forEach(({ value, label }) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = label;
                if (value === saved) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () =>
                localStorage.setItem(FORMAT_KEY, sel.value));
        }

        _bindEvents() {
            $el('downloadBtn')?.addEventListener('click',    () => this._startDownload(false));
            $el('downloadZipBtn')?.addEventListener('click', () => this._startDownload(true));
            $el('pauseBtn')?.addEventListener('click',  () => this._togglePause());
            $el('stopBtn')?.addEventListener('click',   () => {
                this.manager.stop();
                this._isDownloading = false;
                this._showPhase('ready');
            });
        }

        _togglePause() {
            const btn = $el('pauseBtn');
            if (this.manager._controller?.isPaused()) {
                this.manager.resume();
                if (btn) btn.textContent = 'Пауза';
            } else {
                this.manager.pause();
                if (btn) btn.textContent = 'Продолжить';
            }
        }
    }

    global.PlaylistController = PlaylistController;
    console.log('[PlaylistController] Loaded');
})(typeof window !== 'undefined' ? window : self);
