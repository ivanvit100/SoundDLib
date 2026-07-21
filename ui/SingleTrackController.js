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
        constructor(service, tabId, options = {}) {
            this.service = service;
            this._tabId = tabId || null;
            this._standalone   = options.standalone   || false;
            this._autoDownload = options.autoDownload || false;
            this._zvukTrackId  = options.zvukTrackId  || null;
            this._trackMeta    = options.trackMeta    || null;
            this.manager = new global.SingleTrackManager();
            this.converter = new global.AudioConverter();
            this._isDownloading = false;
            this._latestTrackId = null;
            this._isHls = false;
            this._seeking = false;
            this._pollInterval = null;
            this._init();
        }

        async _init() {
            this._populateFormatSelector();
            this._bindEvents();
            this._subscribeToCapture();      // before loadTrackInfo to avoid missing early captures
            await this._loadTrackInfo();
            this._startPlaybackPolling();
            if (this._autoDownload && this._latestTrackId)
                this._startDownload();
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
            if (this._zvukTrackId) {
                await this._loadTrackFromZvukId();
                return;
            }

            const status = $el('status');
            const btn    = $el('downloadBtn');
            if (btn)    btn.disabled = true;
            if (status) status.textContent = 'Ожидание воспроизведения...';

            try {
                const resp = await browserAPI.runtime.sendMessage({ action: 'getLatestTrack' });
                if (resp?.ok) {
                    this._latestTrackId = resp.trackId;
                    this._populateQualitySelector(resp.qualities || null);
                    if (btn) btn.disabled = false;
                    if (status) status.textContent = 'Нажмите «Скачать»';
                    await this._fetchAndRenderMeta(resp.masterUrl || resp.url, resp.meta);
                }
            } catch {}
        }

        async _loadTrackFromZvukId() {
            const status = $el('status');
            const btn    = $el('downloadBtn');
            if (btn)    btn.disabled = true;
            if (status) status.textContent = 'Загрузка потока...';

            if (this._trackMeta?.title || this._trackMeta?.artist)
                this._renderTrackMeta(this._trackMeta);

            try {
                // 1. Already in AudioStore (previously captured)
                const stored = await browserAPI.runtime.sendMessage({
                    action: 'getTrackByZvukId', zvukId: this._zvukTrackId
                });
                if (stored?.ok) { this._applyTrackEntry(stored); return; }

                // 2. Fetch spy already captured the CDN URL from a zvuk.com API response
                const streamCheck = await browserAPI.runtime.sendMessage({
                    action: 'getStreamUrlByZvukId', zvukId: this._zvukTrackId
                });
                if (streamCheck?.ok) {
                    const res = await browserAPI.runtime.sendMessage({
                        action: 'probeCdnForTrack',
                        zvukId: this._zvukTrackId,
                        meta: this._trackMeta || {}
                    });
                    if (res?.ok) { this._applyTrackEntry(res); return; }
                }

                // 3. Probe CDN directly — no auth needed, try common suffixes (_2, _1, _3 …)
                const probe = await browserAPI.runtime.sendMessage({
                    action: 'probeCdnForTrack',
                    zvukId: this._zvukTrackId,
                    meta: this._trackMeta || {}
                });
                if (probe?.ok) { this._applyTrackEntry(probe); return; }

                if (status) status.textContent = `Ошибка: ${probe?.error || 'поток недоступен'}`;

            } catch (e) {
                if (status) status.textContent = `Ошибка: ${e.message}`;
                console.error('[SingleTrackController] _loadTrackFromZvukId:', e);
            }
        }

        _applyTrackEntry(entry) {
            const status = $el('status');
            const btn    = $el('downloadBtn');
            this._latestTrackId = entry.trackId;
            this._populateQualitySelector(entry.qualities || null);
            if (btn)    btn.disabled = false;
            if (status) status.textContent = 'Нажмите «Скачать»';
            // Prefer DOM-extracted meta (this._trackMeta) over potentially empty AudioStore meta
            const fallback = entry.meta?.title ? entry.meta : (this._trackMeta || entry.meta);
            this._fetchAndRenderMeta(entry.masterUrl || entry.url, fallback);
            if (this._autoDownload) this._startDownload();
        }

        async _fetchAndRenderMeta(hlsUrl, fallbackMeta) {
            const zvukId = hlsUrl?.match(/\/track\/(\d+)/)?.[1];
            if (zvukId) {
                try {
                    const fresh = await this.service.fetchTrackMeta(zvukId);
                    const real = (v, fb) => (v && v !== 'Unknown') ? v : (fb || v);
                    this._renderTrackMeta({
                        title:  real(fresh.title,  fallbackMeta?.title),
                        artist: real(fresh.artist, fallbackMeta?.artist),
                        album:  real(fresh.album,  fallbackMeta?.album),
                        cover:  fresh.cover || fallbackMeta?.cover
                    });
                    return;
                } catch {}
            }
            this._renderTrackMeta(fallbackMeta);
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

                // If waiting for a specific track, only react when URL matches
                if (this._zvukTrackId) {
                    const capturedUrl = msg.url || '';
                    if (capturedUrl && !capturedUrl.includes(`/track/${this._zvukTrackId}/`)) return;
                }

                this._latestTrackId = msg.trackId;
                this._populateQualitySelector(msg.qualities || null);
                const btn = $el('downloadBtn');
                if (btn) btn.disabled = false;
                const status = $el('status');
                if (status) status.textContent = 'Нажмите «Скачать»';
                this._fetchAndRenderMeta(msg.url, msg.meta);

                if (this._autoDownload && this._zvukTrackId) this._startDownload();
            });
        }

        _bindEvents() {
            $el('downloadBtn')?.addEventListener('click', () => {
                if (!this._standalone) { this._openInWindow(true); return; }
                this._startDownload();
            });
            $el('stopBtn')?.addEventListener('click',    () => this._stop());

            $el('playPauseBtn')?.addEventListener('click', () => this._sendControl('playPause'));
            $el('prevBtn')?.addEventListener('click',      () => this._sendControl('prevTrack'));
            $el('nextBtn')?.addEventListener('click',      () => this._sendControl('nextTrack'));

            const bar = $el('playbackBar');
            if (bar) {
                bar.addEventListener('mousedown',  () => { this._seeking = true; });
                bar.addEventListener('touchstart', () => { this._seeking = true; }, { passive: true });
                bar.addEventListener('input', () => {
                    const pct = bar.max > 0 ? (parseFloat(bar.value) / parseFloat(bar.max) * 100) : 0;
                    const fill = $el('playbackFill');
                    if (fill) fill.style.width = `${pct}%`;
                    const cur = $el('playbackCurrent');
                    if (cur) cur.textContent = this._fmtTime(parseFloat(bar.value));
                });
                bar.addEventListener('change', () => {
                    this._sendControl('seek', parseFloat(bar.value));
                    this._seeking = false;
                });
            }

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

        async _openInWindow(autoDownload = false) {
            try {
                const qs = new URLSearchParams();
                if (this._tabId) qs.set('tabId', this._tabId);
                if (autoDownload) qs.set('autoDownload', '1');
                await browserAPI.windows.create({
                    url: browserAPI.runtime.getURL(`popup.html?${qs}`),
                    type: 'popup',
                    width: 340,
                    height: 590
                });
            } catch {}
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

        async _sendControl(action, position) {
            if (!this._tabId) return;

            let prevTrackId = null;
            if (action === 'prevTrack' || action === 'nextTrack') {
                try {
                    const cur = await browserAPI.tabs.sendMessage(this._tabId, { action: 'getTabMeta' });
                    prevTrackId = cur?.meta?.zvukTrackId || null;
                } catch {}
            }

            try {
                await browserAPI.tabs.sendMessage(this._tabId, {
                    action: 'playbackControl',
                    control: action,
                    position: position ?? null
                });
            } catch {}

            if (action === 'prevTrack' || action === 'nextTrack')
                this._awaitTrackChange(prevTrackId);
        }

        async _awaitTrackChange(prevTrackId) {
            const token = (this._trackChangeToken = {});

            for (let i = 0; i < 12; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (token !== this._trackChangeToken) return;
                try {
                    const resp = await browserAPI.tabs.sendMessage(this._tabId, { action: 'getTabMeta' });
                    if (token !== this._trackChangeToken) return;
                    const meta = resp?.meta;
                    const newId = meta?.zvukTrackId || null;
                    if (!newId || newId === prevTrackId) continue;
                    const url = `https://cdn-hls-slicer.zvuk.com/drm/track/${newId}/master.m3u8`;
                    await this._fetchAndRenderMeta(url, meta);
                    if (token !== this._trackChangeToken) return;
                    const latest = await browserAPI.runtime.sendMessage({ action: 'getLatestTrack' }).catch(() => null);
                    if (token !== this._trackChangeToken) return;
                    if (latest?.ok && latest.trackId !== this._latestTrackId) {
                        this._latestTrackId = latest.trackId;
                        this._populateQualitySelector(latest.qualities || null);
                        const btn = $el('downloadBtn');
                        if (btn) btn.disabled = false;
                    }
                    return;
                } catch {}
            }
        }

        async _queryPlaybackState() {
            if (!this._tabId) return null;
            try {
                const resp = await browserAPI.tabs.sendMessage(
                    this._tabId, { action: 'getPlaybackState' }
                );
                return resp?.ok ? resp.state : null;
            } catch {
                return null;
            }
        }

        _startPlaybackPolling() {
            this._stopPlaybackPolling();
            const poll = async () => {
                this._updatePlayerUI(await this._queryPlaybackState());
            };
            poll();
            this._pollInterval = setInterval(poll, 1000);
        }

        _stopPlaybackPolling() {
            if (this._pollInterval) {
                clearInterval(this._pollInterval);
                this._pollInterval = null;
            }
        }

        _updatePlayerUI(state) {
            const fill = $el('playbackFill');
            const bar  = $el('playbackBar');
            const cur  = $el('playbackCurrent');
            const dur  = $el('playbackDuration');
            const play = $el('playIcon');
            const paus = $el('pauseIcon');

            if (!state) {
                if (fill) fill.style.width = '0%';
                if (cur)  cur.textContent = '0:00';
                if (dur)  dur.textContent = '0:00';
                if (bar && !this._seeking) { bar.max = 100; bar.value = 0; }
                if (play) play.style.display = '';
                if (paus) paus.style.display = 'none';
                return;
            }

            const { currentTime, duration, paused } = state;
            const pct = duration > 0 ? (currentTime / duration * 100) : 0;
            if (fill && !this._seeking) fill.style.width = `${pct}%`;
            if (cur) cur.textContent = this._fmtTime(currentTime);
            if (dur) dur.textContent = this._fmtTime(duration);
            if (bar && !this._seeking) {
                bar.max = duration > 0 ? Math.floor(duration) : 100;
                bar.value = Math.floor(currentTime);
            }
            if (play) play.style.display = paused ? '' : 'none';
            if (paus) paus.style.display = paused ? 'none' : '';
        }

        _fmtTime(sec) {
            if (!isFinite(sec) || sec < 0) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
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
