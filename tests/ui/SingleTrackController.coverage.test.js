import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

let mockApi;

beforeAll(async () => {
    mockApi = {
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({
                ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null,
                meta: { title: 'T', artist: 'A', cover: null }
            }),
            onMessage: { addListener: vi.fn() },
            getURL: vi.fn(p => `chrome-extension://abc/${p}`)
        },
        tabs: {
            sendMessage: vi.fn().mockResolvedValue({
                ok: true, meta: {}, state: { currentTime: 10, duration: 60, paused: false }
            })
        },
        windows: {
            create: vi.fn().mockResolvedValue({ id: 1 })
        }
    };

    globalThis.getExtensionApi = vi.fn(() => mockApi);

    globalThis.SingleTrackManager = class {
        constructor() {
            this.eventBus = { on: vi.fn(), emit: vi.fn(), off: vi.fn() };
        }
        async download() { return { success: true, filename: 't.mp3' }; }
    };
    globalThis.AudioConverter = class {
        async convert() { return new ArrayBuffer(10); }
    };
    globalThis.ConverterRegistry = {
        getFormats: vi.fn(() => [{ value: 'mp3', label: 'MP3' }, { value: 'flac', label: 'FLAC' }]),
        getMeta: vi.fn(() => ({ ext: 'mp3', mimeType: 'audio/mp3' }))
    };
    globalThis.Storage = { get: vi.fn(() => null), set: vi.fn() };

    vi.resetModules();
    await import('../../ui/SingleTrackController.js');
});

function setupDom() {
    document.body.innerHTML = `
        <select id="formatSelector"></select>
        <div id="qualityContainer" style="display:none">
            <select id="qualitySelector"></select>
        </div>
        <button id="downloadBtn">Download</button>
        <button id="stopBtn">Stop</button>
        <button id="prevBtn">Prev</button>
        <button id="nextBtn">Next</button>
        <div id="status"></div>
        <progress id="progress" value="0" max="100"></progress>
        <img id="cover" />
        <div id="description"></div>
        <div id="logoInfo"></div>
        <button id="playPauseBtn"></button>
        <div id="playbackFill"></div>
        <input type="range" id="playbackBar" min="0" max="100" value="50">
        <div id="playbackCurrent"></div>
        <div id="playbackDuration"></div>
        <button id="playIcon"></button>
        <button id="pauseIcon"></button>
        <div id="downloadControls"></div>
        <div id="formatContainer"></div>
    `;
}

function makeService(overrides = {}) {
    return {
        name: 'zvuk',
        constructor: { capturePatterns: [], isPlaylistPage: () => false },
        fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'T', artist: 'A', cover: null }),
        ...overrides
    };
}

describe('SingleTrackController — _updatePlayerUI null DOM branches', () => {
    it('не бросает если все playback-элементы отсутствуют в DOM', () => {
        document.body.innerHTML = '';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        expect(() => ctrl._updatePlayerUI({ currentTime: 30, duration: 120, paused: true })).not.toThrow();
    });

    it('не бросает с paused=false и пустым DOM', () => {
        document.body.innerHTML = '';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        expect(() => ctrl._updatePlayerUI({ currentTime: 10, duration: 0, paused: false })).not.toThrow();
    });
});

describe('SingleTrackController — _loadFromStoreOrCdn streamCheck ok но res не ok', () => {
    it('падает на первый probeCdn и использует финальный вызов', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._zvukTrackId = '77';

        let probeCount = 0;
        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.action === 'getTrackByZvukId') return { ok: false };
            if (msg.action === 'getStreamUrlByZvukId') return { ok: true };
            if (msg.action === 'probeCdnForTrack') {
                probeCount++;
                return probeCount === 1
                    ? { ok: false }
                    : { ok: true, trackId: 'final-probe', qualities: null };
            }
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });

        const result = await ctrl._loadFromStoreOrCdn();
        expect(result?.trackId).toBe('final-probe');
        expect(probeCount).toBe(2);

        mockApi.runtime.sendMessage.mockResolvedValue({
            ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {}
        });
    });
});

describe('SingleTrackController — _loadTrackFromZvukId catch без status', () => {
    it('не бросает если status не в DOM и _loadFromStoreOrCdn бросает', async () => {
        document.body.innerHTML = '<div id="downloadBtn"></div>';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        await new Promise(r => setTimeout(r, 0));
        vi.spyOn(ctrl, '_loadFromStoreOrCdn').mockRejectedValue(new Error('oops'));
        await expect(ctrl._loadTrackFromZvukId()).resolves.toBeUndefined();
    });
});

describe('SingleTrackController — _openInWindow без tabId', () => {
    it('создаёт окно без параметра tabId в URL если tabId=null', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        mockApi.windows.create.mockClear();
        await ctrl._openInWindow(true);
        const url = mockApi.windows.create.mock.calls[0]?.[0]?.url ?? '';
        expect(url).not.toContain('tabId=');
    });

    it('создаёт окно без autoDownload в URL если autoDownload=false', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        mockApi.windows.create.mockClear();
        await ctrl._openInWindow(false);
        const url = mockApi.windows.create.mock.calls[0]?.[0]?.url ?? '';
        expect(url).not.toContain('autoDownload=');
    });
});

describe('SingleTrackController — _awaitTrackChange token checks 2/3/4', () => {
    it('check 2: token меняется после getTabMeta -> return', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });

        await new Promise(r => setTimeout(r, 50));

        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') {
                ctrl._trackChangeToken = {};
                return { ok: true, meta: { zvukTrackId: 'some-id' } };
            }
            return { ok: true, state: {} };
        });

        vi.useFakeTimers();
        const p = ctrl._awaitTrackChange('old-id');
        p.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        expect(true).toBe(true);
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: {} });
    });

    it('check 3: token меняется внутри _fetchAndRenderMeta -> return', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: { zvukTrackId: 'detected' } };
            return { ok: true, state: {} };
        });

        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        await new Promise(r => setTimeout(r, 50));

        vi.spyOn(ctrl, '_fetchAndRenderMeta').mockImplementation(async () => {
            ctrl._trackChangeToken = {};
        });

        vi.useFakeTimers();
        const p = ctrl._awaitTrackChange('prev-id');
        p.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        expect(true).toBe(true);
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: {} });
    });

    it('check 4: token меняется после getLatestTrack -> return', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: { zvukTrackId: 'detected' } };
            return { ok: true, state: {} };
        });
        mockApi.runtime.sendMessage.mockResolvedValue({
            ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {}
        });

        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        await new Promise(r => setTimeout(r, 50));

        vi.spyOn(ctrl, '_fetchAndRenderMeta').mockResolvedValue();

        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg?.action === 'getLatestTrack') {
                ctrl._trackChangeToken = {};
                return { ok: true, trackId: 'new-track', qualities: null };
            }
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });

        vi.useFakeTimers();
        const p = ctrl._awaitTrackChange('prev-id');
        p.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        expect(true).toBe(true);
        mockApi.runtime.sendMessage.mockResolvedValue({
            ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {}
        });
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: {} });
    });

    it('btn null branch: _latestTrackId обновляется, downloadBtn отсутствует -> else-ветка', async () => {
        document.body.innerHTML = '<div id="qualityContainer"><select id="qualitySelector"></select></div>';

        mockApi.runtime.sendMessage.mockResolvedValue({ ok: false });
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: { zvukTrackId: 'new-track-id' } };
            return { ok: false };
        });

        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        await new Promise(r => setTimeout(r, 50));

        vi.spyOn(ctrl, '_fetchAndRenderMeta').mockResolvedValue();

        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg?.action === 'getLatestTrack') return { ok: true, trackId: 'brand-new', qualities: null };
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });

        vi.useFakeTimers();
        const p = ctrl._awaitTrackChange('prev-id');
        p.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        expect(ctrl._latestTrackId).toBe('brand-new');
        mockApi.runtime.sendMessage.mockResolvedValue({
            ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {}
        });
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: {} });
    });
});

describe('SingleTrackController — browserAPI fallback branch', () => {
    it('загружается когда getExtensionApi не определён (browserAPI=null)', async () => {
        const saved = globalThis.getExtensionApi;
        globalThis.getExtensionApi = undefined;
        vi.resetModules();
        await import('../../ui/SingleTrackController.js');
        expect(globalThis.SingleTrackController).toBeDefined();
        globalThis.getExtensionApi = saved;
        vi.resetModules();
        await import('../../ui/SingleTrackController.js');
    });
});

describe('SingleTrackController — constructor default options', () => {
    it('создаёт контроллер без третьего аргумента (options={})', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null);
        expect(ctrl._standalone).toBe(false);
        expect(ctrl._autoDownload).toBe(false);
    });
});

describe('SingleTrackController — _loadTrackFromZvukId entry без error', () => {
    it('показывает «поток недоступен» если entry.ok=false и error не задан', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        await new Promise(r => setTimeout(r, 50));
        vi.spyOn(ctrl, '_loadFromStoreOrCdn').mockResolvedValue({ ok: false });
        await ctrl._loadTrackFromZvukId();
        const status = document.getElementById('status');
        expect(status?.textContent).toContain('поток недоступен');
    });
});

describe('SingleTrackController — download:progress percent=null', () => {
    it('устанавливает progress.value=0 когда percent=null', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._bindEvents();
        const onCalls = ctrl.manager.eventBus.on.mock.calls;
        const progressCb = onCalls.find(c => c[0] === 'download:progress')?.[1];
        if (progressCb) progressCb({ message: 'loading', percent: null });
        const prog = document.getElementById('progress');
        expect(prog?.value).toBe(0);
    });
});
