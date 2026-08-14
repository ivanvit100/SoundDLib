/**
 * SoundDLib services module
 * Relay for Яндекс.Музыка service (isolated world content script)
 * @module services/yandex/YandexRelay
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class YandexRelay extends global.BaseRelay {
        constructor(api) {
            super(api);
            this._registerHandlers();
            this._registerInjectors();
        }

        _onMainWorldMessage(data) {
            const { type, ...payload } = data;

            if (type === 'YANDEX_STREAM_CAPTURED') {
                const trackId = `yandex_${Date.now()}`;
                this._api.runtime.sendMessage({
                    action: 'audioIntercepted',
                    trackId,
                    type: null,
                    mimeType: payload.codec === 'aac' ? 'audio/aac' : 'audio/mpeg',
                    url: payload.url,
                    meta: payload.meta || {},
                    serviceName: 'yandex'
                }).catch(() => {});
            }
        }

        _registerHandlers() {
            // Resolve stream URL for a track (used during playlist download)
            this.registerHandler('getYandexTrackUrl', async (message) => {
                const { trackId } = message;
                try {
                    const url = `https://music.yandex.ru/api/v2.1/handlers/track/${trackId}/track/download/m` +
                        '?hq=0&strm=true&external-domain=music.yandex.ru&overembed=no';
                    const res = await fetch(url, {
                        credentials: 'include',
                        headers: {
                            'X-Retpath-Y': 'https://music.yandex.ru',
                            'Accept': 'application/json'
                        }
                    });
                    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
                    const data = await res.json();
                    if (!data?.src) return { ok: false, error: 'Нет src в ответе API' };
                    return { ok: true, url: data.src };
                } catch (e) {
                    return { ok: false, error: String(e) };
                }
            });

            this.registerHandler('fetchFromTab', async (message) => {
                const res = await fetch(message.url, {
                    credentials: 'include',
                    headers: message.headers || {}
                });
                const body = await res.text();
                return { ok: res.ok, status: res.status, body, contentType: res.headers.get('content-type') || '' };
            });

            this.registerHandler('getPlaybackState', () => {
                const el = document.getElementById('__sdl_yandex_state');
                if (el?.dataset.t != null && parseFloat(el.dataset.d) > 0) {
                    return { ok: true, state: {
                        currentTime: parseFloat(el.dataset.t),
                        duration: parseFloat(el.dataset.d),
                        paused: el.dataset.p === '1'
                    } };
                }
                const media = document.querySelector('audio, video');
                return { ok: true, state: media ? {
                    currentTime: media.currentTime,
                    duration: isFinite(media.duration) ? media.duration : 0,
                    paused: media.paused
                } : null };
            });

            this.registerHandler('playbackControl', (message) => {
                const ctrl = message.control;
                if (ctrl === 'seek' && message.position != null) {
                    const el = document.getElementById('__sdl_yandex_state');
                    if (el) el.dataset.seekTo = message.position;
                    const media = document.querySelector('audio, video');
                    if (media) media.currentTime = message.position;
                } else {
                    const btns = this._findPlayerButtons();
                    if (ctrl === 'playPause') btns?.play?.click();
                    else if (ctrl === 'prevTrack') btns?.prev?.click();
                    else if (ctrl === 'nextTrack') btns?.next?.click();
                }
                return { ok: true };
            });

            this.registerHandler('getTabMeta', () => this._buildTabMeta());
        }

        _findPlayerButtons() {
            for (const bar of document.querySelectorAll('.player-controls,.d-player-controls')) {
                const btns = Array.from(bar.querySelectorAll('button')).filter(b => !b.dataset.sdlDownload);
                if (btns.length >= 3) return { prev: btns[0], play: btns[1], next: btns[2] };
            }
            return null;
        }

        _buildTabMeta() {
            const session = navigator.mediaSession?.metadata;
            const trackId = document.location.pathname.match(/\/album\/\d+\/track\/(\d+)/)?.[1] || null;
            if (session?.title || session?.artist) {
                return { ok: true, meta: {
                    title: session.title || '',
                    artist: session.artist || '',
                    cover: session.artwork?.[0]?.src || null,
                    yandexTrackId: trackId
                } };
            }
            return { ok: true, meta: {
                title: document.querySelector('.d-track__name,.track__title,h1')?.textContent?.trim()
                    || document.title || '',
                artist: document.querySelector('.d-track__artists,.track__artists')?.textContent?.trim() || '',
                cover: null,
                yandexTrackId: trackId
            } };
        }

        _registerInjectors() {
            this.registerInjector(this._injectDownloadButton.bind(this));
        }

        _createDownloadBtn(size = 18) {
            const btn = document.createElement('button');
            btn.dataset.sdlDownload = 'true';
            btn.title = 'Скачать трек (SoundDLib)';
            btn.style.cssText = [
                'background:none', 'border:none', 'cursor:pointer', 'padding:6px',
                'display:inline-flex', 'align-items:center', 'justify-content:center',
                'transition:opacity 0.15s', 'flex-shrink:0'
            ].join(';');
            btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"` +
                ' stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
                '<polyline points="7 10 12 15 17 10"/>' +
                '<line x1="12" y1="15" x2="12" y2="3"/></svg>';
            const svg = () => btn.querySelector('svg');
            btn.addEventListener('mouseover', () => svg()?.setAttribute('stroke', '#FC3F1D'));
            btn.addEventListener('mouseout',  () => svg()?.setAttribute('stroke', '#bdbdbd'));
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._api.runtime.sendMessage({ action: 'openDownloadWindow' }).catch(() => {});
            });
            return btn;
        }

        _injectDownloadButton() {
            for (const bar of document.querySelectorAll('.player-controls,.d-player-controls')) {
                if (!bar.querySelector('[data-sdl-download]'))
                    bar.appendChild(this._createDownloadBtn(18));
            }
        }
    }

    global.YandexRelay = YandexRelay;
    const api = (typeof browser !== 'undefined' && browser) || chrome;
    new YandexRelay(api).start();
    console.log('[SoundDLib] YandexRelay active');
})(typeof window !== 'undefined' ? window : self);
