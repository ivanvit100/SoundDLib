/**
 * SoundDLib services module
 * Intercepts Яндекс.Музыка web page to capture track stream URLs
 * @module services/yandex/YandexInterceptor
 * @author ivanvit
 * @version 0.0.1
 */

(function(global) {
    class YandexInterceptor extends global.BaseInterceptor {
        install() {
            if (window.__sounddlib_yandex_interceptor) return;
            window.__sounddlib_yandex_interceptor = true;
            this._hookFetch();
            this._hookMediaElement();
            this._hookStateBridge();
            console.log('[SoundDLib] YandexInterceptor active');
        }

        _extractMeta() {
            const session = navigator.mediaSession?.metadata;
            if (session?.title) {
                return {
                    title: session.title || '',
                    artist: session.artist || '',
                    cover: session.artwork?.[0]?.src || null
                };
            }
            return {
                title: document.querySelector(
                    '.d-track__name,.deco-link[class*="title"],.track__title,h1'
                )?.textContent?.trim() || document.title || '',
                artist: document.querySelector(
                    '.d-track__artists,.track__artists,[class*="artists"]'
                )?.textContent?.trim() || ''
            };
        }

        _isAudioCdn(url) {
            return /storage\.mds\.yandex\.net\/get-mp3\/|strm\.yandex\.ru\/|ams\.cdn\.yandex\.net\//.test(url);
        }

        _hookFetch() {
            const _post = (t, p) => this._post(t, p);
            const _fetch = window.fetch;
            const isAudioCdn = this._isAudioCdn.bind(this);
            const extractMeta = this._extractMeta.bind(this);

            window.fetch = async function(...args) {
                const res = await _fetch.apply(this, args);
                try {
                    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');

                    if (url.includes('music.yandex.') && url.includes('/download/m')) {
                        res.clone().json().then(data => {
                            if (data?.src) {
                                _post('YANDEX_STREAM_CAPTURED', {
                                    url: data.src,
                                    codec: data.codec || 'mp3',
                                    bitrate: data.bitrate || 0,
                                    meta: extractMeta()
                                });
                            }
                        }).catch(() => {});
                    }

                    if (isAudioCdn(url))
                        _post('YANDEX_STREAM_CAPTURED', { url, meta: extractMeta() });
                } catch {}
                return res;
            };
        }

        _hookMediaElement() {
            const _post = (t, p) => this._post(t, p);
            const isAudioCdn = this._isAudioCdn.bind(this);
            const extractMeta = this._extractMeta.bind(this);

            const _srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (_srcDesc?.set) {
                Object.defineProperty(HTMLMediaElement.prototype, 'src', {
                    configurable: true,
                    get() { return _srcDesc.get.call(this); },
                    set(value) {
                        window.__sounddlib_yandex_media = this;
                        if (typeof value === 'string' && isAudioCdn(value))
                            _post('YANDEX_STREAM_CAPTURED', { url: value, meta: extractMeta() });
                        _srcDesc.set.call(this, value);
                    }
                });
            }

            const _origPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function() {
                window.__sounddlib_yandex_media = this;
                return _origPlay.call(this);
            };
        }

        _hookStateBridge() {
            setInterval(() => {
                const media = window.__sounddlib_yandex_media
                    || document.querySelector('audio, video');
                if (!media || !document.body) return;
                let el = document.getElementById('__sdl_yandex_state');
                if (!el) {
                    el = document.createElement('div');
                    el.id = '__sdl_yandex_state';
                    el.style.cssText = 'display:none;position:absolute;pointer-events:none;';
                    document.body.appendChild(el);
                }
                el.dataset.t = media.currentTime;
                el.dataset.d = isFinite(media.duration) ? media.duration : 0;
                el.dataset.p = media.paused ? '1' : '0';
                const seekTo = parseFloat(el.dataset.seekTo);
                if (!isNaN(seekTo)) { media.currentTime = seekTo; delete el.dataset.seekTo; }
            }, 500);
        }
    }

    global.YandexInterceptor = YandexInterceptor;
    new YandexInterceptor().install();
})(typeof window !== 'undefined' ? window : self);
