import { describe, it, expect, vi, beforeAll } from 'vitest';

function makeChromeApi() {
    return {
        runtime: { lastError: null, sendMessage: vi.fn((msg, cb) => { if (cb) cb({}); }), getURL: vi.fn(p => `chrome-extension://abc/${p}`) },
        tabs: { query: vi.fn((_, cb) => { if (cb) cb([]); }) },
        windows: { getCurrent: vi.fn((cb) => { if (cb) cb({}); }), create: vi.fn((_, cb) => { if (cb) cb({}); }), update: vi.fn((_id, _opts, cb) => { if (cb) cb({}); }) },
        downloads: { download: vi.fn((_, cb) => { if (cb) cb(1); }) },
        storage: { local: { get: vi.fn((_, cb) => { if (cb) cb({}); }), set: vi.fn((_, cb) => { if (cb) cb(); }) } },
        declarativeNetRequest: {},
        webRequest: {}
    };
}

describe('BrowserApi — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('chrome', makeChromeApi());
        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../core/BrowserApi.js');
        vi.unstubAllGlobals();
        expect(globalThis.getExtensionApi).toBeDefined();
    });
});
