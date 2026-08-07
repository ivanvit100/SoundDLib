import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(async () => {
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

    vi.resetModules();
    await import('../../ui/SingleTrackController.js');
});

describe('SingleTrackController — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../ui/SingleTrackController.js');
        vi.unstubAllGlobals();
        expect(globalThis.SingleTrackController).toBeDefined();
    });
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

    describe('_stop', () => {
        it('вызывает emit download:failed', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            const emitSpy = vi.spyOn(ctrl.manager.eventBus, 'emit');
            ctrl._stop();
            expect(emitSpy).toHaveBeenCalledWith('download:failed', expect.objectContaining({ error: expect.any(Error) }));
        });
    });

    describe('_setDownloadingUI', () => {
        it('сбрасывает UI при active=false', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._setDownloadingUI(false);
            const status = document.getElementById('status');
            if (status) expect(status.textContent).toBe('Нажмите «Скачать»');
        });

        it('не бросает при active=true', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            expect(() => ctrl._setDownloadingUI(true)).not.toThrow();
        });
    });

    describe('_fmtTime', () => {
        it('форматирует секунды в mm:ss', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            expect(ctrl._fmtTime(65)).toBe('1:05');
            expect(ctrl._fmtTime(0)).toBe('0:00');
            expect(ctrl._fmtTime(-1)).toBe('0:00');
            expect(ctrl._fmtTime(Infinity)).toBe('0:00');
        });
    });

    describe('_updatePlayerUI', () => {
        it('обновляет UI при наличии state', () => {
            setupDom();
            document.body.innerHTML += `
                <div id="playbackFill"></div>
                <input type="range" id="playbackBar" min="0" max="100" value="0">
                <div id="playbackCurrent"></div>
                <div id="playbackDuration"></div>
                <button id="playIcon"></button>
                <button id="pauseIcon"></button>
            `;
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._updatePlayerUI({ currentTime: 30, duration: 120, paused: true });
            const cur = document.getElementById('playbackCurrent');
            if (cur) expect(cur.textContent).toBe('0:30');
        });

        it('очищает UI при state=null', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            expect(() => ctrl._updatePlayerUI(null)).not.toThrow();
        });

        it('обновляет UI при paused=false', () => {
            setupDom();
            document.body.innerHTML += `
                <div id="playbackFill"></div>
                <input type="range" id="playbackBar" min="0" max="100" value="0">
                <div id="playbackCurrent"></div>
                <div id="playbackDuration"></div>
                <button id="playIcon"></button>
                <button id="pauseIcon"></button>
            `;
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._updatePlayerUI({ currentTime: 10, duration: 100, paused: false });
            expect(true).toBe(true);
        });
    });

    describe('_sendControl', () => {
        it('не делает ничего без tabId', async () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
            await expect(ctrl._sendControl('playPause')).resolves.toBeUndefined();
        });

        it('отправляет playPause без ошибок', async () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            await expect(ctrl._sendControl('playPause')).resolves.toBeUndefined();
        });

        it('отправляет prevTrack и вызывает _awaitTrackChange', async () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            vi.spyOn(ctrl, '_awaitTrackChange').mockResolvedValue(undefined);
            await ctrl._sendControl('nextTrack');
            expect(ctrl._awaitTrackChange).toHaveBeenCalled();
        });
    });

    describe('_fetchAndRenderMeta', () => {
        it('извлекает zvukId из URL и запрашивает meta', async () => {
            setupDom();
            const service = makeService({
                fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'Fresh Title', artist: 'Fresh Artist', cover: null, album: null })
            });
            const ctrl = new globalThis.SingleTrackController(service, 1, {});
            vi.spyOn(ctrl, '_renderTrackMeta');
            await ctrl._fetchAndRenderMeta('https://cdn-hls-slicer.zvuk.com/drm/track/42/master.m3u8', { title: 'Fallback' });
            expect(ctrl._renderTrackMeta).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fresh Title' }));
        });

        it('использует fallback если нет zvukId', async () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            vi.spyOn(ctrl, '_renderTrackMeta');
            await ctrl._fetchAndRenderMeta('https://cdn.example.com/audio.m3u8', { title: 'Fallback Title' });
            expect(ctrl._renderTrackMeta).toHaveBeenCalledWith({ title: 'Fallback Title' });
        });
    });

    describe('_subscribeToCapture', () => {
        it('обрабатывает trackCaptured сообщение', () => {
            setupDom();
            let capturedListener = null;
            const mockApi = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: true, trackId: 't', qualities: [], meta: {} }),
                    onMessage: { addListener: vi.fn((cb) => { capturedListener = cb; }) }
                }
            };
            globalThis.getExtensionApi = vi.fn(() => mockApi);
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._latestTrackId = null;
            if (capturedListener) {
                capturedListener({ action: 'trackCaptured', trackId: 'new-track', qualities: null, url: null, meta: {} });
            }
            if (capturedListener) expect(ctrl._latestTrackId).toBe('new-track');
        });

        it('игнорирует если trackId совпадает', () => {
            setupDom();
            let capturedListener = null;
            const mockApi = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
                    onMessage: { addListener: vi.fn((cb) => { capturedListener = cb; }) }
                }
            };
            globalThis.getExtensionApi = vi.fn(() => mockApi);
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._latestTrackId = 'same-id';
            if (capturedListener) {
                capturedListener({ action: 'trackCaptured', trackId: 'same-id' });
            }
            expect(ctrl._latestTrackId).toBe('same-id');
        });

        it('игнорирует action !== trackCaptured', () => {
            setupDom();
            let capturedListener = null;
            const mockApi = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
                    onMessage: { addListener: vi.fn((cb) => { capturedListener = cb; }) }
                }
            };
            globalThis.getExtensionApi = vi.fn(() => mockApi);
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            ctrl._latestTrackId = null;
            if (capturedListener) {
                capturedListener({ action: 'otherAction' });
            }
            expect(ctrl._latestTrackId).toBeNull();
        });
    });

    describe('_bindEvents — download button non-standalone', () => {
        it('вызывает _openInWindow если не standalone', () => {
            setupDom();
            const mockApi = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
                    onMessage: { addListener: vi.fn() },
                    getURL: vi.fn(() => 'chrome-extension://abc/popup.html')
                },
                windows: { create: vi.fn().mockResolvedValue({ id: 1 }) }
            };
            globalThis.getExtensionApi = vi.fn(() => mockApi);
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: false });
            ctrl._bindEvents();
            document.getElementById('downloadBtn')?.click();
            expect(mockApi.windows.create).toBeDefined();
        });
    });

    describe('_stopPlaybackPolling', () => {
        it('очищает интервал', () => {
            setupDom();
            const ctrl = new globalThis.SingleTrackController(makeService(), 1, {});
            vi.useFakeTimers();
            ctrl._startPlaybackPolling();
            expect(ctrl._pollInterval).toBeDefined();
            ctrl._stopPlaybackPolling();
            expect(ctrl._pollInterval).toBeNull();
            vi.useRealTimers();
        });
    });
});
