import { describe, it, expect, vi, beforeAll } from 'vitest';
import '../../../core/RateLimiter.js';
import '../../../background/AudioStore.js';

let mockApi;
let tabsQueryListeners = [];

beforeAll(async () => {
    tabsQueryListeners = [];

    mockApi = {
        tabs: {
            query: vi.fn().mockResolvedValue([{ id: 10 }]),
            sendMessage: vi.fn().mockResolvedValue({ ok: true, data: [1, 2, 3], source: 'fetch', xekValue: 'abc' })
        },
        scripting: {
            executeScript: vi.fn().mockResolvedValue([{ result: { ok: true, data: [1, 2, 3], source: 'fetch', xekValue: 'xek' } }])
        }
    };

    globalThis.getExtensionApi = () => mockApi;
    globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true });
    globalThis.serviceMessageHandlers = [];
    globalThis.encryptedKeyStore = {};
    globalThis.nativeKeyStore = {};
    globalThis.audioStore = new globalThis.audioStore.constructor();
    globalThis.serviceRegistry = {
        getAllServices: vi.fn(() => [{
            constructor: {
                capturePatterns: ['*://cdn-hls-slicer.zvuk.com/*'],
                captureFromUrl: vi.fn(() => ({
                    type: 'hls',
                    qualities: [{ bandwidth: 128000, label: 'LQ · 128 kbps', url: 'https://cdn.example.com/128.m3u8' }]
                }))
            }
        }])
    };
    globalThis.notifyPopup = vi.fn().mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nhttps://cdn.example.com/128.m3u8')
    });

    vi.resetModules();
    await import('../../../services/zvuk/ZvukMessageHandler.js');
});

function callHandler(action, msg, sender = {}) {
    return new Promise(resolve => {
        for (const handlers of globalThis.serviceMessageHandlers) {
            const fn = handlers.get(action);
            if (fn) {
                const result = fn(msg, sender, resolve);
                if (!result) resolve(null);
                return;
            }
        }
        resolve(null);
    });
}

describe('ZvukMessageHandler', () => {
    it('регистрирует обработчики в serviceMessageHandlers', () => {
        expect(globalThis.serviceMessageHandlers).toHaveLength(1);
        const handlers = globalThis.serviceMessageHandlers[0];
        expect(handlers.has('resolveCdnUrl')).toBe(true);
        expect(handlers.has('fetchKeyFromTab')).toBe(true);
        expect(handlers.has('probeCdnForTrack')).toBe(true);
    });

    it('registerZvukHandlers добавляет handlers в Map', () => {
        const map = new Map();
        globalThis.registerZvukHandlers(map);
        expect(map.has('resolveCdnUrl')).toBe(true);
        expect(map.has('fetchKeyFromTab')).toBe(true);
        expect(map.has('probeCdnForTrack')).toBe(true);
    });

    describe('resolveCdnUrl', () => {
        it('возвращает ok:true при успешном probe', async () => {
            const resp = await callHandler('resolveCdnUrl', { zvukId: '777' });
            expect(resp.ok).toBe(true);
        });

        it('возвращает ok:false если все suffixes не прошли', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, text: vi.fn() });
            const resp = await callHandler('resolveCdnUrl', { zvukId: '000' });
            expect(resp.ok).toBe(false);
        });

        it('outer catch если serviceRegistry.getAllServices бросает', async () => {
            const origRegistry = globalThis.serviceRegistry;
            globalThis.serviceRegistry = {
                getAllServices: vi.fn(() => { throw new Error('registry error'); })
            };
            try {
                const resp = await callHandler('resolveCdnUrl', { zvukId: 'err1' });
                expect(resp.ok).toBe(false);
                expect(resp.error).toBeTruthy();
            } finally {
                globalThis.serviceRegistry = origRegistry;
            }
        });
    });

    describe('fetchKeyFromTab', () => {
        it('возвращает ok:false если нет tab', async () => {
            mockApi.tabs.query = vi.fn().mockResolvedValue([]);
            const resp = await callHandler('fetchKeyFromTab', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=111'
            });
            expect(resp.ok).toBe(false);
            expect(resp.error).toContain('tab');
            mockApi.tabs.query = vi.fn().mockResolvedValue([{ id: 10 }]);
        });

        it('возвращает nativeKey если есть в store', async () => {
            globalThis.nativeKeyStore = { '222': [1, 2, 3] };
            globalThis.encryptedKeyStore = { '222': { headers: [{ name: 'x-encrypted-key', value: 'xek' }] } };
            const resp = await callHandler('fetchKeyFromTab', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=222'
            });
            expect(resp.ok).toBe(true);
            expect(resp.source).toBe('native');
            globalThis.nativeKeyStore = {};
            globalThis.encryptedKeyStore = {};
        });

        it('использует content script если нет nativeKey', async () => {
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: true, data: [9, 8, 7], source: 'fetch', xekValue: 'xyz' });
            const resp = await callHandler('fetchKeyFromTab', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=333'
            });
            expect(resp.ok).toBe(true);
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false, status: 403 });
        });

        it('использует executeScript если content script вернул not-ok', async () => {
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false, status: 403 });
            mockApi.scripting.executeScript = vi.fn().mockResolvedValue([
                { result: { ok: true, data: [5, 6, 7], source: 'fetch', xekValue: 'exec-xek' } }
            ]);
            const resp = await callHandler('fetchKeyFromTab', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=444'
            });
            expect(resp.ok).toBe(true);
        });

        it('возвращает ok:false если все методы провалились', async () => {
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false, status: 403 });
            mockApi.scripting.executeScript = vi.fn().mockResolvedValue([{ result: null }]);
            const resp = await callHandler('fetchKeyFromTab', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=555'
            });
            expect(resp.ok).toBe(false);
        });

        it('возвращает ok:false если executeScript нет в api', async () => {
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false });
            const origScripting = mockApi.scripting;
            mockApi.scripting = null;
            const resp = await callHandler('fetchKeyFromTab', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=666'
            });
            expect(resp.ok).toBe(false);
            mockApi.scripting = origScripting;
        });

        it('content-script sendMessage бросает — переходит к executeScript', async () => {
            const origSend = mockApi.tabs.sendMessage;
            const origExec = mockApi.scripting.executeScript;
            mockApi.tabs.sendMessage = vi.fn(() => { throw new Error('cs failed'); });
            mockApi.scripting.executeScript = vi.fn().mockResolvedValue([{ result: null }]);
            try {
                const resp = await callHandler('fetchKeyFromTab', {
                    url: 'https://zvuk.com/keyserver/api/v1/key?track_id=csthrow1'
                });
                expect(resp.ok).toBe(false);
            } finally {
                mockApi.tabs.sendMessage = origSend;
                mockApi.scripting.executeScript = origExec;
            }
        });

        it('func: возвращает spy ключ из __sounddlib_key_store', async () => {
            const origSend = mockApi.tabs.sendMessage;
            const origExec = mockApi.scripting.executeScript;
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false });
            mockApi.scripting.executeScript = vi.fn().mockImplementation(async ({ func, args }) => {
                if (func) {
                    globalThis.__sounddlib_key_store = { [args[0]]: [1, 2, 3] };
                    try {
                        const result = await func(...args);
                        return [{ result }];
                    } finally {
                        delete globalThis.__sounddlib_key_store;
                    }
                }
                return [{ result: null }];
            });
            try {
                const resp = await callHandler('fetchKeyFromTab', {
                    url: 'https://zvuk.com/keyserver/api/v1/key?track_id=spy1'
                });
                expect(resp.ok).toBe(true);
                expect(resp.source).toBe('spy');
            } finally {
                mockApi.tabs.sendMessage = origSend;
                mockApi.scripting.executeScript = origExec;
            }
        });

        it('func: выполняет fetch и возвращает данные', async () => {
            const origSend = mockApi.tabs.sendMessage;
            const origExec = mockApi.scripting.executeScript;
            const origFetch = globalThis.fetch;
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false });
            mockApi.scripting.executeScript = vi.fn().mockImplementation(async ({ func, args }) => {
                if (func) {
                    globalThis.fetch = vi.fn().mockResolvedValue({
                        ok: true,
                        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
                    });
                    try {
                        const result = await func(...args);
                        return [{ result }];
                    } finally {
                        globalThis.fetch = origFetch;
                    }
                }
                return [{ result: null }];
            });
            try {
                const resp = await callHandler('fetchKeyFromTab', {
                    url: 'https://zvuk.com/keyserver/api/v1/key?track_id=fetch1'
                });
                expect(resp.ok).toBe(true);
                expect(resp.source).toBe('fetch');
            } finally {
                mockApi.tabs.sendMessage = origSend;
                mockApi.scripting.executeScript = origExec;
            }
        });

        it('func: возвращает ok:false если fetch не ok', async () => {
            const origSend = mockApi.tabs.sendMessage;
            const origExec = mockApi.scripting.executeScript;
            const origFetch = globalThis.fetch;
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false });
            mockApi.scripting.executeScript = vi.fn().mockImplementation(async ({ func, args }) => {
                if (func) {
                    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
                    try {
                        const result = await func(...args);
                        return [{ result }];
                    } finally {
                        globalThis.fetch = origFetch;
                    }
                }
                return [{ result: null }];
            });
            try {
                const resp = await callHandler('fetchKeyFromTab', {
                    url: 'https://zvuk.com/keyserver/api/v1/key?track_id=fnotok1'
                });
                expect(resp.ok).toBe(false);
            } finally {
                mockApi.tabs.sendMessage = origSend;
                mockApi.scripting.executeScript = origExec;
            }
        });

        it('func: обрабатывает ошибку fetch внутри', async () => {
            const origSend = mockApi.tabs.sendMessage;
            const origExec = mockApi.scripting.executeScript;
            const origFetch = globalThis.fetch;
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false });
            mockApi.scripting.executeScript = vi.fn().mockImplementation(async ({ func, args }) => {
                if (func) {
                    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network fail'));
                    try {
                        const result = await func(...args);
                        return [{ result }];
                    } finally {
                        globalThis.fetch = origFetch;
                    }
                }
                return [{ result: null }];
            });
            try {
                const resp = await callHandler('fetchKeyFromTab', {
                    url: 'https://zvuk.com/keyserver/api/v1/key?track_id=errfetch1'
                });
                expect(resp.ok).toBe(false);
                expect(resp.error).toBeTruthy();
            } finally {
                mockApi.tabs.sendMessage = origSend;
                mockApi.scripting.executeScript = origExec;
            }
        });

        it('tryExecuteScript бросает executeScript — fallback', async () => {
            const origSend = mockApi.tabs.sendMessage;
            const origExec = mockApi.scripting.executeScript;
            mockApi.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: false });
            mockApi.scripting.executeScript = vi.fn().mockRejectedValue(new Error('exec threw'));
            try {
                const resp = await callHandler('fetchKeyFromTab', {
                    url: 'https://zvuk.com/keyserver/api/v1/key?track_id=execthrow1'
                });
                expect(resp.ok).toBe(false);
            } finally {
                mockApi.tabs.sendMessage = origSend;
                mockApi.scripting.executeScript = origExec;
            }
        });

        it('outer catch если tabs.query бросает', async () => {
            const origQuery = mockApi.tabs.query;
            mockApi.tabs.query = vi.fn(() => { throw new Error('query failed'); });
            try {
                const resp = await callHandler('fetchKeyFromTab', {
                    url: 'https://zvuk.com/keyserver/api/v1/key?track_id=qerr1'
                });
                expect(resp.ok).toBe(false);
                expect(resp.error).toBeTruthy();
            } finally {
                mockApi.tabs.query = origQuery;
            }
        });
    });

    describe('probeCdnForTrack', () => {
        it('возвращает ok:true при успешном probe', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                text: vi.fn().mockResolvedValue('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nhttps://cdn.example.com/128.m3u8')
            });
            mockApi.tabs.query = vi.fn().mockResolvedValue([{ id: 10 }]);

            const resp = await callHandler('probeCdnForTrack', {
                zvukId: '999',
                meta: { title: 'Test', artist: 'Artist' }
            });
            expect(resp.ok).toBe(true);
            expect(resp.trackId).toBeDefined();
        });

        it('возвращает ok:false если captureFromUrl вернул null', async () => {
            globalThis.serviceRegistry.getAllServices.mockReturnValue([{
                constructor: {
                    capturePatterns: ['*://cdn-hls-slicer.zvuk.com/*'],
                    captureFromUrl: vi.fn(() => null)
                }
            }]);

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                text: vi.fn().mockResolvedValue('#EXTM3U')
            });

            const resp = await callHandler('probeCdnForTrack', { zvukId: '888' });
            expect(resp.ok).toBe(false);
        });

        it('возвращает ok:false если все CDN вернули не-200', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
            const resp = await callHandler('probeCdnForTrack', { zvukId: '111' });
            expect(resp.ok).toBe(false);
        });

        it('outer catch если serviceRegistry.getAllServices бросает', async () => {
            const origRegistry = globalThis.serviceRegistry;
            globalThis.serviceRegistry = {
                getAllServices: vi.fn(() => { throw new Error('registry boom'); })
            };
            try {
                const resp = await callHandler('probeCdnForTrack', { zvukId: 'err2' });
                expect(resp.ok).toBe(false);
                expect(resp.error).toBeTruthy();
            } finally {
                globalThis.serviceRegistry = origRegistry;
            }
        });
    });
});
