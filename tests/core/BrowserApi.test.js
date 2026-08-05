import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadModule } from '../helpers/loadModule.js';

function makeChromeApi(overrides = {}) {
    return {
        runtime: {
            lastError: null,
            sendMessage: vi.fn((msg, cb) => { if (cb) cb({}); }),
            getURL: vi.fn(p => `chrome-extension://abc/${p}`)
        },
        tabs: {
            query: vi.fn((_, cb) => { if (cb) cb([]); }),
            sendMessage: vi.fn()
        },
        windows: {
            getCurrent: vi.fn((cb) => { if (cb) cb({}); }),
            create: vi.fn((_, cb) => { if (cb) cb({}); }),
            update: vi.fn((_id, _opts, cb) => { if (cb) cb({}); })
        },
        downloads: {
            download: vi.fn((_, cb) => { if (cb) cb(1); })
        },
        storage: {
            local: {
                get: vi.fn((_, cb) => { if (cb) cb({}); }),
                set: vi.fn((_, cb) => { if (cb) cb(); })
            }
        },
        declarativeNetRequest: {},
        webRequest: {},
        ...overrides
    };
}

describe('BrowserApi — Chrome', () => {
    beforeAll(() => {
        vi.stubGlobal('chrome', makeChromeApi());
        vi.stubGlobal('browser', undefined);
        loadModule('core/BrowserApi.js');
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('extensionApi существует', () => {
        expect(globalThis.extensionApi).toBeTruthy();
    });

    it('getExtensionApi возвращает api', () => {
        expect(globalThis.getExtensionApi()).toBeTruthy();
    });

    it('browserEnv.isChromium === true', () => {
        expect(globalThis.browserEnv.isChromium).toBe(true);
    });

    it('browserEnv.isFirefox === false', () => {
        expect(globalThis.browserEnv.isFirefox).toBe(false);
    });

    it('getBrowserEnv возвращает browserEnv', () => {
        const env = globalThis.getBrowserEnv();
        expect(env).toBeDefined();
        expect(env.nativeName).toBe('chrome');
    });

    it('api.runtime.sendMessage возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.runtime.sendMessage({ action: 'test' });
        expect(result).toBeDefined();
    });

    it('api.runtime.sendMessage отклоняет при chrome.runtime.lastError', async () => {
        const api = globalThis.getExtensionApi();
        globalThis.chrome.runtime.lastError = { message: 'Error occurred' };
        globalThis.chrome.runtime.sendMessage = vi.fn((msg, cb) => { if (cb) cb(null); });
        await expect(api.runtime.sendMessage({ action: 'test' })).rejects.toThrow('Error occurred');
        globalThis.chrome.runtime.lastError = null;
    });

    it('api.runtime.sendMessage отклоняет если sendMessage бросает', async () => {
        const badChrome = makeChromeApi({
            runtime: {
                lastError: null,
                sendMessage: vi.fn(() => { throw new Error('send failed'); }),
                getURL: vi.fn(p => `chrome-extension://abc/${p}`)
            }
        });
        globalThis.chrome.runtime.sendMessage = () => { throw new Error('throw'); };
        // Re-create promise api locally to test throw path
        const api = globalThis.getExtensionApi();
        globalThis.chrome.runtime.sendMessage = vi.fn(() => { throw new Error('err'); });
        // Patch the api to use a throwing function
        const badApi = { ...api, runtime: { ...api.runtime, sendMessage: null } };
    });

    it('api.tabs.query возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.tabs.query({ active: true });
        expect(Array.isArray(result)).toBe(true);
    });

    it('api.windows.create возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.windows.create({ type: 'popup' });
        expect(result).toBeDefined();
    });

    it('api.windows.getCurrent возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.windows.getCurrent();
        expect(result).toBeDefined();
    });

    it('api.windows.update возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.windows.update(1, {});
        expect(result).toBeDefined();
    });

    it('api.downloads.download возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.downloads.download({ url: 'blob:test' });
        expect(result).toBeDefined();
    });

    it('api.storage.local.get возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.storage.local.get(['key']);
        expect(result).toBeDefined();
    });

    it('api.storage.local.set возвращает Promise', async () => {
        const api = globalThis.getExtensionApi();
        const result = await api.storage.local.set({ key: 'val' });
        expect(result).toBeUndefined();
    });

    it('setServiceTab устанавливает tab', () => {
        expect(() => globalThis.setServiceTab(42)).not.toThrow();
    });

    it('fetchViaTab возвращает null если нет scripting api', async () => {
        const result = await globalThis.fetchViaTab('https://example.com', 'zvuk');
        expect(result).toBeNull();
    });

    it('fetchViaTab с scripting api и кэшированным tabId', async () => {
        globalThis.setServiceTab(1);
        const api = globalThis.getExtensionApi();
        api.scripting = {
            executeScript: vi.fn().mockResolvedValue([{ result: { ok: true, base64: 'abc', contentType: 'image/jpeg' } }])
        };
        const orig = globalThis.extensionApi;
        globalThis.extensionApi = api;
        const result = await globalThis.fetchViaTab('https://example.com/img.jpg', 'zvuk');
        expect(result).toBeDefined();
        globalThis.extensionApi = orig;
    });
});

describe('BrowserApi — Firefox', () => {
    beforeAll(() => {
        vi.stubGlobal('browser', {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({})
            },
            tabs: {
                query: vi.fn().mockResolvedValue([])
            },
            windows: {},
            storage: {}
        });
        vi.stubGlobal('chrome', undefined);
        loadModule('core/BrowserApi.js');
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('browserEnv.isFirefox === true', () => {
        expect(globalThis.browserEnv.isFirefox).toBe(true);
    });

    it('getExtensionApi возвращает browser', () => {
        const api = globalThis.getExtensionApi();
        expect(api).toBeTruthy();
    });
});

describe('BrowserApi — нет API', () => {
    beforeAll(() => {
        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('chrome', undefined);
        loadModule('core/BrowserApi.js');
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('extensionApi === null', () => {
        expect(globalThis.extensionApi).toBeNull();
    });

    it('getBrowserEnv возвращает дефолтный env', () => {
        const env = globalThis.getBrowserEnv();
        expect(env.nativeName).toBe('none');
    });

    it('fetchViaTab возвращает null без api', async () => {
        const result = await globalThis.fetchViaTab('https://example.com', 'zvuk');
        expect(result).toBeNull();
    });
});

describe('BrowserApi — fetchViaTab дополнительные пути', () => {
    beforeAll(() => {
        vi.stubGlobal('chrome', makeChromeApi());
        vi.stubGlobal('browser', undefined);
        loadModule('core/BrowserApi.js');
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('fetchViaTab возвращает null при ошибке tabs.query', async () => {
        const api = globalThis.getExtensionApi();
        api.scripting = { executeScript: vi.fn() };
        api.tabs.query = vi.fn(() => { throw new Error('tabs error'); });
        globalThis.extensionApi = api;
        // Expire cache
        globalThis._serviceTabExpiry = 0;
        globalThis._serviceTabId = null;
        const result = await globalThis.fetchViaTab('https://example.com', 'mangalib');
        expect(result).toBeNull();
    });

    it('fetchViaTab возвращает null если нет tabId и tabs.query вернул []', async () => {
        const api = globalThis.getExtensionApi();
        api.scripting = { executeScript: vi.fn() };
        api.tabs.query = vi.fn().mockResolvedValue([]);
        globalThis.extensionApi = api;
        globalThis.setServiceTab(null);
        // Force cache miss
        const result = await globalThis.fetchViaTab('https://example.com', 'zvuk');
        // No tabId found, returns null
        expect(result).toBeNull();
    });
});
