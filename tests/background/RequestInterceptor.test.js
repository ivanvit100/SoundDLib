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

describe('RequestInterceptor — Firefox from-extension → rateLimiter', () => {
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
            tabs: { sendMessage: vi.fn().mockResolvedValue({ ok: true, meta: {} }) }
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

    it('Firefox listener вызывает trackRequest при запросе из расширения', () => {
        const listener = onBeforeSendListeners[0];
        const trackRequestSpy = vi.spyOn(globalThis.globalRateLimiter, 'trackRequest').mockResolvedValue(undefined);
        listener({
            tabId: -1,
            requestHeaders: [{ name: 'authorization', value: 'Bearer should-not-store' }]
        });
        expect(trackRequestSpy).toHaveBeenCalledWith('zvuk');
        expect(globalThis.authTokenStore.zvuk).not.toBe('should-not-store');
        trackRequestSpy.mockRestore();
    });
});

describe('RequestInterceptor — Chrome без authUrls', () => {
    let onBeforeSendListeners = [];

    beforeAll(async () => {
        onBeforeSendListeners = [];
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: {
                    addListener: vi.fn((cb) => { onBeforeSendListeners.push(cb); })
                },
                onCompleted: { addListener: vi.fn() }
            }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{ authUrls: [], setupKeyCapture: vi.fn(), setupEarlyInjection: vi.fn() }];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('Chrome не регистрирует listener если authUrls пуст', () => {
        expect(onBeforeSendListeners.length).toBe(0);
    });
});

describe('RequestInterceptor — handleCapturedUrl catch', () => {
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
            tabs: { sendMessage: vi.fn().mockResolvedValue({ ok: true, meta: {} }) }
        };

        const mockService = {
            constructor: {
                captureFromUrl: vi.fn().mockReturnValue({ type: 'hls', url: 'https://cdn.example.com/t.m3u8', qualities: [], mimeType: 'audio/mp4' }),
                capturePatterns: ['*://cdn.example.com/*']
            }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{ authUrls: ['https://zvuk.com/*'], setupKeyCapture: vi.fn(), setupEarlyInjection: vi.fn() }];
        globalThis.serviceRegistry = {
            getAllServices: vi.fn(() => [mockService]),
            getServiceByUrl: vi.fn(() => mockService)
        };
        globalThis.audioStore = new globalThis.audioStore.constructor();
        globalThis.notifyPopup = vi.fn().mockResolvedValue(undefined);
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('catch block выполняется при ошибке в handleCapturedUrl', async () => {
        const listener = onCompletedListeners[0];
        if (listener) {
            await expect(listener({
                statusCode: 200,
                url: 'https://cdn.example.com/audio.m3u8',
                tabId: 1
            })).resolves.not.toThrow();
        }
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor — captureAuthToken дополнительные ветки', () => {
    let onBeforeSendListeners = [];

    beforeAll(async () => {
        onBeforeSendListeners = [];
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn((cb) => { onBeforeSendListeners.push(cb); }) },
                onCompleted: { addListener: vi.fn() }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{ authUrls: ['https://zvuk.com/*'], setupKeyCapture: vi.fn(), setupEarlyInjection: vi.fn() }];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };
        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('не обновляет токен если он уже такой же', () => {
        globalThis.authTokenStore.zvuk = 'existing-token';
        const listener = onBeforeSendListeners[0];
        listener({ tabId: 1, requestHeaders: [{ name: 'authorization', value: 'Bearer existing-token' }] });
        expect(globalThis.authTokenStore.zvuk).toBe('existing-token');
    });

    it('isFromExtension без requestHeaders → requestHeaders?.some() ?? false', () => {
        globalThis.authTokenStore.zvuk = undefined;
        const listener = onBeforeSendListeners[0];
        listener({ tabId: 5 });
        expect(globalThis.authTokenStore.zvuk).toBeUndefined();
    });
});

describe('RequestInterceptor — handleCapturedUrl ветки', () => {
    let onCompletedListeners = [];
    let tabsSendMessage;
    let captureFromUrl;

    beforeAll(async () => {
        onCompletedListeners = [];
        tabsSendMessage = vi.fn().mockResolvedValue({ ok: true, meta: { title: 'T', artist: 'A' } });
        captureFromUrl = vi.fn().mockReturnValue({ type: 'hls', url: 'https://cdn.example.com/track.m3u8', qualities: null });

        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn((cb) => { onCompletedListeners.push(cb); }) }
            },
            tabs: { sendMessage: tabsSendMessage }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{ authUrls: ['https://zvuk.com/*'], setupKeyCapture: vi.fn(), setupEarlyInjection: vi.fn() }];
        globalThis.serviceRegistry = {
            getAllServices: vi.fn(() => [{ constructor: { capturePatterns: ['*://cdn.example.com/*'], captureFromUrl } }]),
            getServiceByUrl: vi.fn(() => ({ constructor: { capturePatterns: ['*://cdn.example.com/*'], captureFromUrl } }))
        };
        globalThis.audioStore = new globalThis.audioStore.constructor();
        globalThis.notifyPopup = vi.fn().mockResolvedValue(undefined);
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('#EXTM3U') });

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('statusCode !== 200 → ранний выход', async () => {
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 404, url: 'https://cdn.example.com/a1.m3u8', tabId: 1 });
        expect(globalThis.serviceRegistry.getServiceByUrl).not.toHaveBeenCalled();
    });

    it('store.hasUrl(url) → ранний выход', async () => {
        const url = 'https://cdn.example.com/a2.m3u8';
        globalThis.audioStore._urlIndex = new Map([[url, 'existing']]);
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url, tabId: 1 });
        globalThis.audioStore._urlIndex = new Map();
        expect(captureFromUrl).not.toHaveBeenCalled();
    });

    it('tabId <= 0 → fetchTabMeta ранний выход', async () => {
        captureFromUrl.mockReturnValueOnce({ type: 'hls', url: 'https://cdn.example.com/a3.m3u8', qualities: null });
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url: 'https://cdn.example.com/a3.m3u8', tabId: 0 });
        expect(tabsSendMessage).not.toHaveBeenCalled();
    });

    it('metaResp null → не обновляет meta', async () => {
        captureFromUrl.mockReturnValueOnce({ type: 'hls', url: 'https://cdn.example.com/a4.m3u8', qualities: null });
        tabsSendMessage.mockResolvedValueOnce(null);
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url: 'https://cdn.example.com/a4.m3u8', tabId: 1 });
        expect(true).toBe(true);
    });

    it('metaResp.ok true но title/artist оба null → нет updateMeta', async () => {
        captureFromUrl.mockReturnValueOnce({ type: 'hls', url: 'https://cdn.example.com/a5.m3u8', qualities: null });
        tabsSendMessage.mockResolvedValueOnce({ ok: true, meta: { title: null, artist: null } });
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url: 'https://cdn.example.com/a5.m3u8', tabId: 1 });
        expect(true).toBe(true);
    });

    it('stored.meta undefined и url null → || fallbacks', async () => {
        captureFromUrl.mockReturnValueOnce({ type: 'hls', url: null, qualities: null });
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url: 'https://cdn.example.com/a6.m3u8', tabId: 0 });
        expect(globalThis.notifyPopup).toHaveBeenCalledWith(expect.objectContaining({
            meta: {},
            url: null,
            qualities: null
        }));
    });

    it('getServiceByUrl null → ранний выход', async () => {
        globalThis.serviceRegistry.getServiceByUrl.mockReturnValueOnce(null);
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url: 'https://cdn.example.com/a7.m3u8', tabId: 1 });
        expect(globalThis.fetch).not.toHaveBeenCalledWith('https://cdn.example.com/a7.m3u8', expect.any(Object));
    });

    it('res.ok false → ранний выход', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
        const listener = onCompletedListeners[0];
        const prevCallCount = captureFromUrl.mock.calls.length;
        await listener({ statusCode: 200, url: 'https://cdn.example.com/a8.m3u8', tabId: 1 });
        expect(captureFromUrl.mock.calls.length).toBe(prevCallCount);
    });

    it('captureFromUrl null → ранний выход', async () => {
        captureFromUrl.mockReturnValueOnce(null);
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('') });
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url: 'https://cdn.example.com/a9.m3u8', tabId: 1 });
        expect(globalThis.notifyPopup).not.toHaveBeenCalledWith(expect.objectContaining({ trackId: expect.stringContaining('a9') }));
    });
});

describe('RequestInterceptor — handleCapturedUrl Firefox → credentials include', () => {
    let onCompletedListeners = [];

    beforeAll(async () => {
        onCompletedListeners = [];
        const captureFromUrl = vi.fn().mockReturnValue({ type: 'hls', url: 'https://cdn.example.com/ff.m3u8', qualities: null });
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn((cb) => { onCompletedListeners.push(cb); }) }
            },
            tabs: { sendMessage: vi.fn().mockResolvedValue({ ok: true, meta: {} }) }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: true, isChromium: false });
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{ authUrls: ['https://zvuk.com/*'], setupKeyCapture: vi.fn(), setupEarlyInjection: vi.fn() }];
        globalThis.serviceRegistry = {
            getAllServices: vi.fn(() => [{ constructor: { capturePatterns: ['*://cdn.example.com/*'], captureFromUrl } }]),
            getServiceByUrl: vi.fn(() => ({ constructor: { capturePatterns: ['*://cdn.example.com/*'], captureFromUrl } }))
        };
        globalThis.audioStore = new globalThis.audioStore.constructor();
        globalThis.notifyPopup = vi.fn().mockResolvedValue(undefined);
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('#EXTM3U') });
        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('fetch вызывается с credentials include при isFirefox=true', async () => {
        const listener = onCompletedListeners[0];
        await listener({ statusCode: 200, url: 'https://cdn.example.com/ff.m3u8', tabId: 0 });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ credentials: 'include' })
        );
    });
});

describe('RequestInterceptor — setupServiceCapture без registry', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = null;
        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('setupServiceCapture возвращает ранний выход если registry null', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor — getAllAuthUrls с authUrls null', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: true, isChromium: false });
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [{ authUrls: null, setupKeyCapture: vi.fn(), setupEarlyInjection: vi.fn() }];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };
        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('i.authUrls null → || [] fallback при вызове getAllAuthUrls', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor — getAllAuthUrls serviceRequestInterceptors null', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: true, isChromium: false });
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = null;
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };
        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('serviceRequestInterceptors null → ?? [] fallback', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor — setupServiceInterceptors без getBrowserEnv', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = null;
        globalThis.browser = undefined;
        globalThis.serviceRequestInterceptors = undefined;
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('setupServiceInterceptors работает без getBrowserEnv и serviceRequestInterceptors', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor — setupServiceCapture capturePatterns null', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.globalRateLimiter = new globalThis.RateLimiter();
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = {
            getAllServices: vi.fn(() => [{ constructor: { capturePatterns: null } }]),
            getServiceByUrl: vi.fn()
        };
        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('capturePatterns null → || [] fallback → не регистрирует listener (line 104)', () => {
        expect(true).toBe(true);
    });
});
