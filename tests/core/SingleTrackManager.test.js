import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

describe('SingleTrackManager — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../core/SingleTrackManager.js');
        vi.unstubAllGlobals();
        expect(globalThis.SingleTrackManager).toBeDefined();
    });
});

beforeAll(() => {
    globalThis.EventBus = globalThis.EventBus;

    globalThis.ConverterRegistry = {
        getMeta: vi.fn((format) => ({
            ext: format === 'flac' ? 'flac' : 'mp3',
            mimeType: format === 'flac' ? 'audio/flac' : 'audio/mpeg'
        }))
    };

    globalThis.DownloadHistory = {
        add: vi.fn()
    };

    globalThis.serviceRegistry = {
        getService: vi.fn((name) => ({
            getAudioData: vi.fn().mockResolvedValue({ data: new ArrayBuffer(100), mimeType: 'audio/mp4' }),
            fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'Full Track', artist: 'Full Artist', cover: 'https://cover.com/img.jpg' })
        }))
    };
});

import '../../core/EventBus.js';
import '../../core/SingleTrackManager.js';

function makeConverter(format = 'mp3') {
    return {
        convert: vi.fn().mockResolvedValue(new ArrayBuffer(50))
    };
}

function makeApi(overrides = {}) {
    return {
        runtime: {
            sendMessage: vi.fn().mockImplementation(async (msg) => {
                if (msg.action === 'getLatestTrack' || msg.action === 'getTrack') {
                    return overrides.track || {
                        ok: true,
                        trackId: 'track1',
                        type: 'audio',
                        mimeType: 'audio/mpeg',
                        data: [1, 2, 3],
                        url: null,
                        masterUrl: null,
                        meta: { title: 'Test Track', artist: 'Test Artist', cover: null }
                    };
                }
                if (msg.action === 'fetchAudioTrack') {
                    return overrides.fetchAudio || {
                        ok: true,
                        data: [1, 2, 3],
                        mimeType: 'audio/mpeg'
                    };
                }
                return overrides.default || {};
            }),
            ...overrides.runtime
        }
    };
}

describe('SingleTrackManager', () => {
    it('SingleTrackManager класс существует', () => {
        expect(globalThis.SingleTrackManager).toBeDefined();
    });

    it('создаёт EventBus', () => {
        const mgr = new globalThis.SingleTrackManager();
        expect(mgr.eventBus).toBeDefined();
    });

    describe('download', () => {
        beforeEach(() => {
            globalThis.getExtensionApi = () => makeApi();
        });

        it('скачивает аудио трек успешно', async () => {
            const mgr = new globalThis.SingleTrackManager();
            const events = [];
            mgr.eventBus.on('download:completed', (e) => events.push(e));

            const result = await mgr.download('track1', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
            expect(result.filename).toMatch(/\.mp3$/);
            expect(events).toHaveLength(1);
        });

        it('скачивает когда нет trackId (getLatestTrack)', async () => {
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download(null, 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
        });

        it('бросает если трек не найден', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: { ok: false, error: 'Track not found' }
            });
            const mgr = new globalThis.SingleTrackManager();
            const failEvents = [];
            mgr.eventBus.on('download:failed', (e) => failEvents.push(e));
            await expect(mgr.download('bad-id', 'mp3', null, makeConverter())).rejects.toThrow('Track not found');
            expect(failEvents).toHaveLength(1);
        });

        it('бросает Трек не найден если нет error поля', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: { ok: false }
            });
            const mgr = new globalThis.SingleTrackManager();
            await expect(mgr.download('bad-id', 'mp3', null, makeConverter())).rejects.toThrow(/Трек не найден/);
        });

        it('загружает аудио через url если нет data', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'url-track',
                    type: 'audio',
                    mimeType: 'audio/mpeg',
                    data: null,
                    url: 'https://cdn.example.com/audio.mp3',
                    masterUrl: null,
                    meta: { title: 'URL Track' }
                }
            });
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download('url-track', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
        });

        it('использует resp.meta={} если meta null', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'null-meta',
                    type: 'audio',
                    mimeType: 'audio/mpeg',
                    data: [1, 2, 3],
                    url: null,
                    masterUrl: null,
                    meta: null
                }
            });
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download('null-meta', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
        });

        it('использует resp.mimeType если fetchedMime пустой', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'no-mime',
                    type: 'audio',
                    mimeType: 'audio/mp4',
                    data: null,
                    url: 'https://cdn.example.com/audio.mp4',
                    masterUrl: null,
                    meta: { title: 'T' }
                },
                fetchAudio: { ok: true, data: [1, 2, 3], mimeType: undefined }
            });
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download('no-mime', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
        });

        it('бросает если fetchAudioTrack возвращает не-audio mime', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'bad-mime',
                    type: 'audio',
                    data: null,
                    url: 'https://cdn.example.com/file',
                    masterUrl: null,
                    meta: {}
                },
                fetchAudio: { ok: true, data: [1, 2], mimeType: 'text/html' }
            });
            const mgr = new globalThis.SingleTrackManager();
            await expect(mgr.download('bad-mime', 'mp3', null, makeConverter())).rejects.toThrow(/CDN вернул/);
        });

        it('бросает если fetchAudioTrack не ok', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'fetch-fail',
                    type: 'audio',
                    data: null,
                    url: 'https://cdn.example.com/fail',
                    masterUrl: null,
                    meta: {}
                },
                fetchAudio: { ok: false, error: 'fetch failed' }
            });
            const mgr = new globalThis.SingleTrackManager();
            await expect(mgr.download('fetch-fail', 'mp3', null, makeConverter())).rejects.toThrow('fetch failed');
        });

        it('бросает если нет data и нет url', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'empty',
                    type: 'audio',
                    data: null,
                    url: null,
                    masterUrl: null,
                    meta: {}
                }
            });
            const mgr = new globalThis.SingleTrackManager();
            await expect(mgr.download('empty', 'mp3', null, makeConverter())).rejects.toThrow(/Нет данных/);
        });

        it('использует service.getAudioData для HLS треков', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'hls1',
                    type: 'hls',
                    mimeType: 'audio/mp4',
                    masterUrl: 'https://cdn.zvuk.com/drm/track/777_2/master.m3u8',
                    qualities: [{ url: 'https://cdn.example.com/q.m3u8', label: 'HQ' }],
                    data: null,
                    url: null,
                    meta: { title: 'HLS Track' }
                }
            });
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download('hls1', 'mp3', 'https://cdn.example.com/q.m3u8', makeConverter());
            expect(result.success).toBe(true);
        });

        it('progress callback для key, init, segment фаз', async () => {
            globalThis.serviceRegistry.getService = vi.fn(() => ({
                getAudioData: vi.fn().mockImplementation(async (resp, opts, api, progressCb) => {
                    progressCb('key', 0, 0);
                    progressCb('init', 0, 0);
                    progressCb('segment', 0, 3);
                    progressCb('segment', 2, 3);
                    return { data: new ArrayBuffer(100), mimeType: 'audio/mp4' };
                }),
                fetchTrackMeta: vi.fn().mockResolvedValue({})
            }));
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true, trackId: 'hls-cb', type: 'hls', mimeType: 'audio/mp4',
                    masterUrl: 'https://cdn.zvuk.com/drm/track/888_2/master.m3u8',
                    data: null, url: null, meta: {}
                }
            });
            const mgr = new globalThis.SingleTrackManager();
            const progressEvents = [];
            mgr.eventBus.on('download:progress', e => progressEvents.push(e));
            const result = await mgr.download('hls-cb', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
            const msgs = progressEvents.map(e => e.message);
            expect(msgs).toContain('Получение ключа...');
            expect(msgs).toContain('Инициализация потока...');
            expect(msgs.some(m => m.startsWith('Сегменты:'))).toBe(true);
            globalThis.serviceRegistry.getService = vi.fn((name) => ({
                getAudioData: vi.fn().mockResolvedValue({ data: new ArrayBuffer(100), mimeType: 'audio/mp4' }),
                fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'T', artist: 'A', cover: 'https://img.com/c.jpg' })
            }));
        });

        it('converter progress callback вызывается', async () => {
            globalThis.getExtensionApi = () => makeApi();
            const converterWithProgress = {
                convert: vi.fn().mockImplementation(async (buf, mimeType, format, progressCb) => {
                    if (progressCb) { progressCb(0); progressCb(50); progressCb(100); }
                    return new ArrayBuffer(50);
                })
            };
            const mgr = new globalThis.SingleTrackManager();
            const progressEvents = [];
            mgr.eventBus.on('download:progress', e => progressEvents.push(e));
            const result = await mgr.download('track1', 'mp3', null, converterWithProgress);
            expect(result.success).toBe(true);
            expect(progressEvents.some(e => e.message === 'Конвертация...')).toBe(true);
        });

        it('progress callback с неизвестной фазой не падает', async () => {
            globalThis.serviceRegistry.getService = vi.fn(() => ({
                getAudioData: vi.fn().mockImplementation(async (resp, opts, api, progressCb) => {
                    progressCb('unknown_phase', 0, 0);
                    return { data: new ArrayBuffer(100), mimeType: 'audio/mp4' };
                }),
                fetchTrackMeta: vi.fn().mockResolvedValue({})
            }));
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true, trackId: 'hls-unk', type: 'hls', mimeType: 'audio/mp4',
                    masterUrl: 'https://cdn.zvuk.com/drm/track/888_2/master.m3u8',
                    data: null, url: null, meta: {}
                }
            });
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download('hls-unk', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
            globalThis.serviceRegistry.getService = vi.fn((name) => ({
                getAudioData: vi.fn().mockResolvedValue({ data: new ArrayBuffer(100), mimeType: 'audio/mp4' }),
                fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'T', artist: 'A', cover: 'https://img.com/c.jpg' })
            }));
        });

        it('бросает если fetchAudioTrack не ok без error поля', async () => {
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'fetch-fail2',
                    type: 'audio',
                    data: null,
                    url: 'https://cdn.example.com/fail2',
                    masterUrl: null,
                    meta: {}
                },
                fetchAudio: { ok: false }
            });
            const mgr = new globalThis.SingleTrackManager();
            await expect(mgr.download('fetch-fail2', 'mp3', null, makeConverter())).rejects.toThrow(/Не удалось загрузить/);
        });

        it('использует chrome если getExtensionApi не функция', async () => {
            const mockChrome = makeApi();
            const origGetApi = globalThis.getExtensionApi;
            globalThis.getExtensionApi = null;
            globalThis.chrome = mockChrome;
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download('track1', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
            globalThis.getExtensionApi = origGetApi;
            globalThis.chrome = undefined;
        });

        it('использует browser если нет getExtensionApi и chrome', async () => {
            const mockBrowser = makeApi();
            const origGetApi = globalThis.getExtensionApi;
            globalThis.getExtensionApi = null;
            globalThis.chrome = undefined;
            globalThis.browser = mockBrowser;
            const mgr = new globalThis.SingleTrackManager();
            const result = await mgr.download('track1', 'mp3', null, makeConverter());
            expect(result.success).toBe(true);
            globalThis.getExtensionApi = origGetApi;
            globalThis.browser = undefined;
        });

        it('бросает если сервис не найден в реестре', async () => {
            globalThis.serviceRegistry.getService = vi.fn(() => null);
            globalThis.getExtensionApi = () => makeApi({
                track: {
                    ok: true,
                    trackId: 'hls2',
                    type: 'hls',
                    masterUrl: null,
                    data: null,
                    url: null,
                    meta: {}
                }
            });
            const mgr = new globalThis.SingleTrackManager();
            await expect(mgr.download('hls2', 'mp3', null, makeConverter())).rejects.toThrow(/не найден/);
            globalThis.serviceRegistry.getService = vi.fn((name) => ({
                getAudioData: vi.fn().mockResolvedValue({ data: new ArrayBuffer(100), mimeType: 'audio/mp4' }),
                fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'T', artist: 'A', cover: 'https://img.com/c.jpg' })
            }));
        });
    });

    describe('_enrichMeta', () => {
        it('не обогащает если cover уже задан', async () => {
            const mgr = new globalThis.SingleTrackManager();
            const meta = { title: 'T', cover: 'https://already.com/cover.jpg' };
            await mgr._enrichMeta(meta, { masterUrl: null, url: null });
            expect(meta.cover).toBe('https://already.com/cover.jpg');
        });

        it('не обогащает если нет zvukId в url', async () => {
            const mgr = new globalThis.SingleTrackManager();
            const meta = { title: 'T' };
            await mgr._enrichMeta(meta, { masterUrl: 'https://other.com/audio.mp3' });
            expect(meta.cover).toBeUndefined();
        });

        it('обогащает meta из сервиса если есть zvukId', async () => {
            const mgr = new globalThis.SingleTrackManager();
            const meta = { title: 'T' };
            await mgr._enrichMeta(meta, {
                masterUrl: 'https://cdn.zvuk.com/drm/track/777/master.m3u8'
            });
            expect(meta.cover).toBeTruthy();
        });

        it('не обогащает если сервис не найден', async () => {
            const origGetService = globalThis.serviceRegistry.getService;
            globalThis.serviceRegistry.getService = vi.fn(() => null);
            const mgr = new globalThis.SingleTrackManager();
            const meta = { title: 'T' };
            await mgr._enrichMeta(meta, {
                masterUrl: 'https://cdn.zvuk.com/drm/track/999/master.m3u8'
            });
            expect(meta.cover).toBeUndefined();
            globalThis.serviceRegistry.getService = origGetService;
        });
    });

    describe('_buildFilename', () => {
        it('создаёт filename с artist и title', () => {
            const mgr = new globalThis.SingleTrackManager();
            expect(mgr._buildFilename({ artist: 'Artist', title: 'Track' }, 'mp3')).toBe('Artist - Track.mp3');
        });

        it('создаёт filename только с title', () => {
            const mgr = new globalThis.SingleTrackManager();
            expect(mgr._buildFilename({ title: 'Track' }, 'flac')).toBe('Track.flac');
        });

        it('использует "track" если нет ни artist ни title', () => {
            const mgr = new globalThis.SingleTrackManager();
            expect(mgr._buildFilename({}, 'mp3')).toBe('track.mp3');
        });

        it('заменяет недопустимые символы', () => {
            const mgr = new globalThis.SingleTrackManager();
            expect(mgr._buildFilename({ title: 'Track: Part 1/2' }, 'mp3')).toBe('Track_ Part 1_2.mp3');
        });
    });

    describe('_saveFile', () => {
        it('создаёт ссылку, кликает и убирает через таймер', () => {
            const mgr = new globalThis.SingleTrackManager();
            vi.useFakeTimers();
            document.querySelectorAll('a[download]').forEach(a => a.remove());
            const blob = new Blob(['test'], { type: 'audio/mpeg' });
            expect(() => mgr._saveFile(blob, 'track.mp3')).not.toThrow();
            const links = document.querySelectorAll('a[download]');
            const link = links[links.length - 1];
            expect(link).toBeTruthy();
            expect(link.download).toBe('track.mp3');
            vi.advanceTimersByTime(10001);
            vi.clearAllTimers();
            vi.useRealTimers();
        });
    });
});
