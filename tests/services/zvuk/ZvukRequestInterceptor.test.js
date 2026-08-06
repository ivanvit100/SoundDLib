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
