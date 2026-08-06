import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import '../../core/EventBus.js';

beforeAll(() => {
    globalThis.ConverterRegistry = {
        getMeta: vi.fn(() => ({ ext: 'mp3', mimeType: 'audio/mpeg' }))
    };
    globalThis.DownloadHistory = { add: vi.fn() };
    globalThis.fflate = {
        Zip: class {
            constructor(cb) { this._cb = cb; }
            add(deflate) { deflate._zip = this; }
            end() {}
        },
        ZipDeflate: class {
            constructor(name, opts) { this.name = name; }
            push(data, final) {}
        }
    };
});

import '../../core/PlaylistManager.js';

function makeTracks(n = 2) {
    return Array.from({ length: n }, (_, i) => ({
        id: String(i + 1),
        title: `Track ${i + 1}`,
        artist: `Artist ${i + 1}`,
        cover: null,
        streamUrl: null
    }));
}

function makeConverter() {
    return { convert: vi.fn().mockResolvedValue(new ArrayBuffer(10)) };
}

function makeService() {
    return {
        fetchAllPlaylistTracks: vi.fn().mockResolvedValue(makeTracks()),
        getAudioData: vi.fn().mockResolvedValue({ data: new ArrayBuffer(10), mimeType: 'audio/mp4' })
    };
}

function makeApi(overrides = {}) {
    return {
        runtime: {
            sendMessage: vi.fn().mockImplementation(async (msg) => {
                if (msg.action === 'resolveCdnUrl') {
                    return overrides.probe || {
                        ok: true,
                        masterUrl: 'https://cdn.zvuk.com/drm/track/1_2/master.m3u8',
                        qualities: [{ bandwidth: 320000, url: 'https://cdn.example.com/320.m3u8', label: 'HQ' }]
                    };
                }
                if (msg.action === 'fetchAudioTrack') {
                    return overrides.fetchAudio || { ok: true, data: [1, 2, 3], mimeType: 'audio/mpeg' };
                }
                return {};
            })
        }
    };
}

describe('PlaylistManager', () => {
    it('PlaylistManager класс существует', () => {
        expect(globalThis.PlaylistManager).toBeDefined();
    });

    it('создаёт EventBus', () => {
        const mgr = new globalThis.PlaylistManager();
        expect(mgr.eventBus).toBeDefined();
    });

    describe('loadPlaylist', () => {
        it('загружает треки и эмитит события', async () => {
            const mgr = new globalThis.PlaylistManager();
            const service = makeService();
            const events = [];
            mgr.eventBus.on('playlist:ready', (e) => events.push(e));
            const tracks = await mgr.loadPlaylist(service, '42');
            expect(tracks).toHaveLength(2);
            expect(events[0].tracks).toHaveLength(2);
        });

        it('передаёт onProgress callback', async () => {
            const mgr = new globalThis.PlaylistManager();
            const service = {
                fetchAllPlaylistTracks: vi.fn(async (id, cb) => {
                    if (cb) cb(1, 2);
                    return makeTracks();
                })
            };
            const discoveryEvents = [];
            mgr.eventBus.on('playlist:discovery', (e) => discoveryEvents.push(e));
            await mgr.loadPlaylist(service, '1');
            expect(discoveryEvents.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('downloadAll', () => {
        beforeEach(() => {
            globalThis.getExtensionApi = () => makeApi();
        });

        it('скачивает все треки', async () => {
            const mgr = new globalThis.PlaylistManager();
            const tracks = makeTracks();
            tracks.forEach(t => { t.streamUrl = 'https://cdn.example.com/audio.mp3'; });
            const events = [];
            mgr.eventBus.on('download:completed', (e) => events.push(e));
            const result = await mgr.downloadAll(tracks, 'mp3', makeConverter(), makeService());
            expect(result.done).toBe(2);
            expect(result.failed).toBe(0);
        });

        it('скачивает через CDN probe если нет streamUrl', async () => {
            const mgr = new globalThis.PlaylistManager();
            const tracks = makeTracks();
            const service = makeService();
            const result = await mgr.downloadAll(tracks, 'mp3', makeConverter(), service);
            expect(result.done).toBe(2);
        });

        it('считает failed треки при ошибке', async () => {
            globalThis.getExtensionApi = () => makeApi({
                probe: { ok: false, error: 'CDN error' }
            });
            const mgr = new globalThis.PlaylistManager();
            const tracks = makeTracks();
            const result = await mgr.downloadAll(tracks, 'mp3', makeConverter(), makeService());
            expect(result.failed).toBe(2);
        });

        it('останавливается при shouldStop', async () => {
            const mgr = new globalThis.PlaylistManager();
            const tracks = makeTracks(5);
            tracks.forEach(t => { t.streamUrl = 'https://cdn.example.com/audio.mp3'; });
            let callCount = 0;
            const service = makeService();

            globalThis.getExtensionApi = () => ({
                runtime: {
                    sendMessage: vi.fn().mockImplementation(async (msg) => {
                        callCount++;
                        if (callCount >= 2) mgr._controller?.stop();
                        return { ok: true, data: [1, 2], mimeType: 'audio/mpeg' };
                    })
                }
            });

            const result = await mgr.downloadAll(tracks, 'mp3', makeConverter(), service);
            expect(result.done).toBeLessThan(5);
        });

        it('добавляет запись в DownloadHistory', async () => {
            globalThis.getExtensionApi = () => makeApi();
            const mgr = new globalThis.PlaylistManager();
            const tracks = makeTracks();
            tracks.forEach(t => { t.streamUrl = 'https://cdn.example.com/audio.mp3'; });
            await mgr.downloadAll(tracks, 'mp3', makeConverter(), makeService());
            expect(globalThis.DownloadHistory.add).toHaveBeenCalled();
        });

        it('onSeg callback key/init/segment в downloadAll (lines 57-61)', async () => {
            globalThis.getExtensionApi = () => makeApi();
            const service = {
                fetchAllPlaylistTracks: vi.fn().mockResolvedValue(makeTracks()),
                getAudioData: vi.fn().mockImplementation(async (resp, opts, api, onSeg) => {
                    onSeg('key', 0, 0);
                    onSeg('init', 0, 0);
                    onSeg('segment', 0, 3);
                    onSeg('segment', 2, 3);
                    return { data: new ArrayBuffer(10), mimeType: 'audio/mp4' };
                })
            };
            const mgr = new globalThis.PlaylistManager();
            const tracks = [{ id: '1', title: 'T', artist: 'A', streamUrl: null }];
            const progressEvents = [];
            mgr.eventBus.on('download:progress', e => progressEvents.push(e));
            const result = await mgr.downloadAll(tracks, 'mp3', makeConverter(), service);
            expect(result.done).toBe(1);
            const msgs = progressEvents.map(e => e.message);
            expect(msgs.some(m => m.includes('ключ'))).toBe(true);
            expect(msgs.some(m => m.includes('инит'))).toBe(true);
            expect(msgs.some(m => m.includes('сегмент'))).toBe(true);
        });
    });

    describe('downloadAllAsZip', () => {
        beforeEach(() => {
            globalThis.getExtensionApi = () => makeApi();
            globalThis.showSaveFilePicker = undefined;
        });

        it('создаёт zip blob без showSaveFilePicker', async () => {
            const mgr = new globalThis.PlaylistManager();
            const tracks = makeTracks();
            tracks.forEach(t => { t.streamUrl = 'https://cdn.example.com/audio.mp3'; });
            const result = await mgr.downloadAllAsZip(tracks, 'mp3', makeConverter(), 'My Playlist', makeService());
            expect(result.done).toBe(2);
        });

        it('отменяется при showSaveFilePicker throw', async () => {
            globalThis.showSaveFilePicker = vi.fn().mockRejectedValue(new Error('user cancelled'));
            const mgr = new globalThis.PlaylistManager();
            const result = await mgr.downloadAllAsZip(makeTracks(), 'mp3', makeConverter(), 'Playlist', makeService());
            expect(result.cancelled).toBe(true);
        });

        it('пишет в writable при showSaveFilePicker OK', async () => {
            const chunks = [];
            const mockWritable = { write: vi.fn(c => chunks.push(c)), close: vi.fn() };
            const mockHandle = { createWritable: vi.fn().mockResolvedValue(mockWritable) };
            globalThis.showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

            const mgr = new globalThis.PlaylistManager();
            const tracks = makeTracks(1);
            tracks[0].streamUrl = 'https://cdn.example.com/audio.mp3';
            await mgr.downloadAllAsZip(tracks, 'mp3', makeConverter(), 'Playlist', makeService());
            expect(mockWritable.close).toHaveBeenCalled();
        });

        it('onSeg callback в downloadAllAsZip (lines 148-152)', async () => {
            globalThis.showSaveFilePicker = undefined;
            globalThis.getExtensionApi = () => makeApi();
            const service = {
                fetchAllPlaylistTracks: vi.fn().mockResolvedValue(makeTracks()),
                getAudioData: vi.fn().mockImplementation(async (resp, opts, api, onSeg) => {
                    onSeg('key', 0, 0);
                    onSeg('init', 0, 0);
                    onSeg('segment', 1, 2);
                    return { data: new ArrayBuffer(10), mimeType: 'audio/mp4' };
                })
            };
            const mgr = new globalThis.PlaylistManager();
            const tracks = [{ id: '1', title: 'T', artist: 'A', streamUrl: null }];
            const progressEvents = [];
            mgr.eventBus.on('download:progress', e => progressEvents.push(e));
            const result = await mgr.downloadAllAsZip(tracks, 'mp3', makeConverter(), 'PL', service);
            expect(result.done).toBe(1);
            expect(progressEvents.some(e => e.message?.includes('ключ'))).toBe(true);
        });

        it('пишет pendingChunks в writable когда chunks не пусты (line 176)', async () => {
            const testChunk = new Uint8Array([1, 2, 3]);
            const origFflate = globalThis.fflate;
            globalThis.fflate = {
                Zip: class {
                    constructor(cb) { this._cb = cb; }
                    add(deflate) { deflate._zip = this; }
                    end() {}
                },
                ZipDeflate: class {
                    constructor(name, opts) { this.name = name; }
                    push(data, final) {
                        if (this._zip?._cb) this._zip._cb(null, data);
                    }
                }
            };

            const mockWritable = { write: vi.fn(), close: vi.fn() };
            const mockHandle = { createWritable: vi.fn().mockResolvedValue(mockWritable) };
            globalThis.showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);
            globalThis.getExtensionApi = () => makeApi();

            const mgr = new globalThis.PlaylistManager();
            const tracks = [{ id: '1', title: 'T', artist: 'A', streamUrl: 'https://cdn.example.com/audio.mp3' }];
            await mgr.downloadAllAsZip(tracks, 'mp3', makeConverter(), 'Playlist', makeService());

            globalThis.fflate = origFflate;
            globalThis.showSaveFilePicker = undefined;
            expect(mockWritable.write).toHaveBeenCalled();
        });

        it('считает failed треки в downloadAllAsZip (lines 180-181)', async () => {
            globalThis.showSaveFilePicker = undefined;
            globalThis.getExtensionApi = () => makeApi({ probe: { ok: false, error: 'CDN fail' } });
            const mgr = new globalThis.PlaylistManager();
            const tracks = [{ id: '1', title: 'T', artist: 'A', streamUrl: null }];
            const result = await mgr.downloadAllAsZip(tracks, 'mp3', makeConverter(), 'PL', makeService());
            expect(result.failed).toBe(1);
        });
    });

    describe('_fetchTrackBuffer', () => {
        it('загружает через streamUrl', async () => {
            const mgr = new globalThis.PlaylistManager();
            const api = makeApi();
            const track = { id: '1', streamUrl: 'https://cdn.example.com/audio.mp3' };
            const result = await mgr._fetchTrackBuffer(track, makeService(), api, null);
            expect(result.buffer).toBeDefined();
        });

        it('бросает если streamUrl fetch не OK', async () => {
            const mgr = new globalThis.PlaylistManager();
            const api = makeApi({ fetchAudio: { ok: false, error: 'stream error' } });
            const track = { id: '1', streamUrl: 'https://cdn.example.com/audio.mp3' };
            await expect(mgr._fetchTrackBuffer(track, makeService(), api, null)).rejects.toThrow('stream error');
        });

        it('загружает через CDN probe', async () => {
            const mgr = new globalThis.PlaylistManager();
            const api = makeApi();
            const track = { id: '2', streamUrl: null };
            const service = makeService();
            const result = await mgr._fetchTrackBuffer(track, service, api, null);
            expect(result.buffer).toBeDefined();
        });

        it('бросает если CDN probe не OK', async () => {
            const mgr = new globalThis.PlaylistManager();
            const api = makeApi({ probe: { ok: false, error: 'probe failed' } });
            const track = { id: '3', streamUrl: null };
            await expect(mgr._fetchTrackBuffer(track, makeService(), api, null)).rejects.toThrow('probe failed');
        });

        it('бросает если нет qualities', async () => {
            const mgr = new globalThis.PlaylistManager();
            const api = makeApi({
                probe: { ok: true, masterUrl: 'https://cdn.example.com/master.m3u8', qualities: [] }
            });
            const track = { id: '4', streamUrl: null };
            await expect(mgr._fetchTrackBuffer(track, makeService(), api, null)).rejects.toThrow(/No stream quality/);
        });
    });

    describe('pause/resume/stop', () => {
        it('pause и resume работают', async () => {
            const mgr = new globalThis.PlaylistManager();
            mgr._controller = mgr._createController();
            expect(mgr._controller.isPaused()).toBe(false);
            mgr.pause();
            expect(mgr._controller.isPaused()).toBe(true);
            mgr.resume();
            expect(mgr._controller.isPaused()).toBe(false);
        });

        it('stop устанавливает shouldStop', () => {
            const mgr = new globalThis.PlaylistManager();
            mgr._controller = mgr._createController();
            expect(mgr._controller.shouldStop()).toBe(false);
            mgr.stop();
            expect(mgr._controller.shouldStop()).toBe(true);
        });

        it('pause/resume/stop не бросают если нет controller', () => {
            const mgr = new globalThis.PlaylistManager();
            expect(() => mgr.pause()).not.toThrow();
            expect(() => mgr.resume()).not.toThrow();
            expect(() => mgr.stop()).not.toThrow();
        });

        it('waitIfPaused ожидает пока контроллер на паузе (line 251)', async () => {
            vi.useFakeTimers();
            const mgr = new globalThis.PlaylistManager();
            mgr._controller = mgr._createController();
            mgr._controller.pause();

            const waitPromise = mgr._controller.waitIfPaused();
            mgr._controller.resume();
            vi.advanceTimersByTime(200);

            await waitPromise;
            vi.useRealTimers();
            expect(mgr._controller.isPaused()).toBe(false);
        });
    });

    describe('_buildFilename', () => {
        it('включает idx, artist, title', () => {
            const mgr = new globalThis.PlaylistManager();
            const name = mgr._buildFilename('01', { artist: 'Artist', title: 'Track' }, 'mp3');
            expect(name).toBe('01 - Artist - Track.mp3');
        });

        it('заменяет недопустимые символы', () => {
            const mgr = new globalThis.PlaylistManager();
            const name = mgr._buildFilename('01', { title: 'A/B:C' }, 'flac');
            expect(name).toMatch(/01 - A_B_C\.flac/);
        });
    });

    describe('_saveFile', () => {
        it('создаёт ссылку и кликает', () => {
            const mgr = new globalThis.PlaylistManager();
            vi.useFakeTimers();
            const blob = new Blob(['test'], { type: 'application/zip' });
            expect(() => mgr._saveFile(blob, 'playlist.zip')).not.toThrow();
            vi.useRealTimers();
        });
    });
});
