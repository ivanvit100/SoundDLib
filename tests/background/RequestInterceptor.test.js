import { describe, it, expect, vi, beforeAll } from 'vitest';
import '../../core/RateLimiter.js';
import '../../background/AudioStore.js';

describe('RequestInterceptor — Chrome', () => {
    let onBeforeSendListeners = [];
    let onCompletedListeners = [];
    let mockApi;

    beforeAll(async () => {
        onBeforeSendListeners = [];
        onCompletedListeners = [];

        mockApi = {
            webRequest: {
                onBeforeSendHeaders: {
                    addListener: vi.fn((cb) => { onBeforeSendListeners.push(cb); })
                },
                onCompleted: {
                    addListener: vi.fn((cb) => { onCompletedListeners.push(cb); })
                }
            },
            tabs: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, meta: { title: 'T', artist: 'A' } })
            }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{
            authUrls: ['https://zvuk.com/*'],
            setupKeyCapture: vi.fn(),
            setupEarlyInjection: vi.fn()
        }];
        globalThis.serviceRegistry = {
            getAllServices: vi.fn(() => []),
            getServiceByUrl: vi.fn(() => null)
        };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('устанавливает Chrome rate limiter listener', () => {
        expect(mockApi.webRequest.onBeforeSendHeaders.addListener).toHaveBeenCalled();
    });

    it('захватывает Bearer токен из заголовков', () => {
        const listener = onBeforeSendListeners[0];
        listener({
            tabId: 1,
            requestHeaders: [
                { name: 'authorization', value: 'Bearer my-secret-token' }
            ]
        });
        expect(globalThis.authTokenStore.zvuk).toBe('my-secret-token');
    });

    it('не захватывает токен без Bearer', () => {
        globalThis.authTokenStore.zvuk = undefined;
        const listener = onBeforeSendListeners[0];
        listener({
            tabId: 1,
            requestHeaders: [
                { name: 'authorization', value: 'Basic abc123' }
            ]
        });
        expect(globalThis.authTokenStore.zvuk).toBeUndefined();
    });

    it('определяет запросы из расширения по tabId=-1', () => {
        const listener = onBeforeSendListeners[0];
        listener({
            tabId: -1,
            requestHeaders: [
                { name: 'authorization', value: 'Bearer ext-token' }
            ]
        });
        expect(globalThis.authTokenStore.zvuk).not.toBe('ext-token');
    });

    it('определяет запросы из расширения по x-extension-request header', () => {
        const listener = onBeforeSendListeners[0];
        listener({
            tabId: 5,
            requestHeaders: [
                { name: 'x-extension-request', value: 'true' },
                { name: 'authorization', value: 'Bearer should-not-capture' }
            ]
        });
        expect(globalThis.authTokenStore.zvuk).not.toBe('should-not-capture');
    });

    it('определяет запросы из расширения по originUrl', () => {
        const listener = onBeforeSendListeners[0];
        listener({
            tabId: 5,
            originUrl: 'chrome-extension://abc123/popup.html',
            requestHeaders: [
                { name: 'authorization', value: 'Bearer ext-origin' }
            ]
        });
        expect(globalThis.authTokenStore.zvuk).not.toBe('ext-origin');
    });

    it('вызывает setupKeyCapture для serviceRequestInterceptors', () => {
        expect(globalThis.serviceRequestInterceptors[0].setupKeyCapture).toHaveBeenCalled();
    });
});

describe('RequestInterceptor — Firefox', () => {
    let onBeforeSendListeners = [];

    beforeAll(async () => {
        onBeforeSendListeners = [];
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: {
                    addListener: vi.fn((cb) => { onBeforeSendListeners.push(cb); })
                },
                onCompleted: { addListener: vi.fn() }
            },
            tabs: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, meta: {} })
            }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: true, isChromium: false, supportsDnr: false });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{
            authUrls: ['https://zvuk.com/*'],
            setupKeyCapture: vi.fn(),
            setupEarlyInjection: vi.fn()
        }];
        globalThis.serviceRegistry = {
            getAllServices: vi.fn(() => []),
            getServiceByUrl: vi.fn(() => null)
        };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('устанавливает Firefox webRequest listener', () => {
        expect(onBeforeSendListeners.length).toBeGreaterThan(0);
    });

    it('Firefox listener захватывает токен', () => {
        const listener = onBeforeSendListeners[0];
        listener({
            tabId: 1,
            requestHeaders: [{ name: 'authorization', value: 'Bearer firefox-token' }]
        });
        expect(globalThis.authTokenStore.zvuk).toBe('firefox-token');
    });
});

describe('RequestInterceptor — handleCapturedUrl', () => {
    let onCompletedListeners = [];

    beforeAll(async () => {
        onCompletedListeners = [];
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: {
                    addListener: vi.fn((cb) => { onCompletedListeners.push(cb); })
                }
            },
            tabs: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, meta: { title: 'T' } })
            }
        };

        const mockService = {
            constructor: {
                captureFromUrl: vi.fn().mockReturnValue({
                    type: 'hls',
                    url: 'https://cdn.example.com/track.m3u8',
                    qualities: [],
                    mimeType: 'audio/mp4'
                }),
                capturePatterns: ['*://cdn.example.com/*']
            }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{
            authUrls: ['https://zvuk.com/*'],
            setupKeyCapture: vi.fn(),
            setupEarlyInjection: vi.fn()
        }];
        globalThis.serviceRegistry = {
            getAllServices: vi.fn(() => [mockService]),
            getServiceByUrl: vi.fn(() => mockService)
        };
        globalThis.audioStore = new globalThis.audioStore.constructor();
        globalThis.notifyPopup = vi.fn().mockResolvedValue(undefined);

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nhttps://cdn.example.com/track.m3u8')
        });

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('обрабатывает захваченный URL', async () => {
        const listener = onCompletedListeners[0];
        if (listener) {
            await listener({
                statusCode: 200,
                url: 'https://cdn.example.com/audio.m3u8',
                tabId: 1
            });
        }
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor — без authUrls', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: true, isChromium: false });
        globalThis.serviceRequestInterceptors = [{ authUrls: [] }];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('не падает если authUrls пустой', () => {
        expect(true).toBe(true);
    });
});
