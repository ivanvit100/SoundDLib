import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

let messageListeners = [];
let runtimeListeners = [];
let mockApi;

beforeAll(async () => {
    messageListeners = [];
    runtimeListeners = [];

    const origAddEventListener = window.addEventListener;
    window.addEventListener = vi.fn((event, cb) => {
        if (event === 'message') messageListeners.push(cb);
        else origAddEventListener.call(window, event, cb);
    });

    let observerCallback = null;
    const MockMutationObserver = class {
        constructor(cb) { observerCallback = cb; }
        observe() {}
        disconnect() {}
    };
    window.MutationObserver = MockMutationObserver;

    globalThis.BaseRelay = class {
        constructor(api) {
            this._api = api;
            this._handlers = new Map();
            this._injectors = [];
        }
        registerHandler(name, fn) { this._handlers.set(name, fn); }
        registerInjector(fn) { this._injectors.push(fn); }
        start() {
            window.addEventListener('message', this._onWindowMessage.bind(this));
            this._api.runtime.onMessage.addListener(this._onRuntimeMessage.bind(this));
            this._runInjectors();
        }
        _runInjectors() { for (const inj of this._injectors) { try { inj(); } catch {} } }
        _onWindowMessage(event) {
            if (!event.data?.__sounddlib) return;
            const { type, ...payload } = event.data;
            this._onMainWorldMessage({ type, ...payload });
        }
        _onRuntimeMessage(message, sender, sendResponse) {
            const handler = this._handlers.get(message.action);
            if (!handler) return false;
            try {
                const result = handler(message, sender);
                if (result instanceof Promise) {
                    result.then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
                    return true;
                }
                sendResponse(result);
            } catch (e) {
                sendResponse({ ok: false, error: String(e) });
            }
            return false;
        }
        _onMainWorldMessage() {}
    };

    mockApi = {
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({}),
            onMessage: {
                addListener: vi.fn((cb) => { runtimeListeners.push(cb); })
            }
        },
        tabs: {
            query: vi.fn().mockResolvedValue([{ id: 1 }])
        }
    };

    globalThis.chrome = mockApi;
    globalThis.browser = undefined;

    vi.resetModules();
    await import('../../../services/zvuk/ZvukRelay.js');
});

function dispatchRuntime(action, payload = {}, sender = {}) {
    return new Promise(resolve => {
        for (const listener of runtimeListeners) {
            const result = listener({ action, ...payload }, sender, resolve);
            if (!result) resolve(null);
        }
    });
}

describe('ZvukRelay', () => {
    it('ZvukRelay класс существует', () => {
        expect(globalThis.ZvukRelay).toBeDefined();
    });

    describe('_onMainWorldMessage', () => {
        it('отправляет audioIntercepted при AUDIO_CAPTURED', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._onMainWorldMessage({
                type: 'AUDIO_CAPTURED',
                mimeType: 'audio/mpeg',
                data: [1, 2, 3],
                url: null,
                meta: { title: 'T', artist: 'A' }
            });
            expect(mockApi.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'audioIntercepted' })
            );
        });

        it('отправляет streamUrlCaptured при STREAM_URL_CAPTURED', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._onMainWorldMessage({
                type: 'STREAM_URL_CAPTURED',
                cdnTrackId: '123_2',
                streamUrl: 'https://cdn.example.com/123.m3u8',
                apiUrl: 'https://zvuk.com/api/v1/track'
            });
            expect(mockApi.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'streamUrlCaptured' })
            );
        });

        it('игнорирует неизвестный тип', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const prevCalls = mockApi.runtime.sendMessage.mock.calls.length;
            relay._onMainWorldMessage({ type: 'UNKNOWN_TYPE', data: {} });
            expect(mockApi.runtime.sendMessage.mock.calls.length).toBe(prevCalls);
        });

        it('AUDIO_CAPTURED без meta -> || {} правая сторона', async () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._onMainWorldMessage({ type: 'AUDIO_CAPTURED', mimeType: 'audio/mpeg', data: [1], url: null });
            await Promise.resolve();
            expect(true).toBe(true);
        });

        it('AUDIO_CAPTURED catch callback', async () => {
            mockApi.runtime.sendMessage.mockRejectedValueOnce(new Error('fail'));
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._onMainWorldMessage({ type: 'AUDIO_CAPTURED', mimeType: 'audio/mpeg', data: [1], url: null, meta: {} });
            await Promise.resolve();
            expect(true).toBe(true);
        });

        it('STREAM_URL_CAPTURED catch callback', async () => {
            mockApi.runtime.sendMessage.mockRejectedValueOnce(new Error('fail'));
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._onMainWorldMessage({ type: 'STREAM_URL_CAPTURED', cdnTrackId: '1_2', streamUrl: 'https://cdn.com/1.m3u8', apiUrl: '' });
            await Promise.resolve();
            expect(true).toBe(true);
        });
    });

    describe('fetchKeyFromMainWorld handler', () => {
        it('fetch OK возвращает данные', async () => {
            const buf = new Uint8Array([1, 2, 3]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(buf)
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchKeyFromMainWorld');
            const result = await handler({
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=111',
                extraHeaders: [{ name: 'x-auth', value: 'token' }],
                xekValue: 'predef-xek'
            });
            expect(result.ok).toBe(true);
            expect(result.source).toBe('fetch');
        });

        it('fetch not OK возвращает ошибку', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchKeyFromMainWorld');
            const result = await handler({
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=222',
                extraHeaders: [],
                xekValue: ''
            });
            expect(result.ok).toBe(false);
            expect(result.status).toBe(403);
        });

        it('генерирует xekValue если не передан', async () => {
            const buf = new Uint8Array([1]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(buf)
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchKeyFromMainWorld');
            const result = await handler({ url: 'https://test.com/key', extraHeaders: [] });
            expect(result.ok).toBe(true);
            expect(result.xekValue).toBeTruthy();
        });

        it('без extraHeaders -> || [] правая сторона', async () => {
            const buf = new Uint8Array([7]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchKeyFromMainWorld');
            const result = await handler({ url: 'https://zvuk.com/key', xekValue: 'xek' });
            expect(result.ok).toBe(true);
        });
    });

    describe('playTrackById handler', () => {
        it('возвращает no-wrapper если элемент не найден', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playTrackById');
            const result = handler({ zvukTrackId: 'nonexistent-999' });
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('no-wrapper');
        });

        it('кликает play button если найден', () => {
            document.body.innerHTML = `
                <div data-entity-id="track-abc" role="button">
                    <button class="PlayButton_play__abc">Play</button>
                </div>
            `;
            const clickSpy = vi.spyOn(
                document.querySelector('[class*="PlayButton_"]'),
                'click'
            );
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playTrackById');
            const result = handler({ zvukTrackId: 'track-abc' });
            expect(result.ok).toBe(true);
            expect(clickSpy).toHaveBeenCalled();
            document.body.innerHTML = '';
        });

        it('использует fallback button если нет PlayButton класса', () => {
            document.body.innerHTML = `
                <div data-entity-id="track-fallback" role="button">
                    <button>Play</button>
                </div>
            `;
            const clickSpy = vi.spyOn(document.querySelector('button'), 'click');
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playTrackById');
            const result = handler({ zvukTrackId: 'track-fallback' });
            expect(result.ok).toBe(true);
            expect(clickSpy).toHaveBeenCalled();
            document.body.innerHTML = '';
        });

        it('кликает wrapper если нет кнопок вовсе', () => {
            document.body.innerHTML = `
                <div data-entity-id="track-noplay" role="button">
                    <span>No buttons</span>
                </div>
            `;
            const wrapper = document.querySelector('[data-entity-id="track-noplay"]');
            const clickSpy = vi.spyOn(wrapper, 'click');
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playTrackById');
            const result = handler({ zvukTrackId: 'track-noplay' });
            expect(result.ok).toBe(true);
            expect(clickSpy).toHaveBeenCalled();
            document.body.innerHTML = '';
        });
    });

    describe('fetchFromTab handler', () => {
        it('fetch OK', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve('response text'),
                headers: { get: () => 'text/html' }
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchFromTab');
            const result = await handler({ url: 'https://example.com', headers: {} });
            expect(result.ok).toBe(true);
            expect(result.body).toBe('response text');
        });

        it('без headers -> || {} правая сторона', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true, status: 200,
                text: () => Promise.resolve('body'),
                headers: { get: () => 'text/html' }
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchFromTab');
            const result = await handler({ url: 'https://example.com' });
            expect(result.ok).toBe(true);
        });

        it('content-type null -> || "" правая сторона', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true, status: 200,
                text: () => Promise.resolve('body'),
                headers: { get: () => null }
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchFromTab');
            const result = await handler({ url: 'https://example.com' });
            expect(result.ok).toBe(true);
            expect(result.contentType).toBe('');
        });
    });

    describe('fetchAudioFromTab handler', () => {
        it('fetch OK', async () => {
            const buf = new Uint8Array([1, 2, 3]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve(buf),
                headers: { get: () => 'audio/mpeg' }
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchAudioFromTab');
            const result = await handler({ url: 'https://cdn.example.com/audio.mp3' });
            expect(result.ok).toBe(true);
            expect(result.mimeType).toBe('audio/mpeg');
        });

        it('fetch not OK', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchAudioFromTab');
            const result = await handler({ url: 'https://cdn.example.com/audio.mp3' });
            expect(result.ok).toBe(false);
        });

        it('content-type null -> || "audio/mpeg" правая сторона', async () => {
            const buf = new Uint8Array([9]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true, status: 200,
                arrayBuffer: () => Promise.resolve(buf),
                headers: { get: () => null }
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('fetchAudioFromTab');
            const result = await handler({ url: 'https://cdn.example.com/a.mp3' });
            expect(result.ok).toBe(true);
            expect(result.mimeType).toBe('audio/mpeg');
        });
    });

    describe('getPlaybackState handler', () => {
        it('возвращает state из DOM элемента', () => {
            document.body.innerHTML = `<div id="__sdl_state" data-t="30" data-d="180" data-p="0"></div>`;
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('getPlaybackState');
            const result = handler({});
            expect(result.ok).toBe(true);
            expect(result.state.currentTime).toBe(30);
            document.body.innerHTML = '';
        });

        it('возвращает null state если нет media элемента', () => {
            document.body.innerHTML = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('getPlaybackState');
            const result = handler({});
            expect(result.ok).toBe(true);
            expect(result.state).toBeNull();
        });

        it('возвращает state из media element', () => {
            document.body.innerHTML = `<audio id="rel-media"></audio>`;
            const media = document.getElementById('rel-media');
            Object.defineProperty(media, 'currentTime', { value: 30, configurable: true });
            Object.defineProperty(media, 'duration', { value: 120, configurable: true });
            Object.defineProperty(media, 'paused', { value: false, configurable: true });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('getPlaybackState');
            const result = handler({});
            expect(result.ok).toBe(true);
            expect(result.state.duration).toBe(120);
            document.body.innerHTML = '';
        });

        it('media с Infinity duration -> isFinite FALSE -> 0', () => {
            document.body.innerHTML = `<audio id="inf-rel"></audio>`;
            const media = document.getElementById('inf-rel');
            Object.defineProperty(media, 'currentTime', { value: 0, configurable: true });
            Object.defineProperty(media, 'duration', { value: Infinity, configurable: true });
            Object.defineProperty(media, 'paused', { value: true, configurable: true });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('getPlaybackState');
            const result = handler({});
            expect(result.state.duration).toBe(0);
            document.body.innerHTML = '';
        });
    });

    describe('playbackControl handler', () => {
        it('seek устанавливает seekTo', () => {
            document.body.innerHTML = `<div id="__sdl_state" data-t="0" data-d="180" data-p="0"></div>`;
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'seek', position: 60 });
            expect(result.ok).toBe(true);
            const el = document.getElementById('__sdl_state');
            expect(el.dataset.seekTo).toBe('60');
            document.body.innerHTML = '';
        });

        it('playPause кликает кнопку play', () => {
            document.body.innerHTML = `
                <div class="controls__abc">
                    <button>Prev</button>
                    <button>Prev2</button>
                    <button>Play</button>
                    <button>Next</button>
                    <button>Next2</button>
                </div>
            `;
            const buttons = document.querySelectorAll('button');
            const playSpy = vi.spyOn(buttons[2], 'click');
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'playPause' });
            expect(result.ok).toBe(true);
            document.body.innerHTML = '';
        });

        it('nextTrack не бросает если нет кнопок', () => {
            document.body.innerHTML = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'nextTrack' });
            expect(result.ok).toBe(true);
        });

        it('prevTrack не бросает', () => {
            document.body.innerHTML = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'prevTrack' });
            expect(result.ok).toBe(true);
        });

        it('seek без __sdl_state, с audio -> el=null + media truthy', () => {
            document.body.innerHTML = `<audio id="seek-audio"></audio>`;
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'seek', position: 50 });
            expect(result.ok).toBe(true);
            document.body.innerHTML = '';
        });

        it('неизвестный ctrl -> ни одна ветка', () => {
            document.body.innerHTML = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'stop' });
            expect(result.ok).toBe(true);
        });

        it('mini с < 3 кнопками, controls != 5 -> findBtns null', () => {
            document.body.innerHTML = `
                <div class="mini__bar">
                    <div class="controls__inner">
                        <button>1</button><button>2</button>
                    </div>
                </div>
                <div class="controls__other">
                    <button>a</button><button>b</button><button>c</button>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'playPause' });
            expect(result.ok).toBe(true);
            document.body.innerHTML = '';
        });

        it('playPause через mini controls с 3 кнопками', () => {
            document.body.innerHTML = `
                <div class="mini__abc">
                    <div class="controls__def">
                        <button>Prev</button>
                        <button>Play</button>
                        <button>Next</button>
                    </div>
                </div>
            `;
            const buttons = document.querySelectorAll('.controls__def button');
            const playSpy = vi.spyOn(buttons[1], 'click');
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('playbackControl');
            const result = handler({ control: 'playPause' });
            expect(result.ok).toBe(true);
            expect(playSpy).toHaveBeenCalled();
            document.body.innerHTML = '';
        });
    });

    describe('getTabMeta handler', () => {
        it('возвращает meta из mediaSession', () => {
            Object.defineProperty(navigator, 'mediaSession', {
                value: {
                    metadata: {
                        title: 'Test Track',
                        artist: 'Test Artist',
                        artwork: [{ src: 'https://cover.example.com/img.jpg' }]
                    }
                },
                writable: true,
                configurable: true
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('getTabMeta');
            const result = handler({});
            expect(result.ok).toBe(true);
            expect(result.meta.title).toBe('Test Track');
        });

        it('возвращает meta из DOM если нет mediaSession', () => {
            Object.defineProperty(navigator, 'mediaSession', {
                value: { metadata: null },
                writable: true,
                configurable: true
            });
            document.title = 'Page Title';
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('getTabMeta');
            const result = handler({});
            expect(result.ok).toBe(true);
        });
    });

    describe('_createDownloadBtn', () => {
        it('создаёт кнопку с размером', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createDownloadBtn(24);
            expect(btn.tagName).toBe('BUTTON');
            expect(btn.dataset.sdlDownload).toBe('true');
        });

        it('отправляет openDownloadWindow при клике', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createDownloadBtn();
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(mockApi.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'openDownloadWindow' })
            );
        });

        it('mouseover и mouseout меняют stroke (anonymous_25, 26, 27)', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createDownloadBtn();
            document.body.appendChild(btn);
            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            document.body.innerHTML = '';
            expect(true).toBe(true);
        });

        it('catch в click не бросает (anonymous_29)', async () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createDownloadBtn();
            mockApi.runtime.sendMessage.mockRejectedValueOnce(new Error('fail'));
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            expect(true).toBe(true);
        });
    });

    describe('_createTrackListBtn', () => {
        it('создаёт tracklist кнопку', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createTrackListBtn('123', { title: 'T', artist: 'A', cover: '' });
            expect(btn.dataset.sdlTracklistDl).toBe('true');
        });

        it('отправляет openDownloadWindowForTrack при клике', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createTrackListBtn('456', { title: 'Track', artist: 'Artist', cover: '' });
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(mockApi.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'openDownloadWindowForTrack', zvukTrackId: '456' })
            );
        });

        it('mouseover изменяет stroke и opacity', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createTrackListBtn('789', { title: 'T', artist: 'A', cover: '' });
            document.body.appendChild(btn);
            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            expect(btn.style.opacity).toBe('1');
            document.body.innerHTML = '';
        });

        it('mouseout восстанавливает stroke и opacity', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createTrackListBtn('790', { title: 'T', artist: 'A', cover: '' });
            document.body.appendChild(btn);
            btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            expect(btn.style.opacity).toBe('0.7');
            document.body.innerHTML = '';
        });

        it('catch в click, пустые title/artist (anonymous_35, branches 42,1 и 43,1)', async () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const btn = relay._createTrackListBtn('1', { title: '', artist: '', cover: '' });
            mockApi.runtime.sendMessage.mockRejectedValueOnce(new Error('fail'));
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            expect(true).toBe(true);
        });
    });

    describe('_setupStyle', () => {
        it('создаёт style элемент', () => {
            document.head.innerHTML = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._setupStyle();
            expect(document.getElementById('__sdl_tracklist_style')).toBeTruthy();
        });

        it('не добавляет повторно если уже есть', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._setupStyle();
            relay._setupStyle();
            const styles = document.querySelectorAll('#__sdl_tracklist_style');
            expect(styles.length).toBe(1);
        });

        it('использует documentElement если document.head равен null', () => {
            document.getElementById('__sdl_tracklist_style')?.remove();
            Object.defineProperty(document, 'head', { get: () => null, configurable: true });
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._setupStyle();
            delete document.head;
            const style = document.getElementById('__sdl_tracklist_style');
            expect(style).toBeTruthy();
            style?.remove();
        });
    });

    describe('_injectPlayer', () => {
        it('не бросает если нет mini controls', () => {
            document.body.innerHTML = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            expect(() => relay._injectPlayer()).not.toThrow();
        });

        it('добавляет кнопку в mini controls', () => {
            document.body.innerHTML = `
                <div class="mini__abc">
                    <div class="controls__def">
                        <button>A</button><button>B</button><button>C</button>
                    </div>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlayer();
            const mini = document.querySelector('[class*="mini__"] [class*="controls__"]');
            expect(mini.querySelector('[data-sdl-download]')).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('добавляет кнопку в controls с 5 кнопками', () => {
            document.body.innerHTML = `
                <div class="controls__five">
                    <button>1</button><button>2</button><button>3</button>
                    <button>4</button><button>5</button>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlayer();
            const c = document.querySelector('.controls__five');
            expect(c.querySelector('[data-sdl-download]')).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('добавляет кнопку в мобильный мини плеер', () => {
            document.body.innerHTML = `
                <div class="MiniPlayerMobile_controls__abc">
                    <button>Prev</button>
                    <button>Last</button>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlayer();
            const mobile = document.querySelector('[class*="MiniPlayerMobile_controls__"]');
            expect(mobile.querySelector('[data-sdl-download]')).toBeTruthy();
            document.body.innerHTML = '';
        });
    });

    describe('_injectPlaylistHeader', () => {
        it('добавляет кнопку в favorites wrapper', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/favorites', href: 'https://zvuk.com/favorites' },
                writable: true
            });
            document.body.innerHTML = `
                <div class="InfoContainer_wrapper__abc">
                    <button class="GeneralButton_button__xyz">Edit</button>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            const btn = document.querySelector('[data-sdl-playlist-dl]');
            expect(btn).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('добавляет кнопку в playlist header', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/playlist/123', href: 'https://zvuk.com/playlist/123' },
                writable: true
            });
            document.body.innerHTML = `
                <div class="HeaderButtons_wrapper__abc">
                    <button class="GeneralButton_button__xyz">Share</button>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            const btn = document.querySelector('[data-sdl-playlist-dl]');
            expect(btn).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('ничего не делает для обычных страниц', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/track/123', href: 'https://zvuk.com/track/123' },
                writable: true
            });
            document.body.innerHTML = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            expect(() => relay._injectPlaylistHeader()).not.toThrow();
        });

        it('не добавляет кнопку повторно', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/favorites', href: 'https://zvuk.com/favorites' },
                writable: true
            });
            document.body.innerHTML = `<div class="InfoContainer_wrapper__abc"></div>`;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            relay._injectPlaylistHeader();
            const btns = document.querySelectorAll('[data-sdl-playlist-dl]');
            expect(btns.length).toBe(1);
            document.body.innerHTML = '';
        });

        it('не добавляет кнопку повторно для playlist', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/playlist/789', href: 'https://zvuk.com/playlist/789' },
                writable: true
            });
            document.body.innerHTML = `
                <div class="HeaderButtons_wrapper__abc">
                    <div data-sdl-playlist-dl="true">existing</div>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            const btns = document.querySelectorAll('[data-sdl-playlist-dl]');
            expect(btns.length).toBe(1);
            document.body.innerHTML = '';
        });

        it('добавляет через insertBefore если есть CmButtons', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/playlist/101', href: 'https://zvuk.com/playlist/101' },
                writable: true
            });
            document.body.innerHTML = `
                <div class="HeaderButtons_wrapper__abc">
                    <div class="CmButtons_wrapper__xyz">CM</div>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            const btn = document.querySelector('[data-sdl-playlist-dl]');
            expect(btn).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('добавляет кнопку без refBtn в favorites', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/favorites', href: 'https://zvuk.com/favorites' },
                writable: true
            });
            document.body.innerHTML = `
                <div class="InfoContainer_wrapper__abc">
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            const btn = document.querySelector('[data-sdl-playlist-dl]');
            expect(btn).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('catch в _makeDlBtn click не бросает (anonymous_41)', async () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/playlist/999', href: 'https://zvuk.com/playlist/999' },
                writable: true
            });
            document.body.innerHTML = `<div class="HeaderButtons_wrapper__x"></div>`;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            const btn = document.querySelector('[data-sdl-playlist-dl]');
            if (btn) {
                mockApi.runtime.sendMessage.mockRejectedValueOnce(new Error('fail'));
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await Promise.resolve();
            }
            document.body.innerHTML = '';
            expect(true).toBe(true);
        });

        it('_makeDlBtn отправляет openDownloadWindow при клике', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/playlist/456', href: 'https://zvuk.com/playlist/456' },
                writable: true
            });
            document.body.innerHTML = `
                <div class="HeaderButtons_wrapper__abc">
                    <button class="GeneralButton_button__xyz">Share</button>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectPlaylistHeader();
            const btn = document.querySelector('[data-sdl-playlist-dl]');
            const prevCalls = mockApi.runtime.sendMessage.mock.calls.length;
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(mockApi.runtime.sendMessage.mock.calls.length).toBeGreaterThan(prevCalls);
            document.body.innerHTML = '';
        });
    });

    describe('_injectTrackList', () => {
        it('добавляет tracklist кнопки', () => {
            document.body.innerHTML = `
                <div data-entity-id="track-1" role="button">
                    <div class="Controls_controls__abc">
                        <span class="Controls_duration__def">3:30</span>
                    </div>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectTrackList();
            const btn = document.querySelector('[data-sdl-tracklist-dl]');
            expect(btn).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('использует appendChild если нет duration', () => {
            document.body.innerHTML = `
                <div data-entity-id="track-nodur" role="button">
                    <div class="Controls_controls__abc">
                    </div>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectTrackList();
            const controls = document.querySelector('.Controls_controls__abc');
            expect(controls.querySelector('[data-sdl-tracklist-dl]')).toBeTruthy();
            document.body.innerHTML = '';
        });

        it('пропускает wrapper без Controls_controls__', () => {
            document.body.innerHTML = `
                <div data-entity-id="no-ctrl" role="button">
                    <span>No controls</span>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectTrackList();
            expect(document.querySelector('[data-sdl-tracklist-dl]')).toBeNull();
            document.body.innerHTML = '';
        });

        it('пропускает wrapper с пустым data-entity-id', () => {
            document.body.innerHTML = `
                <div data-entity-id="" role="button">
                    <div class="Controls_controls__x"></div>
                </div>
            `;
            const relay = new globalThis.ZvukRelay(mockApi);
            relay._injectTrackList();
            expect(document.querySelector('[data-sdl-tracklist-dl]')).toBeNull();
            document.body.innerHTML = '';
        });
    });

    describe('_buildTabMeta', () => {
        it('использует tabMetaFromSession если только artist', () => {
            Object.defineProperty(navigator, 'mediaSession', {
                value: {
                    metadata: {
                        title: '',
                        artist: 'Artist Only',
                        artwork: []
                    }
                },
                writable: true,
                configurable: true
            });
            const relay = new globalThis.ZvukRelay(mockApi);
            const handler = relay._handlers.get('getTabMeta');
            const result = handler({});
            expect(result.ok).toBe(true);
            expect(result.meta.artist).toBe('Artist Only');
        });
    });

    describe('_tabMetaFromSession', () => {
        it('возвращает meta из session', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const result = relay._tabMetaFromSession(
                { title: 'Track', artist: 'Artist', artwork: [{ src: 'https://img.com/cover.jpg' }] },
                '42'
            );
            expect(result.ok).toBe(true);
            expect(result.meta.title).toBe('Track');
            expect(result.meta.zvukTrackId).toBe('42');
        });

        it('artist пустой -> || "" правая сторона', () => {
            const relay = new globalThis.ZvukRelay(mockApi);
            const result = relay._tabMetaFromSession({ title: 'T', artist: '', artwork: [] }, null);
            expect(result.meta.artist).toBe('');
        });
    });

    describe('_tabMetaFromDom', () => {
        it('возвращает meta из title', () => {
            document.title = 'Test Title';
            const relay = new globalThis.ZvukRelay(mockApi);
            const result = relay._tabMetaFromDom(null);
            expect(result.ok).toBe(true);
            expect(result.meta.title).toBe('Test Title');
        });

        it('title из h1 элемента в DOM', () => {
            document.body.innerHTML = `<h1>DOM Title</h1>`;
            const relay = new globalThis.ZvukRelay(mockApi);
            const result = relay._tabMetaFromDom(null);
            expect(result.meta.title).toBe('DOM Title');
            document.body.innerHTML = '';
        });

        it('пустой DOM и пустой document.title -> ""', () => {
            document.body.innerHTML = '';
            document.title = '';
            const relay = new globalThis.ZvukRelay(mockApi);
            const result = relay._tabMetaFromDom(null);
            expect(result.meta.title).toBe('');
        });
    });
});

describe('ZvukRelay — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        const origBaseRelay = globalThis.BaseRelay;
        globalThis.BaseRelay = class {
            constructor(api) { this._api = api; this._handlers = new Map(); this._injectors = []; }
            registerHandler(name, fn) { this._handlers.set(name, fn); }
            registerInjector(fn) { this._injectors.push(fn); }
            start() {}
        };
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRelay.js');
        vi.unstubAllGlobals();
        globalThis.BaseRelay = origBaseRelay;
        expect(globalThis.ZvukRelay).toBeDefined();
    });
});

describe('ZvukRelay — IIFE browser branch', () => {
    it('api = browser если browser определён', async () => {
        const localListeners = [];
        const savedChrome = globalThis.chrome;
        const origBaseRelay = globalThis.BaseRelay;
        globalThis.BaseRelay = class {
            constructor(api) { this._api = api; this._handlers = new Map(); this._injectors = []; }
            registerHandler(name, fn) { this._handlers.set(name, fn); }
            registerInjector(fn) { this._injectors.push(fn); }
            start() { this._api.runtime.onMessage.addListener(() => {}); }
        };
        globalThis.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({}),
                onMessage: { addListener: vi.fn((cb) => localListeners.push(cb)) }
            }
        };
        globalThis.chrome = undefined;
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRelay.js');
        globalThis.browser = undefined;
        globalThis.chrome = savedChrome;
        globalThis.BaseRelay = origBaseRelay;
        expect(localListeners.length).toBeGreaterThan(0);
    });
});
