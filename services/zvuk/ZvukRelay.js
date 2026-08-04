/**
 * SoundDLib services module
 * Relay for Zvuk service
 * @module services/zvuk/ZvukRelay
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class ZvukRelay extends global.BaseRelay {
        constructor(api) {
            super(api);
            this._registerHandlers();
            this._registerInjectors();
        }

        _onMainWorldMessage(data) {
            const { type, ...payload } = data;
            if (type === 'AUDIO_CAPTURED') {
                this._api.runtime.sendMessage({
                    action: 'audioIntercepted',
                    trackId: `zvuk_${Date.now()}`,
                    type: 'audio',
                    mimeType: payload.mimeType,
                    data: payload.data,
                    url: payload.url || null,
                    meta: payload.meta || {}
                }).catch(() => {});
            }

            if (type === 'STREAM_URL_CAPTURED') {
                console.log('[SoundDLib] Stream URL captured from', payload.apiUrl, '→', payload.cdnTrackId);
                this._api.runtime.sendMessage({
                    action: 'streamUrlCaptured',
                    cdnTrackId: payload.cdnTrackId,
                    streamUrl: payload.streamUrl
                }).catch(() => {});
            }
        }

        _registerHandlers() {
            this.registerHandler('fetchKeyFromMainWorld', async (message) => {
                const hdrs = message.extraHeaders || [];
                const xekValue = message.xekValue ||
                    Array.from(crypto.getRandomValues(new Uint8Array(16)))
                        .map(b => b.toString(16).padStart(2, '0')).join('');
                const headers = { 'x-encrypted-key': xekValue };
                for (const h of hdrs) headers[h.name] = h.value;
                const res = await fetch(message.url, { credentials: 'include', headers });
                if (!res.ok) return { ok: false, status: res.status };
                const buf = await res.arrayBuffer();
                return { ok: true, data: Array.from(new Uint8Array(buf)), source: 'fetch', xekValue };
            });

            this.registerHandler('playTrackById', (message) => {
                const wrapper = document.querySelector(`[data-entity-id="${message.zvukTrackId}"][role="button"]`);
                if (!wrapper) return { ok: false, reason: 'no-wrapper' };
                const isOurBtn = b => b.dataset.sdlTracklistDl || b.dataset.sdlDownload;
                const playBtn =
                    wrapper.querySelector('[class*="PlayButton_"]') ||
                    wrapper.querySelector('[class*="Cover_cover"] button') ||
                    wrapper.querySelector('[class*="Cover_playButton"]') ||
                    wrapper.querySelector('[class*="play"]') ||
                    Array.from(wrapper.querySelectorAll('button')).find(b => !isOurBtn(b));
                if (playBtn) playBtn.click(); else wrapper.click();
                return { ok: true };
            });

            this.registerHandler('fetchFromTab', async (message) => {
                const res = await fetch(message.url, { credentials: 'include', headers: message.headers || {} });
                const body = await res.text();
                return { ok: res.ok, status: res.status, body, contentType: res.headers.get('content-type') || '' };
            });

            this.registerHandler('fetchAudioFromTab', async (message) => {
                const res = await fetch(message.url, { credentials: 'include', headers: message.headers || {} });
                if (!res.ok) return { ok: false, status: res.status };
                const buf = await res.arrayBuffer();
                const mimeType = res.headers.get('content-type') || 'audio/mpeg';
                return { ok: true, data: Array.from(new Uint8Array(buf)), mimeType };
            });

            this.registerHandler('getPlaybackState', () => {
                const el = document.getElementById('__sdl_state');
                if (el?.dataset.t != null && parseFloat(el.dataset.d) > 0) {
                    return { ok: true, state: {
                        currentTime: parseFloat(el.dataset.t),
                        duration: parseFloat(el.dataset.d),
                        paused: el.dataset.p === '1'
                    } };
                }

                const media = document.querySelector('video, audio');
                return { ok: true, state: media ? {
                    currentTime: media.currentTime,
                    duration: isFinite(media.duration) ? media.duration : 0,
                    paused: media.paused
                } : null };
            });

            this.registerHandler('playbackControl', (message) => {
                const ctrl = message.control;
                if (ctrl === 'seek' && message.position != null) {
                    const el = document.getElementById('__sdl_state');
                    if (el) el.dataset.seekTo = message.position;
                    const media = document.querySelector('audio, video');
                    if (media) media.currentTime = message.position;
                } else {
                    const findBtns = () => {
                        const real = (el) =>
                    Array.from(el.querySelectorAll('button')).filter(b => !b.dataset.sdlDownload);
                        const mini = document.querySelector('[class*="mini__"] [class*="controls__"]');
                        if (mini) {
                            const b = real(mini);
                            if (b.length >= 3) return { prev: b[0], play: b[1], next: b[2] };
                        }

                        for (const c of document.querySelectorAll('[class*="controls__"]')) {
                            const b = real(c); if (b.length === 5) return { prev: b[1], play: b[2], next: b[3] };
                        }
                        return null;
                    };
                    const btns = findBtns();
                    if (ctrl === 'playPause') btns?.play?.click();
                    else if (ctrl === 'prevTrack') btns?.prev?.click();
                    else if (ctrl === 'nextTrack') btns?.next?.click();
                }
                return { ok: true };
            });

            this.registerHandler('getTabMeta', () => this._buildTabMeta());
        }

        _tabMetaFromSession(session, zvukTrackId) {
            return { ok: true, meta: {
                title: session.title || '',
                artist: session.artist || '',
                cover: session.artwork?.[0]?.src || null,
                zvukTrackId
            } };
        }

        _tabMetaFromDom(zvukTrackId) {
            const title = document.querySelector(
                '[class*="title"]:not([class*="album"]):not([class*="artist"]),' +
                '[data-testid*="track-title"],h1'
            )?.textContent?.trim() || document.title || '';
            const artist = document.querySelector(
                '[class*="artist"],[data-testid*="artist"]'
            )?.textContent?.trim() || '';
            return { ok: true, meta: { title, artist, cover: null, zvukTrackId } };
        }

        _buildTabMeta() {
            const session = navigator.mediaSession?.metadata;
            const zvukTrackId = document.querySelector('[class*="mini__"] a[href*="/track/"]')
                ?.getAttribute('href')?.match(/\/track\/(\d+)/)?.[1] || null;
            if (session && (session.title || session.artist))
                return this._tabMetaFromSession(session, zvukTrackId);
            return this._tabMetaFromDom(zvukTrackId);
        }

        _setupStyle() {
            const target = document.head || document.documentElement;
            if (!target || document.getElementById('__sdl_tracklist_style')) return;
            const s = document.createElement('style');
            s.id = '__sdl_tracklist_style';
            s.textContent =
                '[data-entity-id][role="button"]:not(:hover) button[data-sdl-tracklist-dl]{display:none!important}' +
                '[data-entity-id][role="button"]:hover button[data-sdl-tracklist-dl]{display:inline-flex!important}';
            target.appendChild(s);
        }

        _registerInjectors() {
            this.registerInjector(this._setupStyle.bind(this));
            this.registerInjector(this._injectPlayer.bind(this));
            this.registerInjector(this._injectTrackList.bind(this));
            this.registerInjector(this._injectPlaylistHeader.bind(this));
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
            btn.addEventListener('mouseover', () => svg()?.setAttribute('stroke', '#fff'));
            btn.addEventListener('mouseout', () => svg()?.setAttribute('stroke', '#bdbdbd'));
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._api.runtime.sendMessage({ action: 'openDownloadWindow' }).catch(() => {});
            });
            return btn;
        }

        _createTrackListBtn(zvukTrackId, meta) {
            const btn = document.createElement('button');
            btn.dataset.sdlTracklistDl = 'true';
            btn.setAttribute('data-sdl-tracklist-dl', 'true');
            btn.title = 'Скачать трек (SoundDLib)';
            btn.style.cssText = [
                'background:none', 'border:none', 'cursor:pointer', 'padding:4px',
                'display:none', 'align-items:center', 'justify-content:center',
                'flex-shrink:0', 'opacity:0.7', 'transition:opacity 0.15s'
            ].join(';');
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"' +
                ' stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
                '<polyline points="7 10 12 15 17 10"/>' +
                '<line x1="12" y1="15" x2="12" y2="3"/></svg>';
            const svg = () => btn.querySelector('svg');
            btn.addEventListener('mouseover', () => {
                svg()?.setAttribute('stroke', '#fff');
                btn.style.opacity = '1';
            });
            btn.addEventListener('mouseout', () => {
                svg()?.setAttribute('stroke', '#bdbdbd');
                btn.style.opacity = '0.7';
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this._api.runtime.sendMessage({
                    action: 'openDownloadWindowForTrack',
                    zvukTrackId, title: meta?.title || '', artist: meta?.artist || '', cover: meta?.cover || ''
                }).catch(() => {});
            });
            return btn;
        }

        _injectPlayer() {
            const mini = document.querySelector('[class*="mini__"] [class*="controls__"]');
            if (mini && !mini.querySelector('[data-sdl-download]'))
                mini.appendChild(this._createDownloadBtn(18));

            for (const c of document.querySelectorAll('[class*="controls__"]')) {
                const real = Array.from(c.querySelectorAll('button')).filter(b => !b.dataset.sdlDownload);
                if (real.length === 5 && !c.querySelector('[data-sdl-download]'))
                    c.appendChild(this._createDownloadBtn(18));
            }

            const mobile = document.querySelector('[class*="MiniPlayerMobile_controls__"]');
            if (mobile && !mobile.querySelector('[data-sdl-download]'))
                mobile.insertBefore(this._createDownloadBtn(18), mobile.lastElementChild);
        }

        _injectTrackList() {
            for (const wrapper of document.querySelectorAll('[data-entity-id][role="button"]')) {
                const controls = wrapper.querySelector('[class*="Controls_controls__"]');
                if (!controls || controls.querySelector('[data-sdl-tracklist-dl]')) continue;
                const zvukTrackId = wrapper.getAttribute('data-entity-id');
                if (!zvukTrackId) continue;
                const title = wrapper.querySelector('[class*="Info_titleInner__"]')?.textContent?.trim() || '';
                const artist = wrapper.querySelector('[class*="Info_description___"]')?.textContent?.trim() || '';
                const cover = wrapper.querySelector(
                    '[class*="Cover_img__"] img,[class*="Cover_cover__"] img'
                )?.src || '';
                const duration = controls.querySelector('[class*="Controls_duration__"]');
                const btn = this._createTrackListBtn(zvukTrackId, { title, artist, cover });
                if (duration) controls.insertBefore(btn, duration); else controls.appendChild(btn);
            }
        }

        _makeDlBtn() {
            const btn = document.createElement('div');
            btn.dataset.sdlPlaylistDl = 'true';
            btn.title = 'Скачать плейлист (SoundDLib)';
            btn.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;';
            btn.innerHTML =
                '<span style="--size: 28rem; --gutter: 0rem;"' +
                ' class="iconColor__primary colt-desktop__root---ce292">' +
                '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
                ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
                '<polyline points="7 10 12 15 17 10"/>' +
                '<line x1="12" y1="15" x2="12" y2="3"/></svg></span>';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._api.runtime.sendMessage({ action: 'openDownloadWindow' }).catch(() => {});
            });
            return btn;
        }

        _injectPlaylistHeader() {
            const path = location.pathname;
            const isFavorites = /\/favorites/.test(path);
            if (!isFavorites && !/\/(?:playlist|collection)\/\d+/.test(path)) return;

            if (isFavorites) {
                const wrapper = document.querySelector('[class*="InfoContainer_wrapper"]');
                if (!wrapper || wrapper.querySelector('[data-sdl-playlist-dl]')) return;
                const btn = this._makeDlBtn();
                const refBtn = wrapper.querySelector('[class*="GeneralButton_button"]');
                if (refBtn) btn.className = refBtn.className;
                btn.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;';
                wrapper.appendChild(btn);
                return;
            }

            const wrapper = document.querySelector('[class*="HeaderButtons_wrapper"]');
            if (!wrapper || wrapper.querySelector('[data-sdl-playlist-dl]')) return;
            const btn = this._makeDlBtn();
            const refBtn = wrapper.querySelector('[class*="GeneralButton_button"]');
            if (refBtn) btn.className = refBtn.className;
            btn.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;';
            const cmButtons = wrapper.querySelector('[class*="CmButtons_wrapper"]');
            if (cmButtons) wrapper.insertBefore(btn, cmButtons);
            else wrapper.appendChild(btn);
        }
    }

    global.ZvukRelay = ZvukRelay;
    const api = (typeof browser !== 'undefined' && browser) || chrome;
    new ZvukRelay(api).start();
    console.log('[SoundDLib] ZvukRelay active');
})(typeof window !== 'undefined' ? window : self);
