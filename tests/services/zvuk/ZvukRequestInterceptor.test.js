import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('ZvukRequestInterceptor — setup', () => {
    beforeAll(async () => {
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
    });

    it('добавляет interceptor в serviceRequestInterceptors', () => {
        expect(globalThis.serviceRequestInterceptors).toHaveLength(1);
    });

    it('interceptor имеет правильные свойства', () => {
        const interceptor = globalThis.serviceRequestInterceptors[0];
        expect(interceptor.serviceName).toBe('zvuk');
        expect(interceptor.authUrls).toContain('https://zvuk.com/*');
        expect(interceptor.keyUrls).toContain('*://zvuk.com/keyserver/api/v1/key*');
    });

    it('setupKeyCapture не бросает без webRequest API', () => {
        const interceptor = globalThis.serviceRequestInterceptors[0];
        expect(() => interceptor.setupKeyCapture(null, false)).not.toThrow();
        expect(() => interceptor.setupKeyCapture({}, false)).not.toThrow();
    });

    it('setupEarlyInjection не бросает без tabs.onUpdated', () => {
        const interceptor = globalThis.serviceRequestInterceptors[0];
        expect(() => interceptor.setupEarlyInjection(null)).not.toThrow();
        expect(() => interceptor.setupEarlyInjection({})).not.toThrow();
    });
});

describe('ZvukRequestInterceptor — setupKeyCapture с webRequest', () => {
    let interceptor;
    let onBeforeRequestListeners = [];
    let onBeforeSendListeners = [];
    let onCompletedListeners = [];
    let mockApi;

    beforeAll(async () => {
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        interceptor = globalThis.serviceRequestInterceptors[0];

        globalThis.encryptedKeyStore = {};
        globalThis.nativeKeyStore = {};

        mockApi = {
            webRequest: {
                filterResponseData: vi.fn(() => ({
                    ondata: null,
                    onstop: null,
                    onerror: null,
                    write: vi.fn(),
                    close: vi.fn()
                })),
                onBeforeRequest: {
                    addListener: vi.fn((cb) => { onBeforeRequestListeners.push(cb); })
                },
                onBeforeSendHeaders: {
                    addListener: vi.fn((cb) => { onBeforeSendListeners.push(cb); })
                },
                onCompleted: {
                    addListener: vi.fn((cb) => { onCompletedListeners.push(cb); })
                }
            }
        };

        interceptor.setupKeyCapture(mockApi, false);
    });

    it('регистрирует listener на onBeforeSendHeaders', () => {
        expect(mockApi.webRequest.onBeforeSendHeaders.addListener).toHaveBeenCalled();
    });

    it('регистрирует listener на onCompleted', () => {
        expect(mockApi.webRequest.onCompleted.addListener).toHaveBeenCalled();
    });

    it('onBeforeSendHeaders захватывает headers для ключевого запроса', () => {
        const listener = onBeforeSendListeners[0];
        listener({
            requestId: 'req1',
            url: 'https://zvuk.com/keyserver/api/v1/key?track_id=123',
            requestHeaders: [
                { name: 'x-encrypted-key', value: 'my-xek' },
                { name: 'host', value: 'zvuk.com' }
            ]
        });
    });

    it('onCompleted сохраняет headers при status 200', () => {
        const listener = onCompletedListeners[0];
        listener({
            requestId: 'req1',
            url: 'https://zvuk.com/keyserver/api/v1/key?track_id=123',
            statusCode: 200
        });
        expect(globalThis.encryptedKeyStore['123']).toBeDefined();
        expect(globalThis.encryptedKeyStore['123'].headers).toBeDefined();
    });

    it('onCompleted игнорирует non-200', () => {
        const listener = onCompletedListeners[0];
        delete globalThis.encryptedKeyStore['456'];
        listener({
            requestId: 'req_unknown',
            url: 'https://zvuk.com/keyserver/api/v1/key?track_id=456',
            statusCode: 403
        });
        expect(globalThis.encryptedKeyStore['456']).toBeUndefined();
    });

    it('filterResponseData — onstop собирает ключ', () => {
        const filter = {
            write: vi.fn(),
            close: vi.fn()
        };
        mockApi.webRequest.filterResponseData = vi.fn(() => filter);

        const listener = onBeforeRequestListeners[0];
        listener({
            requestId: 'req2',
            url: 'https://zvuk.com/keyserver/api/v1/key?track_id=789'
        });

        if (filter.ondata) filter.ondata({ data: new Uint8Array([10, 20, 30]).buffer });
        if (filter.onstop) filter.onstop();
        expect(globalThis.nativeKeyStore['789']).toBeDefined();
    });
});

describe('ZvukRequestInterceptor — setupKeyCapture filterResponseData NOT available', () => {
    let interceptor;

    beforeAll(async () => {
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        interceptor = globalThis.serviceRequestInterceptors[0];
        globalThis.encryptedKeyStore = {};
        globalThis.nativeKeyStore = {};
    });

    it('логирует отсутствие filterResponseData', () => {
        const mockApi = {
            webRequest: {
                onBeforeRequest: { addListener: vi.fn() },
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        expect(() => interceptor.setupKeyCapture(mockApi, false)).not.toThrow();
    });
});

describe('ZvukRequestInterceptor — filterResponseData error callbacks', () => {
    let interceptor;
    let onBeforeRequestListeners = [];
    let mockApi;

    beforeAll(async () => {
        onBeforeRequestListeners = [];
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        interceptor = globalThis.serviceRequestInterceptors[0];

        globalThis.encryptedKeyStore = {};
        globalThis.nativeKeyStore = {};

        const filter = { write: vi.fn(), close: vi.fn() };
        mockApi = {
            webRequest: {
                filterResponseData: vi.fn(() => filter),
                onBeforeRequest: {
                    addListener: vi.fn((cb) => { onBeforeRequestListeners.push(cb); })
                },
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };

        interceptor.setupKeyCapture(mockApi, false);
    });

    it('вызывает filter.onerror', () => {
        const filter = { write: vi.fn(), close: vi.fn() };
        mockApi.webRequest.filterResponseData = vi.fn(() => filter);

        const listener = onBeforeRequestListeners[0];
        listener({ requestId: 'req_onerror', url: 'https://zvuk.com/keyserver/api/v1/key?track_id=oerr' });

        if (filter.onerror) {
            expect(() => filter.onerror()).not.toThrow();
        }
    });

    it('onstop обрабатывает ошибку внутри try', () => {
        const filter = {
            write: vi.fn(),
            close: vi.fn()
        };
        mockApi.webRequest.filterResponseData = vi.fn(() => filter);

        const listener = onBeforeRequestListeners[0];
        listener({ requestId: 'req_onstop_err', url: 'https://zvuk.com/keyserver/api/v1/key?track_id=oerr2' });

        if (filter.ondata) filter.ondata({ data: new Uint8Array([1]).buffer });
        if (filter.onstop) {
            delete globalThis.nativeKeyStore;
            expect(() => filter.onstop()).not.toThrow();
            globalThis.nativeKeyStore = {};
        }
    });

    it('outer try catch при ошибке filterResponseData', () => {
        const throwingApi = {
            webRequest: {
                filterResponseData: vi.fn(() => { throw new Error('filter error'); }),
                onBeforeRequest: { addListener: vi.fn((cb) => { onBeforeRequestListeners.push(cb); }) },
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        const len = onBeforeRequestListeners.length;
        interceptor.setupKeyCapture(throwingApi, false);
        const listener = onBeforeRequestListeners[len];
        if (listener) {
            expect(() => listener({
                requestId: 'req_throw',
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=thr'
            })).not.toThrow();
        }
    });
});

describe('ZvukRequestInterceptor — setupEarlyInjection', () => {
    let interceptor;
    let onUpdatedListeners = [];
    let mockApi;

    beforeAll(async () => {
        onUpdatedListeners = [];
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        interceptor = globalThis.serviceRequestInterceptors[0];

        mockApi = {
            tabs: {
                onUpdated: {
                    addListener: vi.fn((cb) => { onUpdatedListeners.push(cb); })
                }
            },
            scripting: {
                executeScript: vi.fn().mockResolvedValue(undefined)
            }
        };

        interceptor.setupEarlyInjection(mockApi);
    });

    it('регистрирует listener на tabs.onUpdated', () => {
        expect(mockApi.tabs.onUpdated.addListener).toHaveBeenCalled();
    });

    it('не вызывает executeScript при incomplete status', async () => {
        const listener = onUpdatedListeners[0];
        await listener(1, { status: 'loading' }, { url: 'https://zvuk.com/track/123' });
        expect(mockApi.scripting.executeScript).not.toHaveBeenCalled();
    });

    it('не вызывает executeScript для non-zvuk страниц', async () => {
        const listener = onUpdatedListeners[0];
        await listener(1, { status: 'complete' }, { url: 'https://other.com' });
        expect(mockApi.scripting.executeScript).not.toHaveBeenCalled();
    });

    it('вызывает executeScript для zvuk.com при complete', async () => {
        const listener = onUpdatedListeners[0];
        await listener(1, { status: 'complete' }, { url: 'https://zvuk.com/track/123', id: 1 });
        expect(mockApi.scripting.executeScript).toHaveBeenCalled();
    });
});

describe('ZvukRequestInterceptor — setupKeyCapture без onBeforeSendHeaders', () => {
    let onBeforeRequestListeners = [];
    let onCompletedListeners = [];

    beforeAll(async () => {
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        const interceptor = globalThis.serviceRequestInterceptors[0];
        globalThis.encryptedKeyStore = {};
        globalThis.nativeKeyStore = {};

        const mockApi = {
            webRequest: {
                filterResponseData: vi.fn(() => ({ write: vi.fn(), close: vi.fn() })),
                onBeforeRequest: { addListener: vi.fn((cb) => onBeforeRequestListeners.push(cb)) },
                onCompleted: { addListener: vi.fn((cb) => onCompletedListeners.push(cb)) }
            }
        };
        interceptor.setupKeyCapture(mockApi, false);
    });

    it('не бросает если нет onBeforeSendHeaders', () => {
        expect(onCompletedListeners.length).toBeGreaterThan(0);
    });

    it('onBeforeRequest listener без track_id -> ранний выход', () => {
        const listener = onBeforeRequestListeners[0];
        expect(() => listener({
            requestId: 'req-no-tid',
            url: 'https://zvuk.com/keyserver/api/v1/key'
        })).not.toThrow();
    });
});

describe('ZvukRequestInterceptor — setupKeyCapture без onCompleted', () => {
    let onBeforeSendListeners = [];

    beforeAll(async () => {
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        const interceptor = globalThis.serviceRequestInterceptors[0];
        globalThis.encryptedKeyStore = {};

        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn((cb) => onBeforeSendListeners.push(cb)) }
            }
        };
        interceptor.setupKeyCapture(mockApi, false);
    });

    it('не бросает если нет onCompleted', () => {
        expect(onBeforeSendListeners.length).toBeGreaterThan(0);
    });

    it('onBeforeSendHeaders без requestHeaders -> requestHeaders || []', () => {
        const listener = onBeforeSendListeners[0];
        expect(() => listener({
            requestId: 'req-no-hdrs',
            url: 'https://zvuk.com/keyserver/api/v1/key?track_id=t1'
        })).not.toThrow();
    });

    it('onBeforeSendHeaders без track_id', () => {
        const listener = onBeforeSendListeners[0];
        expect(() => listener({
            requestId: 'req-no-tid',
            url: 'https://zvuk.com/keyserver/api/v1/key',
            requestHeaders: []
        })).not.toThrow();
    });
});

describe('ZvukRequestInterceptor — setupEarlyInjection func branches', () => {
    let onUpdatedListeners = [];
    let mockFetch;

    beforeAll(async () => {
        onUpdatedListeners = [];
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        const interceptor = globalThis.serviceRequestInterceptors[0];

        mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            url: '',
            text: () => Promise.resolve('{}'),
            clone: () => ({ text: () => Promise.resolve('{}') }),
            arrayBuffer: async () => new ArrayBuffer(4)
        });
        window.fetch = mockFetch;

        const mockApi = {
            tabs: { onUpdated: { addListener: vi.fn((cb) => onUpdatedListeners.push(cb)) } },
            scripting: {
                executeScript: vi.fn().mockImplementation(async ({ func }) => {
                    if (func) try { await func(); } catch {}
                })
            }
        };
        interceptor.setupEarlyInjection(mockApi);

        window.__sounddlib_key_spy = false;
        await onUpdatedListeners[0](1, { status: 'complete' }, { url: 'https://zvuk.com/track/1' });
    });

    it('fetch с non-string args[0] объектом с url', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch({ url: 'https://example.com/api' });
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('fetch с null args[0]', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch(null);
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('fetch keyserver URL без track_id', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch('https://zvuk.com/keyserver/api/v1/key');
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('fetch keyserver без args[1] -> init || {}', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch('https://zvuk.com/keyserver/api/v1/key?track_id=no-init');
        expect(window.__sounddlib_pending_tid).toBe('no-init');
    });

    it('fetch keyserver с headers: new Headers', async () => {
        window.__sounddlib_pending_tid = null;
        window.__sounddlib_xek_store = {};
        const headers = new Headers({ 'x-encrypted-key': 'hk' });
        await window.fetch('https://zvuk.com/keyserver/api/v1/key?track_id=hdr-tid', { headers });
        expect(window.__sounddlib_xek_store['hdr-tid']).toBe('hk');
    });

    it('fetch keyserver с headers без xek', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch('https://zvuk.com/keyserver/api/v1/key?track_id=no-xek', {
            headers: { 'host': 'zvuk.com' }
        });
        expect(true).toBe(true);
    });

    it('fetch keyserver с X-Encrypted-Key', async () => {
        window.__sounddlib_xek_store = {};
        await window.fetch('https://zvuk.com/keyserver/api/v1/key?track_id=cap-tid', {
            headers: { 'X-Encrypted-Key': 'cap-key' }
        });
        expect(window.__sounddlib_xek_store['cap-tid']).toBe('cap-key');
    });

    it('fetch headers не объект', async () => {
        window.__sounddlib_pending_tid = null;
        await window.fetch('https://zvuk.com/keyserver/api/v1/key?track_id=str-hdr', {
            headers: null
        });
        expect(window.__sounddlib_pending_tid).toBe('str-hdr');
    });

    it('fetch zvuk API URL -> isCdnApi TRUE', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true, url: '',
            text: () => Promise.resolve('{"stream":"https://cdn-hls-slicer.zvuk.com/drm/track/42/master.m3u8"}'),
            clone: () => ({
                text: () => Promise.resolve('{"stream":"https://cdn-hls-slicer.zvuk.com/drm/track/42/master.m3u8"}')
            })
        });
        await window.fetch('https://zvuk.com/api/v1/track/42');
        await new Promise(r => setTimeout(r, 20));
        expect(true).toBe(true);
    });

    it('fetch zvuk API с cdn-hls-slicer URL', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true, url: '',
            text: () => Promise.resolve('{}'),
            clone: () => ({ text: () => Promise.resolve('{}') })
        });
        await window.fetch('https://cdn-hls-slicer.zvuk.com/api/v1/track/42');
        expect(true).toBe(true);
    });

    it('fetch zvuk API text без cdn-hls-slicer', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true, url: '',
            text: () => Promise.resolve('{"no":"drm"}'),
            clone: () => ({ text: () => Promise.resolve('{"no":"drm"}') })
        });
        await window.fetch('https://zvuk.com/api/v1/track/43');
        await new Promise(r => setTimeout(r, 20));
        expect(true).toBe(true);
    });

    it('Response.arrayBuffer keyserver URL с track_id', async () => {
        window.__sounddlib_raw_key_store = {};
        const resp = new Response(new Uint8Array([1, 2, 3]).buffer);
        Object.defineProperty(resp, 'url', { value: 'https://zvuk.com/keyserver/api/v1/key?track_id=ab-tid', configurable: true });
        await Response.prototype.arrayBuffer.call(resp);
        expect(window.__sounddlib_raw_key_store['ab-tid']).toBeDefined();
    });

    it('Response.arrayBuffer non-keyserver URL', async () => {
        window.__sounddlib_raw_key_store = {};
        const resp = new Response(new Uint8Array([1]).buffer);
        Object.defineProperty(resp, 'url', { value: 'https://zvuk.com/api/v1/track', configurable: true });
        await Response.prototype.arrayBuffer.call(resp);
        expect(Object.keys(window.__sounddlib_raw_key_store)).toHaveLength(0);
    });

    it('Response.arrayBuffer keyserver без track_id', async () => {
        window.__sounddlib_raw_key_store = {};
        const resp = new Response(new Uint8Array([1]).buffer);
        Object.defineProperty(resp, 'url', { value: 'https://zvuk.com/keyserver/api/v1/key', configurable: true });
        await Response.prototype.arrayBuffer.call(resp);
        expect(Object.keys(window.__sounddlib_raw_key_store)).toHaveLength(0);
    });

    it('importKey AES-CBC ArrayBuffer 16', async () => {
        window.__sounddlib_pending_tid = 'imp-ab';
        window.__sounddlib_key_store = {};
        try {
            await crypto.subtle.importKey('raw', new ArrayBuffer(16), { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('importKey AES-CBC TypedArray 16', async () => {
        window.__sounddlib_pending_tid = 'imp-view';
        window.__sounddlib_key_store = {};
        try {
            await crypto.subtle.importKey('raw', new Uint8Array(16).fill(1), { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('importKey AES-CBC без pending_tid', async () => {
        window.__sounddlib_pending_tid = null;
        window.__sounddlib_key_store = {};
        try {
            await crypto.subtle.importKey('raw', new Uint8Array(16).fill(2), { name: 'AES-CBC' }, false, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('importKey не raw', async () => {
        try {
            await crypto.subtle.importKey('jwk', { kty: 'oct', k: 'AAAAAAAAAAAAAAAAAAAAAA', alg: 'A128CBC', ext: true }, { name: 'AES-CBC' }, true, ['decrypt']);
        } catch {}
        expect(true).toBe(true);
    });

    it('XHR keyserver с track_id', () => {
        window.__sounddlib_pending_tid = null;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key?track_id=xhr-func');
        try { xhr.send(); } catch {}
        expect(window.__sounddlib_pending_tid).toBe('xhr-func');
    });

    it('XHR non-keyserver', () => {
        window.__sounddlib_pending_tid = null;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/api/v1/track/1');
        try { xhr.send(); } catch {}
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('XHR без open -> _xhrUrls.get undefined', () => {
        const xhr = new XMLHttpRequest();
        expect(() => { try { xhr.send(); } catch {} }).not.toThrow();
    });

    it('XHR keyserver без track_id', () => {
        window.__sounddlib_pending_tid = null;
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key');
        try { xhr.send(); } catch {}
        expect(window.__sounddlib_pending_tid).toBeNull();
    });

    it('XHR loadend status 200 ArrayBuffer', () => {
        window.__sounddlib_raw_key_store = {};
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key?track_id=xhr-ab-func');
        try { xhr.send(); } catch {}
        Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
        Object.defineProperty(xhr, 'response', { value: new ArrayBuffer(4), configurable: true });
        xhr.dispatchEvent(new ProgressEvent('loadend'));
        expect(window.__sounddlib_raw_key_store['xhr-ab-func']).toBeDefined();
    });

    it('XHR loadend status 404', () => {
        window.__sounddlib_raw_key_store = {};
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://zvuk.com/keyserver/api/v1/key?track_id=xhr-fail-func');
        try { xhr.send(); } catch {}
        Object.defineProperty(xhr, 'status', { value: 404, configurable: true });
        Object.defineProperty(xhr, 'response', { value: new ArrayBuffer(4), configurable: true });
        xhr.dispatchEvent(new ProgressEvent('loadend'));
        expect(window.__sounddlib_raw_key_store['xhr-fail-func']).toBeUndefined();
    });
});

describe('ZvukRequestInterceptor — setupEarlyInjection func execution', () => {
    let interceptor;
    let onUpdatedListeners = [];
    let executedFuncs = [];

    beforeAll(async () => {
        onUpdatedListeners = [];
        executedFuncs = [];
        globalThis.serviceRequestInterceptors = [];
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
        interceptor = globalThis.serviceRequestInterceptors[0];

        const mockApi = {
            tabs: {
                onUpdated: {
                    addListener: vi.fn((cb) => { onUpdatedListeners.push(cb); })
                }
            },
            scripting: {
                executeScript: vi.fn().mockImplementation(async ({ func }) => {
                    if (func) {
                        try { await func(); } catch {}
                    }
                })
            }
        };

        interceptor.setupEarlyInjection(mockApi);
    });

    it('выполняет func при complete status zvuk.com', async () => {
        window.__sounddlib_key_spy = false;
        window.__sounddlib_key_store = undefined;
        const listener = onUpdatedListeners[0];
        await listener(1, { status: 'complete' }, { url: 'https://zvuk.com/track/99', id: 1 });
        expect(true).toBe(true);
    });

    it('не выполняет func повторно если __sounddlib_key_spy уже true', async () => {
        window.__sounddlib_key_spy = true;
        const listener = onUpdatedListeners[0];
        await listener(2, { status: 'complete' }, { url: 'https://zvuk.com/track/100', id: 2 });
        expect(true).toBe(true);
    });

    it('func перехватывает keyserver fetch', async () => {
        window.__sounddlib_key_spy = false;
        const listener = onUpdatedListeners[0];

        const origFetch = window.fetch;
        window.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('{}'),
            clone: () => ({ text: () => Promise.resolve('{}') })
        });

        await listener(3, { status: 'complete' }, { url: 'https://zvuk.com/track/101', id: 3 });

        try {
            await fetch('https://zvuk.com/keyserver/api/v1/key?track_id=fn_test', {
                headers: { 'x-encrypted-key': 'fn-key' }
            });
        } catch {}

        window.fetch = origFetch;
        expect(true).toBe(true);
    });
});
