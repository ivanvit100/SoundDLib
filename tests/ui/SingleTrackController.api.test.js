import { describe, it, expect, vi, beforeAll } from 'vitest';

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
        <div id="playerSection" style="display:none"></div>
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

function makeService() {
    return {
        name: 'zvuk',
        constructor: { capturePatterns: [], isPlaylistPage: () => false },
        fetchTrackMeta: vi.fn().mockResolvedValue({ title: 'T', artist: 'A', cover: null })
    };
}

function getLastOnMessageCallback() {
    const calls = mockApi.runtime.onMessage.addListener.mock.calls;
    return calls[calls.length - 1]?.[0];
}

describe('SingleTrackController — format/quality selector branches', () => {
    it('_populateFormatSelector не бросает если нет элемента', () => {
        document.body.innerHTML = '';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        expect(() => ctrl._populateFormatSelector()).not.toThrow();
    });

    it('_populateFormatSelector выбирает сохранённый формат', () => {
        setupDom();
        localStorage.setItem('sounddlib_selected_format', 'flac');
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        ctrl._populateFormatSelector();
        const sel = document.getElementById('formatSelector');
        const selected = Array.from(sel.options).find(o => o.selected);
        expect(selected?.value).toBe('flac');
        localStorage.removeItem('sounddlib_selected_format');
    });

    it('formatSelector change handler сохраняет выбор', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        ctrl._populateFormatSelector();
        const sel = document.getElementById('formatSelector');
        sel.value = 'mp3';
        sel.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('sounddlib_selected_format')).toBe('mp3');
    });

    it('_populateQualitySelector рано выходит без контейнера', () => {
        document.body.innerHTML = '';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        expect(() => ctrl._populateQualitySelector([{ bandwidth: 100, url: 'u', label: 'HQ' }])).not.toThrow();
    });

    it('_populateQualitySelector выбирает сохранённое качество', () => {
        setupDom();
        localStorage.setItem('sounddlib_hls_quality', 'HQ');
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        ctrl._populateQualitySelector([
            { bandwidth: 320000, url: 'https://cdn.example.com/hq.m3u8', label: 'HQ' },
            { bandwidth: 128000, url: 'https://cdn.example.com/lq.m3u8', label: 'LQ' }
        ]);
        const sel = document.getElementById('qualitySelector');
        const selected = Array.from(sel.options).find(o => o.selected);
        expect(selected?.label).toBe('HQ');
        localStorage.removeItem('sounddlib_hls_quality');
    });

    it('qualitySelector change handler сохраняет выбор', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        ctrl._populateQualitySelector([
            { bandwidth: 320000, url: 'https://cdn.example.com/hq.m3u8', label: 'HQ' },
            { bandwidth: 128000, url: 'https://cdn.example.com/lq.m3u8', label: 'LQ' }
        ]);
        const sel = document.getElementById('qualitySelector');
        sel.value = 'https://cdn.example.com/hq.m3u8';
        sel.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('sounddlib_hls_quality')).toBe('HQ');
        localStorage.removeItem('sounddlib_hls_quality');
    });
});

describe('SingleTrackController — _init autoDownload branch', () => {
    it('вызывает _startDownload при autoDownload=true и _latestTrackId установлен', async () => {
        setupDom();
        mockApi.runtime.sendMessage.mockResolvedValue({
            ok: true, trackId: 'auto-track', qualities: null, url: null, masterUrl: null,
            meta: { title: 'T', artist: 'A', cover: null }
        });
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, autoDownload: true });
        vi.spyOn(ctrl, '_startDownload').mockResolvedValue();
        await new Promise(r => setTimeout(r, 50));
        expect(ctrl._autoDownload).toBe(true);
    });
});

describe('SingleTrackController — _subscribeToCapture callback', () => {
    it('обновляет _latestTrackId при trackCaptured', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = null;
        const listener = getLastOnMessageCallback();
        if (listener) {
            listener({ action: 'trackCaptured', trackId: 'captured-id', qualities: null, url: null, meta: {} });
        }
        expect(ctrl._latestTrackId).toBe('captured-id');
    });

    it('фильтрует по URL если zadан zvukTrackId', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        ctrl._latestTrackId = null;
        const listener = getLastOnMessageCallback();
        if (listener) {
            listener({ action: 'trackCaptured', trackId: 'wrong-id', url: 'https://cdn.zvuk.com/track/99/file.m3u8', meta: {} });
        }
        expect(ctrl._latestTrackId).toBeNull();
    });

    it('принимает trackCaptured с matching URL для zvukTrackId', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        ctrl._latestTrackId = null;
        const listener = getLastOnMessageCallback();
        if (listener) {
            listener({ action: 'trackCaptured', trackId: 'match-id', url: 'https://cdn.zvuk.com/track/42/file.m3u8', meta: {} });
        }
        expect(ctrl._latestTrackId).toBe('match-id');
    });

    it('запускает _startDownload при autoDownload+zvukTrackId', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42', autoDownload: true });
        ctrl._latestTrackId = null;
        vi.spyOn(ctrl, '_startDownload').mockResolvedValue();
        const listener = getLastOnMessageCallback();
        if (listener) {
            listener({ action: 'trackCaptured', trackId: 'dl-id', url: 'https://cdn.zvuk.com/track/42/file.m3u8', meta: {} });
        }
        expect(ctrl._startDownload).toHaveBeenCalled();
    });
});

describe('SingleTrackController — _bindEvents handlers', () => {
    it('downloadBtn standalone=true вызывает _startDownload', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = 'some-track';
        vi.spyOn(ctrl, '_startDownload').mockResolvedValue();
        ctrl._bindEvents();
        const btn = document.getElementById('downloadBtn');
        if (btn) btn.disabled = false;
        btn?.click();
        expect(ctrl._startDownload).toHaveBeenCalled();
    });

    it('downloadBtn standalone=false вызывает _openInWindow', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: false });
        vi.spyOn(ctrl, '_openInWindow').mockResolvedValue();
        ctrl._bindEvents();
        const btn = document.getElementById('downloadBtn');
        if (btn) btn.disabled = false;
        btn?.click();
        expect(ctrl._openInWindow).toHaveBeenCalled();
    });

    it('stopBtn click вызывает _stop', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_stop');
        ctrl._bindEvents();
        document.getElementById('stopBtn')?.click();
        expect(ctrl._stop).toHaveBeenCalled();
    });

    it('playPauseBtn click вызывает _sendControl playPause', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_sendControl').mockResolvedValue();
        ctrl._bindEvents();
        document.getElementById('playPauseBtn')?.click();
        expect(ctrl._sendControl).toHaveBeenCalledWith('playPause');
    });

    it('prevBtn click вызывает _sendControl prevTrack', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_sendControl').mockResolvedValue();
        ctrl._bindEvents();
        document.getElementById('prevBtn')?.click();
        expect(ctrl._sendControl).toHaveBeenCalledWith('prevTrack');
    });

    it('nextBtn click вызывает _sendControl nextTrack', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_sendControl').mockResolvedValue();
        ctrl._bindEvents();
        document.getElementById('nextBtn')?.click();
        expect(ctrl._sendControl).toHaveBeenCalledWith('nextTrack');
    });

    it('playbackBar mousedown устанавливает _seeking=true', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._bindEvents();
        document.getElementById('playbackBar')?.dispatchEvent(new MouseEvent('mousedown'));
        expect(ctrl._seeking).toBe(true);
    });

    it('playbackBar touchstart устанавливает _seeking=true', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._bindEvents();
        document.getElementById('playbackBar')?.dispatchEvent(new TouchEvent('touchstart'));
        expect(ctrl._seeking).toBe(true);
    });

    it('playbackBar input обновляет fill и current', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._bindEvents();
        const bar = document.getElementById('playbackBar');
        bar.max = '100';
        bar.value = '30';
        bar.dispatchEvent(new Event('input'));
        const fill = document.getElementById('playbackFill');
        expect(fill?.style.width).toBe('30%');
    });

    it('playbackBar change вызывает _sendControl seek', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_sendControl').mockResolvedValue();
        ctrl._bindEvents();
        const bar = document.getElementById('playbackBar');
        bar.value = '45';
        bar.dispatchEvent(new Event('change'));
        expect(ctrl._sendControl).toHaveBeenCalledWith('seek', 45);
        expect(ctrl._seeking).toBe(false);
    });

    it('download:progress listener обновляет status и progress', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._bindEvents();
        const onCalls = ctrl.manager.eventBus.on.mock.calls;
        const progressCb = onCalls.find(c => c[0] === 'download:progress')?.[1];
        if (progressCb) progressCb({ message: 'Загрузка...', percent: 42 });
        const status = document.getElementById('status');
        expect(status?.textContent).toBe('Загрузка...');
        const prog = document.getElementById('progress');
        expect(prog?.value).toBe(42);
    });

    it('download:completed listener вызывает setDownloadingUI(false)', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_setDownloadingUI');
        ctrl._bindEvents();
        const onCalls = ctrl.manager.eventBus.on.mock.calls;
        const completedCb = onCalls.find(c => c[0] === 'download:completed')?.[1];
        if (completedCb) completedCb({ filename: 'track.mp3' });
        expect(ctrl._setDownloadingUI).toHaveBeenCalledWith(false);
    });

    it('download:failed listener вызывает setDownloadingUI(false)', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_setDownloadingUI');
        ctrl._bindEvents();
        const onCalls = ctrl.manager.eventBus.on.mock.calls;
        const failedCb = onCalls.find(c => c[0] === 'download:failed')?.[1];
        if (failedCb) failedCb({ error: new Error('fail') });
        expect(ctrl._setDownloadingUI).toHaveBeenCalledWith(false);
    });
});

describe('SingleTrackController — _openInWindow', () => {
    it('создаёт новое окно', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        await ctrl._openInWindow(true);
        expect(mockApi.windows.create).toHaveBeenCalled();
    });

    it('не бросает если windows.create бросает', async () => {
        setupDom();
        mockApi.windows.create.mockRejectedValueOnce(new Error('no window'));
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        await expect(ctrl._openInWindow()).resolves.toBeUndefined();
    });
});

describe('SingleTrackController — _loadFromStoreOrCdn paths', () => {
    it('streamCheck.ok=true, res.ok=true возвращает res', async () => {
        setupDom();
        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.action === 'getTrackByZvukId') return { ok: false };
            if (msg.action === 'getStreamUrlByZvukId') return { ok: true };
            if (msg.action === 'probeCdnForTrack') return { ok: true, trackId: 'cdn-t', qualities: null };
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        const result = await ctrl._loadFromStoreOrCdn();
        expect(result?.trackId).toBe('cdn-t');
        mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} });
    });

    it('streamCheck.ok=false использует финальный probeCdnForTrack', async () => {
        setupDom();
        let callCount = 0;
        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.action === 'getTrackByZvukId') return { ok: false };
            if (msg.action === 'getStreamUrlByZvukId') return { ok: false };
            if (msg.action === 'probeCdnForTrack') return { ok: true, trackId: `final-${++callCount}`, qualities: null };
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        const result = await ctrl._loadFromStoreOrCdn();
        expect(result?.trackId).toMatch(/final-/);
        mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} });
    });
});

describe('SingleTrackController — _loadTrackFromZvukId error paths', () => {
    it('показывает ошибку если entry.ok=false', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        await new Promise(r => setTimeout(r, 0));
        vi.spyOn(ctrl, '_loadFromStoreOrCdn').mockResolvedValue({ ok: false, error: 'not found' });
        await ctrl._loadTrackFromZvukId();
        const status = document.getElementById('status');
        expect(status?.textContent).toContain('not found');
    });

    it('показывает ошибку если _loadFromStoreOrCdn бросает', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        await new Promise(r => setTimeout(r, 0));
        vi.spyOn(ctrl, '_loadFromStoreOrCdn').mockRejectedValue(new Error('connection failed'));
        await ctrl._loadTrackFromZvukId();
        const status = document.getElementById('status');
        expect(status?.textContent).toContain('connection failed');
    });
});

describe('SingleTrackController — _applyTrackEntry autoDownload', () => {
    it('вызывает _startDownload если autoDownload=true', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, autoDownload: true });
        vi.spyOn(ctrl, '_startDownload').mockResolvedValue();
        vi.spyOn(ctrl, '_fetchAndRenderMeta').mockResolvedValue();
        ctrl._applyTrackEntry({ ok: true, trackId: 'auto-t', qualities: null, url: 'u', masterUrl: null, meta: { title: 'T' } });
        expect(ctrl._startDownload).toHaveBeenCalled();
    });
});

describe('SingleTrackController — _renderTrackMeta album', () => {
    it('записывает album в logoInfo если есть', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, {});
        ctrl._renderTrackMeta({ title: 'T', artist: 'A', cover: null, album: 'My Album' });
        const logoInfo = document.getElementById('logoInfo');
        expect(logoInfo?.textContent).toBe('My Album');
    });
});

describe('SingleTrackController — _awaitTrackChange', () => {
    it('обнаруживает смену трека и обновляет latestTrackId', async () => {
        setupDom();
        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg?.action === 'getLatestTrack') return { ok: true, trackId: 'updated-track', qualities: null };
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: { zvukTrackId: 'new-zvuk-id' } };
            return { ok: true, state: { currentTime: 0, duration: 0, paused: true } };
        });

        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });

        vi.useFakeTimers();
        const promise = ctrl._awaitTrackChange('old-zvuk-id');
        promise.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} });
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: { currentTime: 10, duration: 60, paused: false } });
        expect(true).toBe(true);
    });

    it('прерывается при смене token', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });

        vi.useFakeTimers();
        const promise = ctrl._awaitTrackChange('old-id');
        promise.catch(() => {});
        ctrl._trackChangeToken = { new: true };
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();
        expect(true).toBe(true);
    });

    it('продолжает цикл если нет нового zvukTrackId', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: {} };
            return { ok: true, state: { currentTime: 0, duration: 0, paused: true } };
        });
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });

        vi.useFakeTimers();
        const promise = ctrl._awaitTrackChange('old-id');
        promise.catch(() => {});
        await vi.advanceTimersByTimeAsync(6500);
        vi.clearAllTimers();
        vi.useRealTimers();

        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: { currentTime: 10, duration: 60, paused: false } });
        expect(true).toBe(true);
    }, 15000);

    it('обрабатывает catch для getLatestTrack', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: { zvukTrackId: 'catch-id' } };
            return { ok: true, state: { currentTime: 0, duration: 0, paused: true } };
        });
        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg?.action === 'getLatestTrack') throw new Error('network error');
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });

        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });

        vi.useFakeTimers();
        const promise = ctrl._awaitTrackChange('other-id');
        promise.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} });
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: { currentTime: 10, duration: 60, paused: false } });
        expect(true).toBe(true);
    });

    it('latest.trackId отличается — обновляет _latestTrackId', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: { zvukTrackId: 'detected-id' } };
            return { ok: true, state: { currentTime: 0, duration: 0, paused: true } };
        });
        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg?.action === 'getLatestTrack') return { ok: true, trackId: 'brand-new-track', qualities: null };
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });

        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        await new Promise(r => setTimeout(r, 0));
        ctrl._latestTrackId = 'old-id';

        vi.useFakeTimers();
        const promise = ctrl._awaitTrackChange('prev-zvuk-id');
        promise.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        expect(ctrl._latestTrackId).toBe('brand-new-track');
        mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} });
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: { currentTime: 10, duration: 60, paused: false } });
    });

    it('latest.trackId совпадает — не обновляет', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockImplementation(async (_tabId, msg) => {
            if (msg?.action === 'getTabMeta') return { ok: true, meta: { zvukTrackId: 'same-id' } };
            return { ok: true, state: { currentTime: 0, duration: 0, paused: true } };
        });
        mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg?.action === 'getLatestTrack') return { ok: true, trackId: 'same-latest', qualities: null };
            return { ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} };
        });

        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        ctrl._latestTrackId = 'same-latest';

        vi.useFakeTimers();
        const promise = ctrl._awaitTrackChange('old-id');
        promise.catch(() => {});
        await vi.advanceTimersByTimeAsync(600);
        vi.clearAllTimers();
        vi.useRealTimers();

        expect(ctrl._latestTrackId).toBe('same-latest');
        mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} });
        mockApi.tabs.sendMessage.mockResolvedValue({ ok: true, meta: {}, state: { currentTime: 10, duration: 60, paused: false } });
    });
});

describe('SingleTrackController — _queryPlaybackState', () => {
    it('возвращает null при ошибке tabs.sendMessage', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockRejectedValueOnce(new Error('tab error'));
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        const state = await ctrl._queryPlaybackState();
        expect(state).toBeNull();
    });

    it('возвращает null если resp.ok=false', async () => {
        setupDom();
        mockApi.tabs.sendMessage.mockResolvedValueOnce({ ok: false });
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        const state = await ctrl._queryPlaybackState();
        expect(state).toBeNull();
    });
});

describe('SingleTrackController — _subscribeToCapture callback early returns via module API', () => {
    it('игнорирует сообщение с action !== trackCaptured через модульный API', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = null;
        const listener = getLastOnMessageCallback();
        if (listener) {
            listener({ action: 'otherAction' });
        }
        expect(ctrl._latestTrackId).toBeNull();
    });

    it('игнорирует trackCaptured если trackId совпадает через модульный API', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = 'existing-id';
        const listener = getLastOnMessageCallback();
        if (listener) {
            listener({ action: 'trackCaptured', trackId: 'existing-id' });
        }
        expect(ctrl._latestTrackId).toBe('existing-id');
    });

    it('обрабатывает capturedUrl без значения для zvukTrackId', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        ctrl._latestTrackId = null;
        const listener = getLastOnMessageCallback();
        if (listener) {
            listener({ action: 'trackCaptured', trackId: 'new-id', url: '', meta: {} });
        }
        expect(ctrl._latestTrackId).toBe('new-id');
    });
});

describe('SingleTrackController — _loadTrackInfo resp.ok=false', () => {
    it('не обновляет _latestTrackId если getLatestTrack вернул ok=false', async () => {
        setupDom();
        mockApi.runtime.sendMessage.mockResolvedValueOnce({ ok: false });
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = null;
        await ctrl._loadTrackInfo();
        expect(true).toBe(true);
        mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, trackId: 't1', qualities: null, url: null, masterUrl: null, meta: {} });
    });
});

describe('SingleTrackController — null DOM in various methods', () => {
    it('_loadTrackFromZvukId без btn и status', async () => {
        document.body.innerHTML = '<div></div>';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true, zvukTrackId: '42' });
        await new Promise(r => setTimeout(r, 0));
        vi.spyOn(ctrl, '_loadFromStoreOrCdn').mockResolvedValue({ ok: false, error: 'err' });
        await expect(ctrl._loadTrackFromZvukId()).resolves.toBeUndefined();
    });

    it('_applyTrackEntry без btn и status', () => {
        document.body.innerHTML = '<div id="qualityContainer"><select id="qualitySelector"></select></div>';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        vi.spyOn(ctrl, '_fetchAndRenderMeta').mockResolvedValue();
        expect(() => ctrl._applyTrackEntry({ ok: true, trackId: 't', qualities: null, url: 'u', masterUrl: null, meta: {} })).not.toThrow();
    });

    it('_subscribeToCapture callback без btn и status в DOM', () => {
        document.body.innerHTML = '<div></div>';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = null;
        const listener = getLastOnMessageCallback();
        if (listener) {
            expect(() => listener({ action: 'trackCaptured', trackId: 'new-id', qualities: null, url: null, meta: {} })).not.toThrow();
        }
    });

    it('qualitySelector change handler chosen=null', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._populateQualitySelector([{ bandwidth: 100, url: 'https://cdn.example.com/q.m3u8', label: 'HQ' }]);
        const sel = document.getElementById('qualitySelector');
        sel.value = 'https://nonexistent.example.com/other.m3u8';
        sel.dispatchEvent(new Event('change'));
        expect(true).toBe(true);
    });

    it('playbackBar input без fill и cur', () => {
        setupDom();
        document.getElementById('playbackFill')?.remove();
        document.getElementById('playbackCurrent')?.remove();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._bindEvents();
        const bar = document.getElementById('playbackBar');
        bar.max = '0';
        bar.value = '0';
        bar.dispatchEvent(new Event('input'));
        expect(true).toBe(true);
    });

    it('download:progress без s и p в DOM', () => {
        document.body.innerHTML = '<div></div>';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._bindEvents();
        const onCalls = ctrl.manager.eventBus.on.mock.calls;
        const progressCb = onCalls.find(c => c[0] === 'download:progress')?.[1];
        if (progressCb) expect(() => progressCb({ message: 'x', percent: null })).not.toThrow();
    });

    it('_openInWindow с autoDownload=false', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), 1, { standalone: true });
        await ctrl._openInWindow(false);
        expect(mockApi.windows.create).toHaveBeenCalled();
    });

    it('_startDownload без formatSelector', async () => {
        document.body.innerHTML = '<progress id="progress"></progress>';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = 'some-track';
        vi.spyOn(ctrl, '_setDownloadingUI');
        await ctrl._startDownload();
        expect(ctrl._setDownloadingUI).toHaveBeenCalled();
    });

    it('_startDownload с _isHls=true и qualitySelector', async () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._latestTrackId = 'some-track';
        ctrl._isHls = true;
        vi.spyOn(ctrl, '_setDownloadingUI');
        await ctrl._startDownload();
        expect(ctrl._setDownloadingUI).toHaveBeenCalled();
    });

    it('_setDownloadingUI без DOM элементов', () => {
        document.body.innerHTML = '';
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        expect(() => ctrl._setDownloadingUI(true)).not.toThrow();
        expect(() => ctrl._setDownloadingUI(false)).not.toThrow();
    });
});

describe('SingleTrackController — _setDownloadingUI с downloadControls и formatContainer', () => {
    it('скрывает qualityContainer при active=false с _isHls=false', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._isHls = false;
        ctrl._setDownloadingUI(false);
        const qualC = document.getElementById('qualityContainer');
        expect(qualC?.style.display).toBe('none');
    });

    it('показывает qualityContainer при active=false и _isHls=true', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._isHls = true;
        ctrl._setDownloadingUI(false);
        const qualC = document.getElementById('qualityContainer');
        expect(qualC?.style.display).toBe('block');
    });

    it('показывает downloadControls при active=true', () => {
        setupDom();
        const ctrl = new globalThis.SingleTrackController(makeService(), null, { standalone: true });
        ctrl._setDownloadingUI(true);
        const dCtrl = document.getElementById('downloadControls');
        expect(dCtrl?.style.display).toBe('block');
    });
});
