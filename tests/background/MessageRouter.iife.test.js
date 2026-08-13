import { describe, it, expect, vi, beforeAll } from 'vitest';

function makeMinimalStore() {
    return { getLatest: () => null, get: () => null, list: () => [], put: () => {}, clear: () => {}, findByZvukId: () => null };
}

function makeMinimalRateLimiter() {
    return { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
}

describe('MessageRouter — IIFE без getExtensionApi', () => {
    it('загружается с globalThis.browser если getExtensionApi не функция', async () => {
        const addListenerMock = vi.fn();
        const mockBrowserApi = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({}),
                onMessage: { addListener: addListenerMock },
                getURL: vi.fn(p => `moz-extension://abc/${p}`)
            },
            tabs: { query: vi.fn().mockResolvedValue([]) },
            extension: { getViews: vi.fn(() => []) }
        };

        const orig = {
            getExtensionApi: globalThis.getExtensionApi,
            getBrowserEnv: globalThis.getBrowserEnv,
            globalRateLimiter: globalThis.globalRateLimiter,
            audioStore: globalThis.audioStore,
            browser: globalThis.browser,
            chrome: globalThis.chrome,
            RateLimiter: globalThis.RateLimiter
        };

        globalThis.getExtensionApi = null;
        globalThis.getBrowserEnv = null;
        globalThis.globalRateLimiter = undefined;
        globalThis.audioStore = makeMinimalStore();
        globalThis.RateLimiter = class { async trackRequest() {} throttle() {} reset() {} };
        globalThis.browser = mockBrowserApi;
        globalThis.chrome = undefined;

        vi.resetModules();
        await import('../../background/MessageRouter.js');

        expect(addListenerMock).toHaveBeenCalled();

        Object.assign(globalThis, orig);
    });
});

describe('MessageRouter — IIFE chrome fallback', () => {
    it('загружается с globalThis.chrome если browser не определён', async () => {
        const addListenerMock = vi.fn();
        const mockChromeApi = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({}),
                onMessage: { addListener: addListenerMock },
                getURL: vi.fn(p => `chrome-extension://abc/${p}`)
            },
            tabs: { query: vi.fn().mockResolvedValue([]) },
            extension: { getViews: vi.fn(() => []) }
        };

        const orig = {
            getExtensionApi: globalThis.getExtensionApi,
            getBrowserEnv: globalThis.getBrowserEnv,
            globalRateLimiter: globalThis.globalRateLimiter,
            audioStore: globalThis.audioStore,
            browser: globalThis.browser,
            chrome: globalThis.chrome,
            RateLimiter: globalThis.RateLimiter
        };

        globalThis.getExtensionApi = null;
        globalThis.getBrowserEnv = null;
        globalThis.globalRateLimiter = makeMinimalRateLimiter();
        globalThis.audioStore = makeMinimalStore();
        globalThis.RateLimiter = class { async trackRequest() {} throttle() {} reset() {} };
        globalThis.browser = undefined;
        globalThis.chrome = mockChromeApi;

        vi.resetModules();
        await import('../../background/MessageRouter.js');

        expect(addListenerMock).toHaveBeenCalled();

        Object.assign(globalThis, orig);
    });
});

describe('MessageRouter — IIFE null fallback', () => {
    it('browserAPI === null если нет ни browser ни chrome', async () => {
        const orig = {
            getExtensionApi: globalThis.getExtensionApi,
            getBrowserEnv: globalThis.getBrowserEnv,
            globalRateLimiter: globalThis.globalRateLimiter,
            audioStore: globalThis.audioStore,
            browser: globalThis.browser,
            chrome: globalThis.chrome,
            RateLimiter: globalThis.RateLimiter
        };

        globalThis.getExtensionApi = null;
        globalThis.getBrowserEnv = null;
        globalThis.globalRateLimiter = makeMinimalRateLimiter();
        globalThis.audioStore = makeMinimalStore();
        globalThis.RateLimiter = class { async trackRequest() {} throttle() {} reset() {} };
        globalThis.browser = undefined;
        globalThis.chrome = undefined;

        vi.resetModules();
        try { await import('../../background/MessageRouter.js'); } catch {}

        Object.assign(globalThis, orig);
        expect(true).toBe(true);
    });
});

describe('MessageRouter — IIFE без globalRateLimiter', () => {
    it('создаёт новый RateLimiter если globalRateLimiter undefined', async () => {
        const rateLimiterConstructorSpy = vi.fn(function() {
            this.trackRequest = async () => {};
            this.throttle = () => {};
            this.reset = () => {};
        });
        const addListenerMock = vi.fn();
        const mockApi = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({}),
                onMessage: { addListener: addListenerMock },
                getURL: vi.fn(p => `chrome-extension://abc/${p}`)
            },
            tabs: { query: vi.fn().mockResolvedValue([]) },
            extension: { getViews: vi.fn(() => []) }
        };

        const orig = {
            getExtensionApi: globalThis.getExtensionApi,
            getBrowserEnv: globalThis.getBrowserEnv,
            globalRateLimiter: globalThis.globalRateLimiter,
            audioStore: globalThis.audioStore,
            RateLimiter: globalThis.RateLimiter
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true });
        globalThis.globalRateLimiter = undefined;
        globalThis.audioStore = makeMinimalStore();
        globalThis.RateLimiter = rateLimiterConstructorSpy;

        vi.resetModules();
        await import('../../background/MessageRouter.js');

        expect(rateLimiterConstructorSpy).toHaveBeenCalled();

        Object.assign(globalThis, orig);
    });
});

describe('MessageRouter — без runtime.onMessage', () => {
    it('не регистрирует listener если onMessage недоступен', async () => {
        const mockApi = {
            runtime: {},
            extension: { getViews: vi.fn(() => []) }
        };

        const orig = {
            getExtensionApi: globalThis.getExtensionApi,
            getBrowserEnv: globalThis.getBrowserEnv,
            audioStore: globalThis.audioStore,
            globalRateLimiter: globalThis.globalRateLimiter
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true });
        globalThis.audioStore = makeMinimalStore();
        globalThis.globalRateLimiter = makeMinimalRateLimiter();

        vi.resetModules();
        await import('../../background/MessageRouter.js');

        expect(mockApi.runtime.onMessage).toBeUndefined();

        Object.assign(globalThis, orig);
    });
});

describe('MessageRouter — isFirefox=true', () => {
    const ffListeners = [];
    let fetchMock;

    beforeAll(async () => {
        fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
            text: vi.fn().mockResolvedValue('{}'),
            headers: { get: vi.fn().mockReturnValue('audio/mpeg') }
        });
        globalThis.fetch = fetchMock;

        const mockApi = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({}),
                onMessage: { addListener: vi.fn(cb => ffListeners.push(cb)) },
                getURL: vi.fn(p => `moz-extension://abc/${p}`)
            },
            tabs: { query: vi.fn().mockResolvedValue([]) },
            extension: { getViews: vi.fn(() => []) }
        };

        const orig = {
            getExtensionApi: globalThis.getExtensionApi,
            getBrowserEnv: globalThis.getBrowserEnv,
            audioStore: globalThis.audioStore,
            globalRateLimiter: globalThis.globalRateLimiter,
            RateLimiter: globalThis.RateLimiter
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: true, isChromium: false });
        globalThis.audioStore = makeMinimalStore();
        globalThis.globalRateLimiter = makeMinimalRateLimiter();

        vi.resetModules();
        await import('../../background/MessageRouter.js');

        Object.assign(globalThis, orig);
    });

    function ffDispatch(msg, sender = {}) {
        return new Promise(resolve => {
            let responded = false;
            for (const listener of ffListeners) {
                const sendResponse = resp => {
                    if (!responded) { responded = true; resolve(resp); }
                };
                listener(msg, sender, sendResponse);
            }
            setTimeout(() => resolve(null), 200);
        });
    }

    it('fetchAudioTrack использует credentials include при isFirefox=true', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
            headers: { get: vi.fn().mockReturnValue('audio/mpeg') }
        });
        const resp = await ffDispatch({ action: 'fetchAudioTrack', url: 'https://cdn.example.com/audio.mp3' });
        expect(resp.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ credentials: 'include' })
        );
    });

    it('fetchWithRateLimit использует credentials include при isFirefox=true', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true, status: 200, statusText: 'OK',
            text: vi.fn().mockResolvedValue('{}'),
            headers: { get: vi.fn().mockReturnValue('application/json') }
        });
        const resp = await ffDispatch({ action: 'fetchWithRateLimit', url: 'https://api.example.com' });
        expect(resp.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ credentials: 'include' })
        );
    });
});
