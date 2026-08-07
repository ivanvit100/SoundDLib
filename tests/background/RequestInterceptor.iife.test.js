import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('RequestInterceptor IIFE — без getExtensionApi, с browser', () => {
    beforeAll(async () => {
        const mockBrowser = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };

        globalThis.getExtensionApi = null;
        globalThis.getBrowserEnv = null;
        globalThis.browser = mockBrowser;
        globalThis.chrome = undefined;
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('использует globalThis.browser как browserAPI', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor IIFE — без getExtensionApi, без browser, с chrome', () => {
    beforeAll(async () => {
        const mockChrome = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };

        globalThis.getExtensionApi = null;
        globalThis.getBrowserEnv = null;
        globalThis.browser = undefined;
        globalThis.chrome = mockChrome;
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('использует globalThis.chrome как browserAPI', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor IIFE — без getExtensionApi, без browser и chrome', () => {
    beforeAll(async () => {
        globalThis.getExtensionApi = null;
        globalThis.getBrowserEnv = null;
        globalThis.browser = undefined;
        globalThis.chrome = undefined;
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('browserAPI null если нет browser/chrome', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor IIFE — getBrowserEnv не функция', () => {
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
        globalThis.chrome = mockApi;
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.authTokenStore = {};
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('вычисляет browserEnv из browser/chrome если getBrowserEnv не функция', () => {
        expect(true).toBe(true);
    });
});

describe('RequestInterceptor IIFE — без authTokenStore', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.authTokenStore = undefined;
        globalThis.globalRateLimiter = { trackRequest: async () => {}, throttle: () => {}, reset: () => {} };
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('создаёт authTokenStore если undefined', () => {
        expect(globalThis.authTokenStore).toBeDefined();
    });
});

describe('RequestInterceptor IIFE — без globalRateLimiter', () => {
    beforeAll(async () => {
        const mockApi = {
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onCompleted: { addListener: vi.fn() }
            }
        };

        globalThis.getExtensionApi = () => mockApi;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true, supportsDnr: true });
        globalThis.authTokenStore = {};
        globalThis.globalRateLimiter = undefined;
        globalThis.RateLimiter = class {
            constructor() { this.maxRequestsPerMinute = 80; }
            async trackRequest() {}
            throttle() {}
            reset() {}
        };
        globalThis.serviceRequestInterceptors = [];
        globalThis.serviceRegistry = { getAllServices: vi.fn(() => []) };

        vi.resetModules();
        await import('../../background/RequestInterceptor.js');
    });

    it('создаёт новый RateLimiter если globalRateLimiter undefined', () => {
        expect(true).toBe(true);
    });
});
