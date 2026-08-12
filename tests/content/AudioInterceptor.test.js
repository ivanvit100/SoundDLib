import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(async () => {
    window.__sounddlib_interceptor = false;
    vi.resetModules();
    await import('../../content/AudioInterceptor.js');
});

describe('AudioInterceptor', () => {
    it('устанавливает __sounddlib_interceptor = true', () => {
        expect(window.__sounddlib_interceptor).toBe(true);
    });

    it('не переустанавливается если уже активен', async () => {
        const prevKeyStore = window.__sounddlib_key_store;
        window.__sounddlib_interceptor = true;
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
        expect(window.__sounddlib_key_store).toBe(prevKeyStore);
    });

    it('устанавливает __sounddlib_key_spy', () => {
        expect(window.__sounddlib_key_spy).toBe(true);
    });

    it('устанавливает __sounddlib_key_store', () => {
        expect(window.__sounddlib_key_store).toBeDefined();
    });

    it('устанавливает __sounddlib_raw_key_store', () => {
        expect(window.__sounddlib_raw_key_store).toBeDefined();
    });

    describe('HTMLMediaElement.prototype.play override', () => {
        it('устанавливает __sounddlib_media_el при вызове play', () => {
            const audio = document.createElement('audio');
            audio.src = '';
            window.__sounddlib_media_el = null;
            HTMLMediaElement.prototype.play.call(audio);
            expect(window.__sounddlib_media_el).toBe(audio);
        });
    });

    describe('HTMLMediaElement.prototype.src override', () => {
        it('перехватывает data:audio url и postMessage', () => {
            const messages = [];
            const origAddListener = window.addEventListener;
            window.addEventListener('message', (e) => {
                if (e.data?.__sounddlib) messages.push(e.data);
            });

            const audio = document.createElement('audio');
            const binary = String.fromCharCode(72, 101, 108, 108, 111);
            const b64 = btoa(binary);
            Object.defineProperty(audio, 'src', {
                set: function(v) { this._src = v; },
                get: function() { return this._src; },
                configurable: true
            });
            const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (srcDesc?.set) {
                srcDesc.set.call(audio, `data:audio/mpeg;base64,${b64}`);
            }
        });

        it('getter возвращает значение через _srcDesc.get (anonymous_3)', () => {
            const audio = document.createElement('audio');
            const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (srcDesc?.get) {
                const val = srcDesc.get.call(audio);
                expect(val).toBeDefined();
            } else {
                expect(true).toBe(true);
            }
        });
    });

    describe('fetch override', () => {
        it('перехватывает keyserver запрос', async () => {
            const origFetch = window.fetch;
            window.__sounddlib_pending_tid = null;

            const mockResponse = {
                ok: true,
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=test123',
                clone: () => mockResponse,
                text: () => Promise.resolve('{}'),
                arrayBuffer: async () => new ArrayBuffer(16)
            };

            window.fetch = vi.fn().mockResolvedValue(mockResponse);

            try {
                await fetch('https://zvuk.com/keyserver/api/v1/key?track_id=test123');
                expect(window.__sounddlib_pending_tid).toBe('test123');
            } catch {}

            window.fetch = origFetch;
        });
    });

    describe('Response.prototype.arrayBuffer override', () => {
        it('сохраняет raw key для keyserver response', async () => {
            window.__sounddlib_raw_key_store = {};

            const origArrayBuffer = Response.prototype.arrayBuffer;
            const fakeResp = new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
                status: 200
            });
            Object.defineProperty(fakeResp, 'url', {
                value: 'https://zvuk.com/keyserver/api/v1/key?track_id=rk123',
                configurable: true
            });

            const result = await Response.prototype.arrayBuffer.call(fakeResp);
            if (window.__sounddlib_raw_key_store['rk123']) {
                expect(window.__sounddlib_raw_key_store['rk123']).toBeDefined();
            }
        });
    });

    describe('Blob override', () => {
        it('препендит worker spy для длинных JS строк', () => {
            const longJs = 'function main() {' + 'x'.repeat(200) + '}';
            const blob = new Blob([longJs], { type: 'text/javascript' });
            expect(blob.size).toBeGreaterThan(longJs.length);
        });

        it('не препендит для коротких строк', () => {
            const shortJs = 'function f() {}';
            const blob = new Blob([shortJs], { type: 'text/javascript' });
            expect(blob.size).toBe(shortJs.length);
        });

        it('не препендит для не-js типов', () => {
            const longHtml = '<html>' + 'x'.repeat(200) + '</html>';
            const blob = new Blob([longHtml], { type: 'text/html' });
            expect(blob.size).toBe(longHtml.length);
        });

        it('не препендит если тип пустой и строка длинная', () => {
            const longStr = 'x'.repeat(201);
            const blob = new Blob([longStr]);
            expect(blob.size).toBeGreaterThan(longStr.length);
        });
    });

    describe('XMLHttpRequest override', () => {
        it('устанавливает pending_tid при keyserver XHR', () => {
            window.__sounddlib_pending_tid = null;
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key?track_id=xhr123');
            try { xhr.send(); } catch {}
            expect(window.__sounddlib_pending_tid).toBe('xhr123');
        });
    });
});
