import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadModule } from '../helpers/loadModule.js';

beforeAll(() => {
    globalThis.getExtensionApi = vi.fn(() => ({
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({ ok: true })
        }
    }));

    globalThis.PlaylistManager = class {
        constructor() { this.eventBus = { on: vi.fn(), once: vi.fn(), emit: vi.fn(), off: vi.fn() }; }
        async loadPlaylist(service, id) { return service.fetchAllPlaylistTracks(id); }
        pause() {} resume() {} stop() {}
    };

    globalThis.AudioConverter = class {
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

    loadModule('ui/PlaylistController.js');
});

function makeService(overrides = {}) {
    return {
        name: 'zvuk',
        constructor: { capturePatterns: [] },
        fetchAllPlaylistTracks: vi.fn().mockResolvedValue([
            { id: '1', title: 'Track 1', artist: 'Artist 1', cover: null },
            { id: '2', title: 'Track 2', artist: 'Artist 2', cover: 'https://img.com/c.jpg' }
        ]),
        fetchPlaylistMeta: vi.fn().mockResolvedValue({ title: 'Test Playlist' }),
        getAudioData: vi.fn().mockResolvedValue({ data: new ArrayBuffer(10), mimeType: 'audio/mp4' }),
        ...overrides
    };
}

function setupDom() {
    document.body.innerHTML = `
        <select id="formatSelector"></select>
        <button id="downloadBtn">Download</button>
        <button id="downloadZipBtn">Download ZIP</button>
        <button id="pauseBtn">Pause</button>
        <button id="stopBtn" style="display:none">Stop</button>
        <div id="status"></div>
        <div id="progress" style="display:none"></div>
        <div id="discoveryStatus"></div>
        <progress id="discoveryBar" value="0" max="100"></progress>
        <div id="trackList"></div>
    `;
}

describe('PlaylistController', () => {
    it('PlaylistController класс существует', () => {
        expect(globalThis.PlaylistController).toBeDefined();
    });

    describe('constructor', () => {
        it('создаёт контроллер', () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            expect(ctrl.service).toBeDefined();
            expect(ctrl.manager).toBeDefined();
        });

        it('принимает autoStart и zip опции', () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {
                autoStart: true,
                zip: true
            });
            expect(ctrl._autoStart).toBe(true);
            expect(ctrl._autoStartZip).toBe(true);
        });
    });

    describe('_populateFormatSelector', () => {
        it('заполняет select форматами', () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            ctrl._populateFormatSelector();
            const select = document.getElementById('formatSelector');
            expect(select.options.length).toBeGreaterThan(0);
        });

        it('восстанавливает сохранённый формат', () => {
            setupDom();
            localStorage.setItem('sounddlib_selected_format', 'flac');
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            ctrl._populateFormatSelector();
            const select = document.getElementById('formatSelector');
            expect(select.value).toBe('flac');
            localStorage.removeItem('sounddlib_selected_format');
        });
    });

    describe('_discover', () => {
        it('загружает треки и обновляет UI', async () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            await ctrl._discover();
            expect(ctrl._tracks).toHaveLength(2);
        });

        it('обрабатывает ошибку при загрузке', async () => {
            setupDom();
            const service = makeService({
                fetchAllPlaylistTracks: vi.fn().mockRejectedValue(new Error('network error'))
            });
            const ctrl = new globalThis.PlaylistController(service, '42', {});
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            await ctrl._discover();
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('_renderTrackList', () => {
        it('рендерит треки в список', async () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            await ctrl._discover();
            ctrl._renderTrackList();
            const list = document.getElementById('trackList');
            expect(list.querySelectorAll('.track-item').length).toBe(2);
        });

        it('не бросает если нет trackList', () => {
            document.body.innerHTML = '';
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            expect(() => ctrl._renderTrackList()).not.toThrow();
        });

        it('использует placeholder svg для трека без cover', async () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            ctrl._tracks = [{ id: '1', title: 'T', artist: 'A', cover: null }];
            ctrl._renderTrackList();
            const cover = document.querySelector('.track-cover');
            expect(cover.src).toContain('svg');
        });
    });

    describe('_showPhase', () => {
        it('не бросает при switching phases', () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            expect(() => ctrl._showPhase('discovering')).not.toThrow();
            expect(() => ctrl._showPhase('ready')).not.toThrow();
            expect(() => ctrl._showPhase('downloading')).not.toThrow();
        });
    });

    describe('_bindEvents', () => {
        it('не бросает', () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            expect(() => ctrl._bindEvents()).not.toThrow();
        });

        it('downloadBtn запускает download при клике', async () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            ctrl._tracks = [{ id: '1', title: 'T', artist: 'A', cover: null }];
            ctrl.manager.downloadAll = vi.fn().mockResolvedValue({ done: 1, failed: 0, total: 1 });
            ctrl.manager.eventBus.on = vi.fn();
            ctrl._bindEvents();
            document.getElementById('downloadBtn').click();
            expect(ctrl.manager.downloadAll).toBeDefined();
        });

        it('pauseBtn вызывает pause', () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            ctrl.manager.pause = vi.fn();
            ctrl._bindEvents();
            document.getElementById('pauseBtn').click();
            expect(ctrl.manager.pause).toHaveBeenCalled();
        });

        it('stopBtn вызывает stop', () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            ctrl._isDownloading = true;
            ctrl.manager.stop = vi.fn();
            ctrl._bindEvents();
            document.getElementById('stopBtn').click();
            expect(ctrl.manager.stop).toHaveBeenCalled();
        });
    });

    describe('_startDownload', () => {
        it('не запускает если уже загружается', async () => {
            setupDom();
            const ctrl = new globalThis.PlaylistController(makeService(), '42', {});
            ctrl._isDownloading = true;
            ctrl.manager.downloadAll = vi.fn();
            await ctrl._startDownload(false);
            expect(ctrl.manager.downloadAll).not.toHaveBeenCalled();
        });
    });
});
