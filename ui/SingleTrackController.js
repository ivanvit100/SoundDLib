/**
 * SoundDLib ui module
 * Controls the single-track download view
 * @module ui/SingleTrackController
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const FORMAT_KEY   = 'sounddlib_selected_format';
    const QUALITY_KEY  = 'sounddlib_hls_quality';

    const browserAPI = typeof global.getExtensionApi === 'function'
        ? global.getExtensionApi()
        : (global.browser || global.chrome || null);

    function $el(id) { return document.getElementById(id); }

    class SingleTrackController {
        constructor(service) {
            this.service = service;
            this.manager = new global.SingleTrackManager();
            this.converter = new global.AudioConverter();
            this._isDownloading = false;
            this._latestTrackId = null;
            this._isHls = false;
            this._init();
        }

        async _init() {
            this._populateFormatSelector();
            this._bindEvents();
            await this._loadTrackInfo();
            this._subscribeToCapture();
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

        _populateQualitySelector(qualities) {
            const container = $el('qualityContainer');
            const sel = $el('qualitySelector');
            if (!container || !sel) return;

            sel.innerHTML = '';

            if (!qualities?.length) {
                container.style.display = 'none';
                this._isHls = false;
                return;
            }

            const sorted = [...qualities].sort((a, b) => b.bandwidth - a.bandwidth);
            const saved  = localStorage.getItem(QUALITY_KEY);

            for (const q of sorted) {
                const opt = document.createElement('option');
                opt.value       = q.url;
                opt.textContent = q.label;
                if (q.label === saved) opt.selected = true;
                sel.appendChild(opt);
            }

            sel.addEventListener('change', () => {
                const chosen = sorted.find(q => q.url === sel.value);
                if (chosen) localStorage.setItem(QUALITY_KEY, chosen.label);
            });

            container.style.display = 'block';
            this._isHls = true;
        }

        async _loadTrackInfo() {
            const status = $el('status');
            const btn    = $el('downloadBtn');
            if (btn)    btn.disabled = true;
            if (status) status.textContent = 'Ожидание воспроизведения...';

            try {
                const resp = await browserAPI.runtime.sendMessage({ action: 'getLatestTrack' });
                if (resp?.ok) {
                    this._latestTrackId = resp.trackId;
                    this._renderTrackMeta(resp.meta);
                    this._populateQualitySelector(resp.qualities || null);
                    if (btn) btn.disabled = false;
                    if (status) status.textContent = 'Нажмите «Скачать»';
                }
            } catch {}
        }

        _renderTrackMeta(meta = {}) {
            const desc     = $el('description');
            const cover    = $el('cover');
            const logoInfo = $el('logoInfo');

            if (desc) {
                const title  = meta.title  || '—';
                const artist = meta.artist || '';
                desc.innerHTML = `<strong>${title}</strong>${artist ? `<br><small>${artist}</small>` : ''}`;
            }

            if (cover && meta.cover) {
                cover.src = meta.cover;
                cover.style.display = 'block';
            } else if (cover)
                cover.style.display = 'none';

            if (logoInfo && meta.album) logoInfo.textContent = meta.album;
        }

        _subscribeToCapture() {
            browserAPI.runtime.onMessage.addListener((msg) => {
                if (msg.action !== 'trackCaptured') return;
                if (msg.trackId === this._latestTrackId) return;
                this._latestTrackId = msg.trackId;
                this._renderTrackMeta(msg.meta);
                this._populateQualitySelector(msg.qualities || null);
                const btn = $el('downloadBtn');
                if (btn) btn.disabled = false;
                const status = $el('status');
                if (status) status.textContent = 'Нажмите «Скачать»';
            });
        }

        _bindEvents() {
            $el('downloadBtn')?.addEventListener('click', () => this._startDownload());
            $el('stopBtn')?.addEventListener('click',    () => this._stop());

            this.manager.eventBus.on('download:progress', ({ message, percent }) => {
                const s = $el('status');
                const p = $el('progress');
                if (s) s.textContent = message;
                if (p) p.value = percent ?? 0;
            });

            this.manager.eventBus.on('download:completed', ({ filename }) => {
                this._setDownloadingUI(false);
                global.popupController?.showSuccess(`Сохранено: ${filename}`);
            });

            this.manager.eventBus.on('download:failed', ({ error }) => {
                this._setDownloadingUI(false);
                global.popupController?.showError(error.message);
            });
        }

        async _startDownload() {
            if (this._isDownloading) return;
            this._isDownloading = true;

            const format     = $el('formatSelector')?.value || 'mp3';
            const qualityUrl = this._isHls ? ($el('qualitySelector')?.value || null) : null;
            this._setDownloadingUI(true);

            try {
                await this.manager.download(this._latestTrackId, format, qualityUrl, this.converter);
            } catch {}

            this._isDownloading = false;
        }

        _stop() {
            this.manager.eventBus.emit('download:failed', { error: new Error('Остановлено') });
        }

        _setDownloadingUI(active) {
            const btn   = $el('downloadBtn');
            const prog  = $el('progress');
            const ctrl  = $el('downloadControls');
            const fmtC  = $el('formatContainer');
            const qualC = $el('qualityContainer');

            if (btn)  { btn.style.display  = active ? 'none'  : 'block'; btn.disabled = active; }
            if (prog) prog.style.display   = active ? 'block' : 'none';
            if (ctrl) ctrl.style.display   = active ? 'block' : 'none';
            if (fmtC) fmtC.style.display   = active ? 'none'  : 'block';
            if (qualC) qualC.style.display  = (!active && this._isHls) ? 'block' : 'none';

            if (!active) {
                const s = $el('status');
                if (s) s.textContent = 'Нажмите «Скачать»';
                const p = $el('progress');
                if (p) p.value = 0;
            }
        }
    }

    global.SingleTrackController = SingleTrackController;
    console.log('[SingleTrackController] Loaded');
})(typeof window !== 'undefined' ? window : self);
