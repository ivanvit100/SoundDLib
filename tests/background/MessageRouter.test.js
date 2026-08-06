import { describe, it, expect, vi, beforeAll } from 'vitest';
import '../../core/RateLimiter.js';
import '../../background/AudioStore.js';

function makeApi() {
    const listeners = [];
    return {
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({}),
            onMessage: {
                addListener: vi.fn((cb) => { listeners.push(cb); }),
                _listeners: listeners,
                _dispatch: (msg, sender) => {
                    let result;
                    for (const cb of listeners) {
                        const respond = vi.fn();
                        result = cb(msg, sender, respond);
                        if (result) return { result, respond };
                    }
                    return null;
                }
            },
            getURL: vi.fn(p => `chrome-extension://abc/${p}`)
        },
        tabs: {
            query: vi.fn().mockResolvedValue([{ id: 42 }]),
            create: vi.fn().mockResolvedValue({}),
            sendMessage: vi.fn().mockResolvedValue({ ok: true, data: [1, 2, 3], mimeType: 'audio/mpeg' })
        },
        windows: {
            create: vi.fn().mockResolvedValue({ id: 1 }),
            update: vi.fn().mockResolvedValue({})
        },
        extension: {
            getViews: vi.fn(() => [])
        }
    };
}

let api;
let store;

beforeAll(async () => {
    api = makeApi();
    globalThis.getExtensionApi = () => api;
    globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true });
    globalThis.globalRateLimiter = new globalThis.RateLimiter();
    globalThis.audioStore = new globalThis.audioStore.constructor();
    store = globalThis.audioStore;

    vi.resetModules();
    await import('../../background/MessageRouter.js');
});

function dispatch(msg, sender = {}) {
    return new Promise(resolve => {
        const listeners = api.runtime.onMessage._listeners;
        let responded = false;
        for (const listener of listeners) {
            const sendResponse = (resp) => {
                if (!responded) { responded = true; resolve(resp); }
            };
            const returned = listener(msg, sender, sendResponse);
            if (!returned) break;
        }
        if (!responded) setTimeout(() => resolve(null), 100);
    });
}

describe('MessageRouter — audioIntercepted', () => {
    it('сохраняет трек с data', async () => {
        const resp = await dispatch({
            action: 'audioIntercepted',
            trackId: 'test1',
            type: 'audio',
            mimeType: 'audio/mpeg',
            data: [1, 2, 3],
            meta: { title: 'Test' },
            url: 'https://example.com/audio.mp3'
        });
        expect(resp.ok).toBe(true);
        expect(resp.trackId).toBe('test1');
    });

    it('сохраняет трек без data (только уведомление)', async () => {
        const resp = await dispatch({
            action: 'audioIntercepted',
            trackId: 'test-notify',
            meta: { title: 'Notify Only' }
        });
        expect(resp.ok).toBe(true);
    });

    it('генерирует id если trackId не указан', async () => {
        const resp = await dispatch({
            action: 'audioIntercepted',
            type: 'audio',
            mimeType: 'audio/mpeg',
            data: [1, 2, 3],
            meta: {}
        });
        expect(resp.ok).toBe(true);
        expect(resp.trackId).toBeDefined();
    });
});

describe('MessageRouter — getLatestTrack', () => {
    it('возвращает ошибку если нет треков', async () => {
        store.clear();
        const resp = await dispatch({ action: 'getLatestTrack' });
        expect(resp.ok).toBe(false);
    });

    it('возвращает последний трек', async () => {
        store.put('t1', { id: 't1', type: 'audio', mimeType: 'audio/mpeg', data: new Uint8Array([1, 2, 3]), url: 'https://test.com', masterUrl: null, qualities: null, meta: { title: 'T' }, capturedAt: Date.now() });
        const resp = await dispatch({ action: 'getLatestTrack' });
        expect(resp.ok).toBe(true);
        expect(resp.trackId).toBe('t1');
    });

    it('возвращает null для data если data не задана', async () => {
        store.clear();
        store.put('t2', { id: 't2', type: 'audio', mimeType: 'audio/mpeg', data: null, url: null, masterUrl: null, qualities: null, meta: {}, capturedAt: Date.now() });
        const resp = await dispatch({ action: 'getLatestTrack' });
        expect(resp.data).toBeNull();
    });
});

describe('MessageRouter — getTrack', () => {
    it('возвращает трек по id', async () => {
        store.clear();
        store.put('myTrack', { id: 'myTrack', type: 'audio', mimeType: 'audio/mpeg', data: null, url: null, masterUrl: null, qualities: null, meta: { title: 'My' }, capturedAt: Date.now() });
        const resp = await dispatch({ action: 'getTrack', trackId: 'myTrack' });
        expect(resp.ok).toBe(true);
        expect(resp.trackId).toBe('myTrack');
    });

    it('возвращает ошибку если трек не найден', async () => {
        const resp = await dispatch({ action: 'getTrack', trackId: 'nonexistent' });
        expect(resp.ok).toBe(false);
    });
});

describe('MessageRouter — listTracks', () => {
    it('возвращает список треков', async () => {
        const resp = await dispatch({ action: 'listTracks' });
        expect(resp.ok).toBe(true);
        expect(Array.isArray(resp.tracks)).toBe(true);
    });
});

describe('MessageRouter — fetchFromTab', () => {
    it('возвращает результат из tab', async () => {
        api.tabs.query.mockResolvedValue([{ id: 42 }]);
        api.tabs.sendMessage.mockResolvedValue({ ok: true, body: 'text', status: 200 });
        const resp = await dispatch({ action: 'fetchFromTab', url: 'https://example.com', headers: {} });
        expect(resp).toBeTruthy();
    });

    it('возвращает ошибку если нет zvuk.com вкладки', async () => {
        api.tabs.query.mockResolvedValue([]);
        const resp = await dispatch({ action: 'fetchFromTab', url: 'https://example.com' }, { tab: { id: null } });
        expect(resp.ok).toBe(false);
    });
});

describe('MessageRouter — fetchAudioTrack', () => {
    it('загружает аудио из tab', async () => {
        api.tabs.query.mockResolvedValue([{ id: 42 }]);
        api.tabs.sendMessage.mockResolvedValue({ ok: true, data: [1, 2, 3], mimeType: 'audio/mpeg' });
        const resp = await dispatch({ action: 'fetchAudioTrack', url: 'https://cdn.example.com/audio.mp3' });
        expect(resp.ok).toBe(true);
    });
});

describe('MessageRouter — fetchWithRateLimit', () => {
    it('выполняет fetch и возвращает ответ', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: vi.fn().mockResolvedValue('{"data":1}'),
            headers: { get: vi.fn().mockReturnValue('application/json') }
        });
        const resp = await dispatch({ action: 'fetchWithRateLimit', url: 'https://api.example.com' });
        expect(resp.ok).toBe(true);
    });

    it('возвращает ошибку при non-ok ответе', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: vi.fn().mockResolvedValue(''),
            headers: { get: vi.fn().mockReturnValue(null) }
        });
        const resp = await dispatch({ action: 'fetchWithRateLimit', url: 'https://api.example.com' });
        expect(resp.ok).toBe(false);
        expect(resp.status).toBe(404);
    });
});

describe('MessageRouter — fetchBinary', () => {
    it('загружает бинарные данные', async () => {
        const buf = new ArrayBuffer(4);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: vi.fn().mockResolvedValue(buf),
            headers: { get: vi.fn() }
        });
        const resp = await dispatch({ action: 'fetchBinary', url: 'https://example.com/file.bin' });
        expect(resp.ok).toBe(true);
    });

    it('возвращает 429 если throttled', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            headers: { get: vi.fn() }
        });
        const resp = await dispatch({ action: 'fetchBinary', url: 'https://example.com/file.bin' });
        expect(resp.status).toBe(429);
        globalThis.globalRateLimiter.reset();
    });
});

describe('MessageRouter — getTrackByZvukId', () => {
    it('возвращает трек по zvukId', async () => {
        store.put('zvuk_t', { id: 'zvuk_t', type: 'hls', url: 'https://cdn.zvuk.com/drm/track/777_2/master.m3u8', masterUrl: null, qualities: null, mimeType: 'audio/mp4', meta: {}, capturedAt: Date.now() });
        const resp = await dispatch({ action: 'getTrackByZvukId', zvukId: '777' });
        expect(resp.ok).toBe(true);
    });

    it('возвращает ok:false если не найдено', async () => {
        const resp = await dispatch({ action: 'getTrackByZvukId', zvukId: '0000' });
        expect(resp.ok).toBe(false);
    });
});

describe('MessageRouter — streamUrlCaptured', () => {
    it('сохраняет stream URL', async () => {
        const resp = await dispatch({ action: 'streamUrlCaptured', cdnTrackId: 'cdn123', streamUrl: 'https://cdn.example.com/stream.m3u8' });
        expect(resp.ok).toBe(true);
        expect(globalThis.streamUrlStore?.get('cdn123')).toBe('https://cdn.example.com/stream.m3u8');
    });
});

describe('MessageRouter — getStreamUrlByZvukId', () => {
    it('находит streamUrl по точному cdnTrackId', async () => {
        globalThis.streamUrlStore = new Map([['99', 'https://cdn.example.com/99.m3u8']]);
        const resp = await dispatch({ action: 'getStreamUrlByZvukId', zvukId: '99' });
        expect(resp.ok).toBe(true);
        expect(resp.streamUrl).toBe('https://cdn.example.com/99.m3u8');
    });

    it('находит streamUrl по prefix', async () => {
        globalThis.streamUrlStore = new Map([['88_2', 'https://cdn.example.com/88.m3u8']]);
        const resp = await dispatch({ action: 'getStreamUrlByZvukId', zvukId: '88' });
        expect(resp.ok).toBe(true);
    });

    it('возвращает ok:false если streamUrlStore не существует', async () => {
        globalThis.streamUrlStore = null;
        const resp = await dispatch({ action: 'getStreamUrlByZvukId', zvukId: '77' });
        expect(resp.ok).toBe(false);
    });

    it('возвращает ok:false если не найдено', async () => {
        globalThis.streamUrlStore = new Map();
        const resp = await dispatch({ action: 'getStreamUrlByZvukId', zvukId: '66' });
        expect(resp.ok).toBe(false);
    });
});

describe('MessageRouter — openDownloadWindowForTrack', () => {
    it('открывает popup окно', async () => {
        api.windows.create.mockResolvedValue({ id: 1 });
        const resp = await dispatch({
            action: 'openDownloadWindowForTrack',
            zvukTrackId: '12345',
            title: 'My Track',
            artist: 'Artist',
            cover: 'https://example.com/cover.jpg'
        }, { tab: { id: 10 } });
        expect(resp.ok).toBe(true);
    });
});

describe('MessageRouter — openDownloadWindow', () => {
    it('открывает popup окно', async () => {
        api.windows.create.mockResolvedValue({ id: 1 });
        const resp = await dispatch({ action: 'openDownloadWindow' }, { tab: { id: 5 } });
        expect(resp.ok).toBe(true);
    });
});

describe('MessageRouter — openPlaylistDownloadWindow', () => {
    it('открывает playlist popup', async () => {
        api.windows.create.mockResolvedValue({ id: 2 });
        const resp = await dispatch({ action: 'openPlaylistDownloadWindow', zip: true }, { tab: { id: 3 } });
        expect(resp.ok).toBe(true);
    });
});

describe('MessageRouter — openWindowWithUrl', () => {
    it('открывает окно по url', async () => {
        api.windows.create.mockResolvedValue({ id: 3 });
        const resp = await dispatch({ action: 'openWindowWithUrl', url: 'https://example.com' });
        expect(resp.ok).toBe(true);
    });
});

describe('MessageRouter — неизвестный action', () => {
    it('возвращает false для неизвестного action', () => {
        const listeners = api.runtime.onMessage._listeners;
        for (const listener of listeners) {
            const result = listener({ action: 'unknown_action' }, {}, vi.fn());
            expect(result).toBe(false);
        }
    });
});

describe('MessageRouter — openPopupWindow без windows API', () => {
    it('использует tabs.create если windows === null', async () => {
        const origWindows = api.windows;
        api.windows = null;
        api.tabs.create = vi.fn().mockResolvedValue({ id: 99 });
        try {
            const resp = await dispatch({ action: 'openWindowWithUrl', url: 'https://example.com' });
            expect(api.tabs.create).toHaveBeenCalled();
            expect(resp.ok).toBe(true);
        } finally {
            api.windows = origWindows;
        }
    });

    it('возвращает false если нет ни windows, ни tabs', async () => {
        const origWindows = api.windows;
        const origTabs = api.tabs;
        api.windows = null;
        api.tabs = null;
        try {
            const resp = await dispatch({ action: 'openWindowWithUrl', url: 'https://example.com' });
            expect(resp.ok).toBe(false);
        } finally {
            api.windows = origWindows;
            api.tabs = origTabs;
        }
    });
});

describe('MessageRouter — notifyPopup с views', () => {
    it('вызывает postMessage на views popup', async () => {
        const postMessageMock = vi.fn();
        const origGetViews = api.extension.getViews;
        api.extension.getViews = vi.fn(() => [{ postMessage: postMessageMock }]);
        try {
            await dispatch({
                action: 'audioIntercepted',
                trackId: 'views-notify-test',
                meta: { title: 'Views Test' }
            });
            expect(postMessageMock).toHaveBeenCalled();
        } finally {
            api.extension.getViews = origGetViews;
        }
    });
});

describe('MessageRouter — audioIntercepted catch', () => {
    it('возвращает ok:false при ошибке store.put', async () => {
        const storePutSpy = vi.spyOn(globalThis.audioStore, 'put')
            .mockImplementationOnce(() => { throw new Error('store error'); });
        try {
            const resp = await dispatch({
                action: 'audioIntercepted',
                trackId: 'catch-test',
                type: 'audio',
                mimeType: 'audio/mpeg',
                data: [1, 2, 3],
                meta: {}
            });
            expect(resp.ok).toBe(false);
        } finally {
            storePutSpy.mockRestore();
        }
    });
});

describe('MessageRouter — fetchFromTab catch', () => {
    it('возвращает ok:false при ошибке tabs.query', async () => {
        api.tabs.query.mockRejectedValueOnce(new Error('tab query failed'));
        const resp = await dispatch({ action: 'fetchFromTab', url: 'https://example.com' });
        expect(resp.ok).toBe(false);
    });
});

describe('MessageRouter — fetchAudioTrack fallback paths', () => {
    it('выполняет прямой fetch если tab возвращает ok:false', async () => {
        api.tabs.query.mockResolvedValueOnce([{ id: 42 }]);
        api.tabs.sendMessage.mockResolvedValueOnce({ ok: false });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
            headers: { get: vi.fn().mockReturnValue('audio/mpeg') }
        });
        const resp = await dispatch({ action: 'fetchAudioTrack', url: 'https://cdn.example.com/audio.mp3' });
        expect(resp.ok).toBe(true);
    });

    it('возвращает ok:false если прямой fetch не ok', async () => {
        api.tabs.query.mockResolvedValueOnce([{ id: 42 }]);
        api.tabs.sendMessage.mockResolvedValueOnce({ ok: false });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false, status: 403, headers: { get: vi.fn() }
        });
        const resp = await dispatch({ action: 'fetchAudioTrack', url: 'https://cdn.example.com/audio.mp3' });
        expect(resp.ok).toBe(false);
    });

    it('возвращает ok:false при исключении', async () => {
        api.tabs.query.mockRejectedValueOnce(new Error('network failure'));
        const resp = await dispatch({ action: 'fetchAudioTrack', url: 'https://cdn.example.com/audio.mp3' });
        expect(resp.ok).toBe(false);
    });
});

describe('MessageRouter — fetchWithRateLimit 429 retry и catch', () => {
    it('повторяет запрос после 429', async () => {
        const throttleSpy = vi.spyOn(globalThis.globalRateLimiter, 'throttle')
            .mockImplementation(() => {});
        const trackSpy = vi.spyOn(globalThis.globalRateLimiter, 'trackRequest')
            .mockResolvedValue(undefined);
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: false, status: 429, statusText: 'Too Many Requests',
                text: vi.fn(), headers: { get: vi.fn() }
            })
            .mockResolvedValueOnce({
                ok: true, status: 200, statusText: 'OK',
                text: vi.fn().mockResolvedValue('{}'),
                headers: { get: vi.fn().mockReturnValue('application/json') }
            });
        try {
            const resp = await dispatch({ action: 'fetchWithRateLimit', url: 'https://api.example.com' });
            expect(throttleSpy).toHaveBeenCalledWith(30000);
            expect(resp.ok).toBe(true);
        } finally {
            throttleSpy.mockRestore();
            trackSpy.mockRestore();
        }
    });

    it('возвращает ok:false при исключении fetch', async () => {
        const trackSpy = vi.spyOn(globalThis.globalRateLimiter, 'trackRequest')
            .mockResolvedValue(undefined);
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
        try {
            const resp = await dispatch({ action: 'fetchWithRateLimit', url: 'https://api.example.com' });
            expect(resp.ok).toBe(false);
        } finally {
            trackSpy.mockRestore();
        }
    });
});

describe('MessageRouter — fetchBinary error paths', () => {
    it('возвращает ok:false при non-429 статусе ошибки', async () => {
        const trackSpy = vi.spyOn(globalThis.globalRateLimiter, 'trackRequest')
            .mockResolvedValue(undefined);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false, status: 404, headers: { get: vi.fn() }
        });
        try {
            const resp = await dispatch({ action: 'fetchBinary', url: 'https://example.com/file.bin' });
            expect(resp.ok).toBe(false);
            expect(resp.status).toBe(404);
        } finally {
            trackSpy.mockRestore();
        }
    });

    it('возвращает ok:false при исключении fetch', async () => {
        const trackSpy = vi.spyOn(globalThis.globalRateLimiter, 'trackRequest')
            .mockResolvedValue(undefined);
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('binary fetch error'));
        try {
            const resp = await dispatch({ action: 'fetchBinary', url: 'https://example.com/file.bin' });
            expect(resp.ok).toBe(false);
        } finally {
            trackSpy.mockRestore();
        }
    });
});

describe('MessageRouter — window handlers error paths', () => {
    it('openDownloadWindowForTrack возвращает ok:false при ошибке', async () => {
        api.windows.create.mockRejectedValueOnce(new Error('window error'));
        const resp = await dispatch({
            action: 'openDownloadWindowForTrack',
            zvukTrackId: '999', title: 'Test', artist: 'Artist'
        }, { tab: { id: 10 } });
        expect(resp.ok).toBe(false);
    });

    it('openDownloadWindow возвращает ok:false при ошибке', async () => {
        api.windows.create.mockRejectedValueOnce(new Error('window error'));
        const resp = await dispatch({ action: 'openDownloadWindow' }, { tab: { id: 5 } });
        expect(resp.ok).toBe(false);
    });

    it('openPlaylistDownloadWindow возвращает ok:false при ошибке', async () => {
        api.windows.create.mockRejectedValueOnce(new Error('window error'));
        const resp = await dispatch({ action: 'openPlaylistDownloadWindow', zip: true }, { tab: { id: 3 } });
        expect(resp.ok).toBe(false);
    });

    it('openWindowWithUrl возвращает ok:false при ошибке', async () => {
        api.windows.create.mockRejectedValueOnce(new Error('window error'));
        const resp = await dispatch({ action: 'openWindowWithUrl', url: 'https://example.com' });
        expect(resp.ok).toBe(false);
    });
});

describe('MessageRouter — registerZvukHandlers и serviceMessageHandlers', () => {
    const api3Listeners = [];
    let api3;
    const registerMock = vi.fn();

    beforeAll(async () => {
        api3 = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({}),
                onMessage: {
                    addListener: vi.fn((cb) => { api3Listeners.push(cb); })
                },
                getURL: vi.fn(p => `chrome-extension://abc/${p}`)
            },
            tabs: {
                query: vi.fn().mockResolvedValue([]),
                create: vi.fn().mockResolvedValue({}),
                sendMessage: vi.fn().mockResolvedValue({})
            },
            windows: {
                create: vi.fn().mockResolvedValue({ id: 99 }),
                update: vi.fn().mockResolvedValue({})
            },
            extension: { getViews: vi.fn(() => []) }
        };

        globalThis.getExtensionApi = () => api3;
        globalThis.getBrowserEnv = () => ({ isFirefox: false, isChromium: true });
        globalThis.registerZvukHandlers = registerMock;
        globalThis.serviceMessageHandlers = [
            [['customSvcAction', (msg, sender, respond) => {
                respond({ ok: true, custom: true });
                return true;
            }]]
        ];

        vi.resetModules();
        await import('../../background/MessageRouter.js');
    });

    function dispatch3(msg, sender = {}) {
        return new Promise(resolve => {
            let responded = false;
            for (const listener of api3Listeners) {
                const sendResponse = (resp) => {
                    if (!responded) { responded = true; resolve(resp); }
                };
                const returned = listener(msg, sender, sendResponse);
                if (!returned) break;
            }
            setTimeout(() => resolve(null), 100);
        });
    }

    it('вызывает registerZvukHandlers при загрузке модуля', () => {
        expect(registerMock).toHaveBeenCalled();
    });

    it('регистрирует action из serviceMessageHandlers', async () => {
        const resp = await dispatch3({ action: 'customSvcAction' });
        expect(resp?.ok).toBe(true);
        expect(resp?.custom).toBe(true);
    });
});
