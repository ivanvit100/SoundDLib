import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadModule } from '../../helpers/loadModule.js';

describe('ZvukRequestInterceptor — setup', () => {
    beforeAll(() => {
        globalThis.serviceRequestInterceptors = [];
        loadModule('services/zvuk/ZvukRequestInterceptor.js');
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

    beforeAll(() => {
        globalThis.serviceRequestInterceptors = [];
        loadModule('services/zvuk/ZvukRequestInterceptor.js');
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

describe('ZvukRequestInterceptor — setupEarlyInjection', () => {
    let interceptor;
    let onUpdatedListeners = [];
    let mockApi;

    beforeAll(() => {
        globalThis.serviceRequestInterceptors = [];
        loadModule('services/zvuk/ZvukRequestInterceptor.js');
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
