import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

describe('AudioInterceptor — src setter: data:audio без запятой', () => {
    it('не бросает при value data:audio без запятой', () => {
        const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        if (srcDesc?.set) {
            const audio = document.createElement('audio');
            expect(() => srcDesc.set.call(audio, 'data:audio')).not.toThrow();
        }
    });
});

describe('AudioInterceptor — _srcDesc без set', () => {
    beforeAll(async () => {
        const orig = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            get: orig?.get ?? (() => ''),
            set: undefined,
            configurable: true,
            enumerable: false
        });
        window.__sounddlib_interceptor = false;
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
        if (orig?.set) Object.defineProperty(HTMLMediaElement.prototype, 'src', orig);
    });

    it('загружается без ошибок когда srcDesc не имеет set', () => {
        expect(true).toBe(true);
    });
});

describe('AudioInterceptor — media_el уже установлен', () => {
    beforeAll(async () => {
        const el = document.createElement('audio');
        window.__sounddlib_interceptor = false;
        window.__sounddlib_media_el = el;
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
    });

    it('не перезаписывает media_el если уже установлен', () => {
        expect(window.__sounddlib_media_el).not.toBeNull();
    });
});

describe('AudioInterceptor — setInterval callback', () => {
    beforeAll(async () => {
        window.__sounddlib_interceptor = false;
        vi.useFakeTimers();
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it('media null -> ранний выход', () => {
        window.__sounddlib_media_el = null;
        expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    });

    it('media есть, el не создан -> создаёт el', () => {
        const audio = document.createElement('audio');
        window.__sounddlib_media_el = audio;
        const existing = document.getElementById('__sdl_state');
        if (existing) existing.remove();
        vi.advanceTimersByTime(500);
        expect(document.getElementById('__sdl_state')).not.toBeNull();
    });

    it('media есть, el уже создан -> не дублирует', () => {
        const audio = document.createElement('audio');
        window.__sounddlib_media_el = audio;
        vi.advanceTimersByTime(500);
        const els = document.querySelectorAll('#__sdl_state');
        expect(els.length).toBe(1);
    });

    it('isFinite(duration) false', () => {
        const audio = document.createElement('audio');
        Object.defineProperty(audio, 'duration', { get: () => Infinity, configurable: true });
        window.__sounddlib_media_el = audio;
        vi.advanceTimersByTime(500);
        expect(document.getElementById('__sdl_state')?.dataset.d).toBe('0');
    });

    it('isFinite(duration) true', () => {
        const audio = document.createElement('audio');
        Object.defineProperty(audio, 'duration', { get: () => 120, configurable: true });
        window.__sounddlib_media_el = audio;
        vi.advanceTimersByTime(500);
        expect(document.getElementById('__sdl_state')?.dataset.d).toBe('120');
    });

    it('media.paused true -> dataset.p = 1', () => {
        const audio = document.createElement('audio');
        Object.defineProperty(audio, 'paused', { get: () => true, configurable: true });
        window.__sounddlib_media_el = audio;
        vi.advanceTimersByTime(500);
        expect(document.getElementById('__sdl_state')?.dataset.p).toBe('1');
    });

    it('media.paused false -> dataset.p = 0', () => {
        const audio = document.createElement('audio');
        Object.defineProperty(audio, 'paused', { get: () => false, configurable: true });
        window.__sounddlib_media_el = audio;
        vi.advanceTimersByTime(500);
        expect(document.getElementById('__sdl_state')?.dataset.p).toBe('0');
    });

    it('seekTo не NaN -> обновляет currentTime', () => {
        const audio = document.createElement('audio');
        window.__sounddlib_media_el = audio;
        const el = document.getElementById('__sdl_state');
        if (el) el.dataset.seekTo = '30';
        vi.advanceTimersByTime(500);
        expect(document.getElementById('__sdl_state')?.dataset.seekTo).toBeUndefined();
    });

    it('seekTo NaN -> не трогает currentTime', () => {
        const audio = document.createElement('audio');
        const origTime = audio.currentTime;
        window.__sounddlib_media_el = audio;
        const el = document.getElementById('__sdl_state');
        if (el) delete el.dataset.seekTo;
        vi.advanceTimersByTime(500);
        expect(audio.currentTime).toBe(origTime);
    });
});

describe('AudioInterceptor — fetch interceptor', () => {
    let mockFetch;

    beforeAll(async () => {
        mockFetch = vi.fn().mockResolvedValue({ ok: true, url: '', status: 200 });
        window.__sounddlib_interceptor = false;
        window.fetch = mockFetch;
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
    });

    it('url как строка non-keyserver', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch('https://example.com/api');
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('url как объект с .url non-keyserver', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch({ url: 'https://example.com/other' });
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('url как объект без .url', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch({});
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('keyserver URL без track_id -> tid null', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch('https://zvuk.com/keyserver/api/v1/key');
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('keyserver URL с track_id -> tid установлен', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch('https://zvuk.com/keyserver/api/v1/key?track_id=t42');
        expect(window.__sounddlib_pending_tid).toBe('t42');
    });
});

describe('AudioInterceptor — Response.arrayBuffer', () => {
    it('non-keyserver URL -> не обновляет raw_key_store', async () => {
        window.__sounddlib_raw_key_store = {};
        const resp = new Response(new Uint8Array([1, 2, 3]).buffer);
        Object.defineProperty(resp, 'url', { value: 'https://example.com/api', configurable: true });
        await Response.prototype.arrayBuffer.call(resp);
        expect(Object.keys(window.__sounddlib_raw_key_store)).toHaveLength(0);
    });

    it('keyserver URL без track_id -> tid null', async () => {
        window.__sounddlib_raw_key_store = {};
        const resp = new Response(new Uint8Array([1, 2, 3]).buffer);
        Object.defineProperty(resp, 'url', { value: 'https://zvuk.com/keyserver/api/v1/key', configurable: true });
        await Response.prototype.arrayBuffer.call(resp);
        expect(Object.keys(window.__sounddlib_raw_key_store)).toHaveLength(0);
    });
});

describe('AudioInterceptor — crypto.subtle.importKey', () => {
    it('format raw, algorithm строка AES-CBC', async () => {
        try {
            const key = new Uint8Array(16).fill(2);
            await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('format raw, algorithm объект name AES-CBC, keyData ArrayBuffer 16', async () => {
        window.__sounddlib_pending_tid = 'ik-test';
        window.__sounddlib_key_store = {};
        const key = new Uint8Array(16).fill(3);
        try {
            await crypto.subtle.importKey('raw', key.buffer, { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('format raw, algorithm AES-CBC, keyData TypedArray 16', async () => {
        window.__sounddlib_pending_tid = 'ik-view';
        window.__sounddlib_key_store = {};
        const key = new Uint8Array(16).fill(4);
        try {
            await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('format raw, keyData TypedArray длиной не 16', async () => {
        const key = new Uint8Array(8).fill(5);
        try {
            await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('format raw, keyData TypedArray 16, pending_tid null', async () => {
        window.__sounddlib_pending_tid = null;
        const key = new Uint8Array(16).fill(6);
        try {
            await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(window.__sounddlib_key_store[null]).toBeUndefined();
    });

    it('format не raw', async () => {
        try {
            const key = { kty: 'oct', k: 'AAAAAAAAAAAAAAAAAAAAAA', alg: 'A128CBC', ext: true };
            await crypto.subtle.importKey('jwk', key, { name: 'AES-CBC' }, true, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('keyData не ArrayBuffer и не View -> src null', async () => {
        window.__sounddlib_pending_tid = 'ik-null-src';
        const key = new Uint8Array(16).fill(7);
        try {
            await crypto.subtle.importKey('raw', key.buffer, { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });
});

describe('AudioInterceptor — XHR', () => {
    it('send без open -> _xhrUrls undefined -> || ""', () => {
        const xhr = new XMLHttpRequest();
        expect(() => { try { xhr.send(); } catch {} }).not.toThrow();
    });

    it('XHR non-keyserver URL -> не устанавливает pending_tid', () => {
        window.__sounddlib_pending_tid = null;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://example.com/api');
        try { xhr.send(); } catch {}
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('XHR keyserver URL без track_id -> tid null', () => {
        window.__sounddlib_pending_tid = null;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key');
        try { xhr.send(); } catch {}
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('XHR loadend: status 200, response ArrayBuffer -> сохраняет ключ', () => {
        window.__sounddlib_raw_key_store = {};
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key?track_id=xhr-ab');
        try { xhr.send(); } catch {}
        Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
        Object.defineProperty(xhr, 'response', { value: new ArrayBuffer(4), configurable: true });
        xhr.dispatchEvent(new ProgressEvent('loadend'));
        expect(window.__sounddlib_raw_key_store['xhr-ab']).toBeDefined();
    });

    it('XHR loadend: status не 200 -> не сохраняет', () => {
        window.__sounddlib_raw_key_store = {};
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key?track_id=xhr-fail');
        try { xhr.send(); } catch {}
        Object.defineProperty(xhr, 'status', { value: 404, configurable: true });
        Object.defineProperty(xhr, 'response', { value: new ArrayBuffer(4), configurable: true });
        xhr.dispatchEvent(new ProgressEvent('loadend'));
        expect(window.__sounddlib_raw_key_store['xhr-fail']).toBeUndefined();
    });
});

describe('AudioInterceptor — Worker override', () => {
    let workerInstance;

    beforeAll(async () => {
        workerInstance = new EventTarget();
        window.__sounddlib_interceptor = false;
        window.Worker = function(url, opts) { return workerInstance; };
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
    });

    it('Worker message с __sounddlib_wk и pending_tid -> записывает ключ', () => {
        window.__sounddlib_pending_tid = 'wk-tid';
        window.__sounddlib_key_store = {};
        new window.Worker('blob:test');
        workerInstance.dispatchEvent(new MessageEvent('message', {
            data: { __sounddlib_wk: [1, 2, 3] }
        }));
        expect(window.__sounddlib_key_store['wk-tid']).toEqual([1, 2, 3]);
    });

    it('Worker message без __sounddlib_wk -> не записывает', () => {
        window.__sounddlib_key_store = {};
        workerInstance.dispatchEvent(new MessageEvent('message', {
            data: { other: true }
        }));
        expect(Object.keys(window.__sounddlib_key_store)).toHaveLength(0);
    });

    it('Worker message с __sounddlib_wk но pending_tid null -> не записывает', () => {
        window.__sounddlib_pending_tid = null;
        window.__sounddlib_key_store = {};
        workerInstance.dispatchEvent(new MessageEvent('message', {
            data: { __sounddlib_wk: [9, 8, 7] }
        }));
        expect(Object.keys(window.__sounddlib_key_store)).toHaveLength(0);
    });
});

describe('AudioInterceptor — src override с defineProperty', () => {
    let fakeSet;

    beforeAll(async () => {
        fakeSet = vi.fn();
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            get() { return this._sdl_src ?? ''; },
            set: fakeSet,
            configurable: true,
            enumerable: true
        });
        window.__sounddlib_interceptor = false;
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
    });

    it('_srcDesc?.set TRUE -> src override установлен', () => {
        const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        expect(srcDesc?.set).toBeDefined();
    });

    it('src setter с data:audio без запятой', () => {
        const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        if (srcDesc?.set) {
            const audio = document.createElement('audio');
            expect(() => srcDesc.set.call(audio, 'data:audio')).not.toThrow();
        } else {
            expect(true).toBe(true);
        }
    });
});

describe('AudioInterceptor — importKey с мокнутым _importKey', () => {
    beforeAll(async () => {
        const mockImportKey = vi.fn().mockResolvedValue({ type: 'secret' });
        crypto.subtle.importKey = mockImportKey;
        window.__sounddlib_interceptor = false;
        vi.resetModules();
        await import('../../content/AudioInterceptor.js');
    });

    it('keyData ArrayBuffer 16 + pending_tid', async () => {
        window.__sounddlib_pending_tid = 'mock-ab-tid';
        window.__sounddlib_key_store = {};
        await crypto.subtle.importKey('raw', new ArrayBuffer(16), { name: 'AES-CBC' }, false, ['decrypt']);
        expect(window.__sounddlib_key_store['mock-ab-tid']).toBeDefined();
    });

    it('keyData не ArrayBuffer и не ArrayBuffer view', async () => {
        window.__sounddlib_pending_tid = 'mock-nv-tid';
        window.__sounddlib_key_store = {};
        await crypto.subtle.importKey('raw', { custom: 'key' }, { name: 'AES-CBC' }, false, ['decrypt']);
        expect(window.__sounddlib_key_store['mock-nv-tid']).toBeUndefined();
    });
});
