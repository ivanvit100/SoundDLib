import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadModule } from '../helpers/loadModule.js';

beforeAll(() => {
    globalThis.getExtensionApi = vi.fn(() => ({
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({
                ok: true,
                trackId: 'track1',
                type: 'audio',
                mimeType: 'audio/mpeg',
                data: [1, 2, 3],
                url: null,
                masterUrl: null,
                qualities: null,
                meta: { title: 'Test Track', artist: 'Test Artist', cover: 'https://cover.com/img.jpg' }
            }),
            onMessage: { addListener: vi.fn() }
        },
        tabs: {
            sendMessage: vi.fn().mockResolvedValue({ ok: true })
        }
    }));

    globalThis.SingleTrackManager = class {
        constructor() {
            this.eventBus = { on: vi.fn(), emit: vi.fn(), off: vi.fn() };
        }
        async download() { return { success: true, filename: 'track.mp3' }; }
    };

    globalThis.AudioConverter = class {
        constructor() {}
        async convert(buf, mime, format) { return new ArrayBuffer(10); }
    };

    globalThis.ConverterRegistry = {
        getFormats: vi.fn(() => [
            { value: 'mp3', label: 'MP3 320 kbps' },
            { value: 'flac', label: 'FLAC' }
        ]),
        getMeta: vi.fn((id) => ({ ext: id, mimeType: `audio/${id}` }))
    };

    globalThis.Storage = {
        get: vi.fn(() => null),
        set: vi.fn()
    };

    loadModule('ui/SingleTrackController.js');
});

function makeService(overrides = {}) {
    return {
        name: 'zvuk',
        color: '#22c375',
        logo: 'icons/logo.png',
        constructor: {
            capturePatterns: [],
            isPlaylistPage: () => false
        },
        fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'T', artist: 'A', cover: null }),
        ...overrides
    };
}

function setupDom() {
    document.body.innerHTML = `
        <select id="formatSelector"></select>
        <div id="qualityContainer" style="display:none">
            <select id="qualitySelector"></select>
        </div>
        <button id="downloadBtn">Download</button>
        <div id="status"></div>
        <div id="progressBar" style="display:none"></div>
        <progress id="progress" value="0" max="100"></progress>
        <img id="cover" />
        <div id="description"></div>
        <div id="logoInfo"></div>
        <button id="playPauseBtn"></button>
        <div id="playerSection" style="display:none"></div>
        <progress id="seekBar" value="0" max="100"></progress>
        <div id="currentTime"></div>
        <div id="totalTime"></div>
    `;
}

describe('SingleTrackController', () => {
    it('SingleTrackController класс существует', () => {
        expect(globalThis.SingleTrackController).toBeDefined();
    });

    describe('constructor', () => {
        it('создаёт контроллер с сервисом', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            expect(ctrl.service).toBeDefined();
            expect(ctrl.manager).toBeDefined();
        });

        it('принимает опции standalone, autoDownload, zvukTrackId, trackMeta', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {
                standalone: true,
                autoDownload: false,
                zvukTrackId: '123',
                trackMeta: { title: 'T', artist: 'A', cover: null }
            });
            expect(ctrl._standalone).toBe(true);
            expect(ctrl._zvukTrackId).toBe('123');
        });
    });

    describe('_populateFormatSelector', () => {
        it('заполняет select форматами', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._populateFormatSelector();
            const select = document.getElementById('formatSelector');
            expect(select.options.length).toBeGreaterThan(0);
        });
    });

    describe('_subscribeToCapture', () => {
        it('не бросает', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            expect(() => ctrl._subscribeToCapture()).not.toThrow();
        });
    });

    describe('_loadTrackInfo', () => {
        it('загружает информацию о треке', async () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            await ctrl._loadTrackInfo();
            expect(ctrl._latestTrackId).toBe('track1');
        });

        it('использует trackMeta если задан', async () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {
                zvukTrackId: '42',
                trackMeta: { title: 'Meta Title', artist: 'Meta Artist', cover: null }
            });
            vi.spyOn(ctrl, '_renderTrackMeta');
            await ctrl._loadTrackInfo();
            expect(ctrl._renderTrackMeta).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Meta Title' })
            );
        });

        it('загружает через probeCdnForTrack для zvukTrackId без trackMeta', async () => {
            setupDom();
            globalThis.getExtensionApi = vi.fn(() => ({
                runtime: {
                    sendMessage: vi.fn().mockImplementation(async (msg) => {
                        if (msg.action === 'probeCdnForTrack') {
                            return { ok: true, trackId: 'probe-track', qualities: [] };
                        }
                        return { ok: false };
                    }),
                    onMessage: { addListener: vi.fn() }
                }
            }));
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {
                zvukTrackId: '99'
            });
            await ctrl._loadTrackInfo();
        });
    });

    describe('_renderTrackMeta', () => {
        it('обновляет DOM с информацией о треке', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._renderTrackMeta({ title: 'Track Title', artist: 'Track Artist', cover: 'https://img.com/cover.jpg' });
            const desc = document.getElementById('description');
            expect(desc.querySelector('strong').textContent).toBe('Track Title');
        });

        it('показывает qualityContainer для HLS треков', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._populateQualitySelector([
                { bandwidth: 320000, url: 'https://cdn.example.com/320.m3u8', label: 'HQ' },
                { bandwidth: 128000, url: 'https://cdn.example.com/128.m3u8', label: 'LQ' }
            ]);
            expect(document.getElementById('qualityContainer').style.display).not.toBe('none');
        });
    });

    describe('_startDownload', () => {
        it('запускает загрузку и показывает progress', async () => {
            setupDom();
            globalThis.getExtensionApi = vi.fn(() => ({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        trackId: 'dl-track',
                        type: 'audio',
                        mimeType: 'audio/mpeg',
                        data: null,
                        url: null,
                        masterUrl: null,
                        qualities: null,
                        meta: { title: 'T', artist: 'A', cover: null }
                    }),
                    onMessage: { addListener: vi.fn() }
                }
            }));
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._latestTrackId = 'dl-track';
            ctrl.manager.download = vi.fn().mockResolvedValue({ success: true, filename: 'track.mp3' });
            await ctrl._startDownload();
            expect(ctrl.manager.download).toHaveBeenCalled();
        });

        it('не запускает если уже загружается', async () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._isDownloading = true;
            ctrl.manager.download = vi.fn();
            await ctrl._startDownload();
            expect(ctrl.manager.download).not.toHaveBeenCalled();
        });
    });

    describe('_bindEvents', () => {
        it('не бросает при bind events', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            expect(() => ctrl._bindEvents()).not.toThrow();
        });
    });

    describe('_startPlaybackPolling', () => {
        it('не бросает', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            vi.useFakeTimers();
            expect(() => ctrl._startPlaybackPolling()).not.toThrow();
            vi.useRealTimers();
        });
    });
});
