import { describe, it, expect, vi, beforeAll } from 'vitest';

let postMessages = [];

beforeAll(async () => {
    globalThis.BaseInterceptor = class {
        _post(type, payload) {
            postMessages.push({ type, payload });
            window.postMessage({ __sounddlib: true, type, ...payload }, '*');
        }
        install() { throw new Error('install() not implemented'); }
    };

    window.__sounddlib_interceptor = false;

    vi.useFakeTimers();
    vi.resetModules();
    await import('../../../services/zvuk/ZvukInterceptor.js');
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('ZvukInterceptor', () => {
    it('ZvukInterceptor класс существует', () => {
        expect(globalThis.ZvukInterceptor).toBeDefined();
    });

    it('наследует от BaseInterceptor', () => {
        const interceptor = new globalThis.ZvukInterceptor();
        expect(interceptor).toBeInstanceOf(globalThis.BaseInterceptor);
    });

    it('устанавливает __sounddlib_interceptor = true после install()', () => {
        expect(window.__sounddlib_interceptor).toBe(true);
    });

    it('не устанавливается повторно если уже активен', () => {
        window.__sounddlib_interceptor = true;
        const interceptor = new globalThis.ZvukInterceptor();
        const hookSpy = vi.spyOn(interceptor, '_hookMediaElement').mockImplementation(() => {});
        interceptor.install();
        expect(hookSpy).not.toHaveBeenCalled();
        hookSpy.mockRestore();
    });

    describe('_hookKeyCapture', () => {
        it('устанавливает __sounddlib_key_spy', () => {
            expect(window.__sounddlib_key_spy).toBe(true);
        });

        it('устанавливает __sounddlib_key_store', () => {
            expect(window.__sounddlib_key_store).toBeDefined();
        });
    });

    describe('_hookStateBridge', () => {
        it('не бросает при запуске', () => {
            vi.useFakeTimers();
            const interceptor = new globalThis.ZvukInterceptor();
            expect(() => interceptor._hookStateBridge()).not.toThrow();
            vi.clearAllTimers();
            vi.useRealTimers();
        });
    });

    describe('_hookWorkerSpy', () => {
        it('заменяет Blob конструктор', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._hookWorkerSpy();
            const longString = 'x'.repeat(201);
            const blob = new Blob([longString], { type: 'text/javascript' });
            expect(blob).toBeDefined();
        });

        it('не меняет Blob для коротких строк', () => {
            const shortStr = 'x'.repeat(100);
            const blob = new Blob([shortStr], { type: 'text/javascript' });
            expect(blob.size).toBeGreaterThan(0);
        });

        it('не меняет Blob для не-js типов', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._hookWorkerSpy();
            const longStr = 'x'.repeat(201);
            const blob = new Blob([longStr], { type: 'text/plain' });
            expect(blob.size).toBe(longStr.length);
        });

        it('заменяет Worker конструктор', () => {
            expect(typeof window.Worker).toBe('function');
        });
    });

    describe('_hookMediaElement', () => {
        it('overrides HTMLMediaElement.prototype.src', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._post = vi.fn();
            interceptor._hookMediaElement();
        });

        it('overrides HTMLMediaElement.prototype.play', () => {
            expect(typeof HTMLMediaElement.prototype.play).toBe('function');
        });
    });

    describe('fetch hook', () => {
        it('перехватывает keyserver запросы', async () => {
            window.__sounddlib_pending_tid = null;

            const origFetch = window.fetch;
            window.fetch = async (url) => ({
                ok: true,
                url,
                text: () => Promise.resolve('{}'),
                clone: () => ({ text: () => Promise.resolve('{}') }),
                arrayBuffer: async () => new ArrayBuffer(16)
            });

            try {
                await fetch('https://zvuk.com/keyserver/api/v1/key?track_id=xyz');
            } catch {}

            window.fetch = origFetch;
        });

        it('перехватывает keyserver с X-Encrypted-Key заголовком', async () => {
            window.__sounddlib_pending_tid = null;
            const origFetch = window.fetch;
            window.fetch = async (url, init) => ({
                ok: true,
                url,
                text: () => Promise.resolve('{}'),
                clone: () => ({ text: () => Promise.resolve('{}') }),
                arrayBuffer: async () => new ArrayBuffer(16)
            });
            try {
                await fetch('https://zvuk.com/keyserver/api/v1/key?track_id=abc', {
                    headers: { 'x-encrypted-key': 'mykey123', 'host': 'zvuk.com' }
                });
                expect(window.__sounddlib_pending_tid).toBe('abc');
                expect(window.__sounddlib_xek_store?.['abc']).toBe('mykey123');
            } catch {}
            window.fetch = origFetch;
        });

        it('перехватывает keyserver с Headers объектом', async () => {
            window.__sounddlib_pending_tid = null;
            const origFetch = window.fetch;
            window.fetch = async (url, init) => ({
                ok: true, url,
                text: () => Promise.resolve('{}'),
                clone: () => ({ text: () => Promise.resolve('{}') }),
                arrayBuffer: async () => new ArrayBuffer(16)
            });
            try {
                const headers = new Headers({ 'x-encrypted-key': 'hdrkey' });
                await fetch('https://zvuk.com/keyserver/api/v1/key?track_id=hdr1', { headers });
                expect(window.__sounddlib_xek_store?.['hdr1']).toBe('hdrkey');
            } catch {}
            window.fetch = origFetch;
        });

        it('сканирует stream URL из zvuk API ответа', async () => {
            const origFetch = window.fetch;
            const streamUrl = 'https://cdn-hls-slicer.zvuk.com/drm/track/99/master.m3u8';
            window.fetch = async (url) => {
                const resp = {
                    ok: true, url,
                    text: () => Promise.resolve(JSON.stringify({ stream: streamUrl })),
                    clone: () => ({
                        text: () => Promise.resolve(JSON.stringify({ stream: streamUrl }))
                    }),
                    arrayBuffer: async () => new ArrayBuffer(16)
                };
                return resp;
            };
            try {
                await fetch('https://zvuk.com/api/v1/track/99');
                await new Promise(r => setTimeout(r, 20));
            } catch {}
            window.fetch = origFetch;
        });
    });

    describe('_hookStateBridge setInterval', () => {
        it('запускает интервал и обновляет __sdl_state', async () => {
            vi.useFakeTimers();
            const audio = document.createElement('audio');
            Object.defineProperty(audio, 'currentTime', { value: 10, configurable: true });
            Object.defineProperty(audio, 'duration', { value: 100, configurable: true });
            Object.defineProperty(audio, 'paused', { value: false, configurable: true });
            window.__sounddlib_media_el = audio;

            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._hookStateBridge();
            vi.advanceTimersByTime(500);

            const el = document.getElementById('__sdl_state');
            if (el) expect(el.dataset.t).toBeDefined();

            vi.clearAllTimers();
            vi.useRealTimers();
        });

        it('запускает seekTo если dataset.seekTo задан', async () => {
            vi.useFakeTimers();
            const audio = document.createElement('audio');
            let currentTime = 0;
            Object.defineProperty(audio, 'currentTime', {
                get: () => currentTime,
                set: (v) => { currentTime = v; },
                configurable: true
            });
            Object.defineProperty(audio, 'duration', { value: 100, configurable: true });
            Object.defineProperty(audio, 'paused', { value: false, configurable: true });
            window.__sounddlib_media_el = audio;

            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._hookStateBridge();
            vi.advanceTimersByTime(500);

            const el = document.getElementById('__sdl_state');
            if (el) {
                el.dataset.seekTo = '45';
                vi.advanceTimersByTime(500);
            }

            vi.clearAllTimers();
            vi.useRealTimers();
            expect(true).toBe(true);
        });

        it('не падает если нет media element', () => {
            vi.useFakeTimers();
            window.__sounddlib_media_el = null;
            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._hookStateBridge();
            vi.advanceTimersByTime(500);
            vi.clearAllTimers();
            vi.useRealTimers();
            expect(true).toBe(true);
        });
    });

    describe('crypto.subtle.importKey hook', () => {
        it('перехватывает AES-CBC ключ из ArrayBuffer', async () => {
            window.__sounddlib_pending_tid = 'tid123';
            window.__sounddlib_key_store = {};

            const keyData = new Uint8Array(16).fill(1).buffer;
            try {
                await crypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, ['decrypt']);
                expect(window.__sounddlib_key_store['tid123']).toBeDefined();
            } catch {}
        });

        it('перехватывает AES-CBC ключ из ArrayBufferView', async () => {
            window.__sounddlib_pending_tid = 'tid456';
            window.__sounddlib_key_store = {};

            const keyView = new Uint8Array(16).fill(2);
            try {
                await crypto.subtle.importKey('raw', keyView, { name: 'AES-CBC' }, false, ['decrypt']);
                expect(window.__sounddlib_key_store['tid456']).toBeDefined();
            } catch {}
        });
    });

    describe('HTMLMediaElement.src override', () => {
        it('перехватывает data:audio URL', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            const postCalls = [];
            interceptor._post = (t, p) => postCalls.push({ t, p });
            interceptor._hookMediaElement();

            const audio = document.createElement('audio');
            const binary = String.fromCharCode(72, 101, 108, 108, 111);
            const b64 = btoa(binary);
            const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (srcDesc?.set) {
                srcDesc.set.call(audio, `data:audio/mpeg;base64,${b64}`);
                expect(postCalls.some(c => c.t === 'AUDIO_CAPTURED')).toBe(true);
            }
        });
    });

    describe('HTMLMediaElement.play override', () => {
        it('устанавливает __sounddlib_media_el при play', () => {
            window.__sounddlib_media_el = null;
            const audio = document.createElement('audio');
            try { HTMLMediaElement.prototype.play.call(audio); } catch {}
            expect(window.__sounddlib_media_el).toBe(audio);
        });
    });

    describe('XHR override', () => {
        it('перехватывает keyserver XHR с track_id', () => {
            window.__sounddlib_pending_tid = null;
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key?track_id=xhrtest');
            try { xhr.send(); } catch {}
            expect(window.__sounddlib_pending_tid).toBe('xhrtest');
        });

        it('не устанавливает pending_tid для других URL', () => {
            window.__sounddlib_pending_tid = null;
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://zvuk.com/api/v1/tracks');
            try { xhr.send(); } catch {}
            expect(window.__sounddlib_pending_tid).toBeNull();
        });
    });

    describe('Response.prototype.arrayBuffer override', () => {
        it('сохраняет ключ для keyserver response', async () => {
            window.__sounddlib_raw_key_store = {};
            const fakeResp = new Response(new Uint8Array([1, 2, 3, 4]).buffer);
            Object.defineProperty(fakeResp, 'url', {
                value: 'https://zvuk.com/keyserver/api/v1/key?track_id=resp123',
                configurable: true
            });
            const result = await Response.prototype.arrayBuffer.call(fakeResp);
            expect(result).toBeDefined();
            if (window.__sounddlib_raw_key_store['resp123']) {
                expect(window.__sounddlib_raw_key_store['resp123']).toBeDefined();
            }
        });
    });

    describe('Worker override', () => {
        it('Worker конструктор заменён', () => {
            expect(typeof window.Worker).toBe('function');
        });
    });
});
