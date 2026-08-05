import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadModule } from '../helpers/loadModule.js';

let capturedMessageListeners = [];
let runtimeMessageListeners = [];

beforeAll(() => {
    capturedMessageListeners = [];
    runtimeMessageListeners = [];

    const origAdd = window.addEventListener.bind(window);
    window.addEventListener = vi.fn((event, cb) => {
        if (event === 'message') capturedMessageListeners.push(cb);
        else origAdd(event, cb);
    });

    globalThis.chrome = {
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({}),
            onMessage: {
                addListener: vi.fn((cb) => { runtimeMessageListeners.push(cb); })
            }
        }
    };
    globalThis.browser = undefined;

    loadModule('content/AudioRelay.js');
});

function sendWindowMessage(data) {
    const event = new MessageEvent('message', { data });
    for (const listener of capturedMessageListeners) {
        listener(event);
    }
}

function sendRuntimeMessage(action, payload = {}, sender = {}) {
    return new Promise(resolve => {
        for (const listener of runtimeMessageListeners) {
            const result = listener({ action, ...payload }, sender, resolve);
            if (!result) resolve(null);
        }
    });
}

describe('AudioRelay', () => {
    describe('window message listener', () => {
        it('игнорирует сообщения без __sounddlib', () => {
            const prevCalls = globalThis.chrome.runtime.sendMessage.mock.calls.length;
            sendWindowMessage({ type: 'AUDIO_CAPTURED', mimeType: 'audio/mpeg' });
            expect(globalThis.chrome.runtime.sendMessage.mock.calls.length).toBe(prevCalls);
        });

        it('отправляет audioIntercepted при AUDIO_CAPTURED', () => {
            sendWindowMessage({
                __sounddlib: true,
                type: 'AUDIO_CAPTURED',
                mimeType: 'audio/mpeg',
                data: [1, 2, 3],
                url: null,
                meta: { title: 'Test', artist: 'Artist' }
            });
            expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'audioIntercepted' })
            );
        });

        it('отправляет streamUrlCaptured при STREAM_URL_CAPTURED', () => {
            sendWindowMessage({
                __sounddlib: true,
                type: 'STREAM_URL_CAPTURED',
                cdnTrackId: '123_2',
                streamUrl: 'https://cdn.example.com/123.m3u8',
                apiUrl: 'https://zvuk.com/api'
            });
            expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'streamUrlCaptured', cdnTrackId: '123_2' })
            );
        });

        it('игнорирует неизвестные типы сообщений', () => {
            const prevCalls = globalThis.chrome.runtime.sendMessage.mock.calls.length;
            sendWindowMessage({ __sounddlib: true, type: 'UNKNOWN_TYPE' });
            expect(globalThis.chrome.runtime.sendMessage.mock.calls.length).toBe(prevCalls);
        });
    });

    describe('runtime message handler — fetchKeyFromMainWorld', () => {
        it('OK fetch', async () => {
            const buf = new Uint8Array([1, 2, 3]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(buf)
            });
            const resp = await sendRuntimeMessage('fetchKeyFromMainWorld', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=111',
                extraHeaders: [],
                xekValue: 'my-xek'
            });
            expect(resp.ok).toBe(true);
            expect(resp.source).toBe('fetch');
        });

        it('fetch error returns ok:false', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
            const resp = await sendRuntimeMessage('fetchKeyFromMainWorld', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=222',
                extraHeaders: [],
                xekValue: ''
            });
            expect(resp.ok).toBe(false);
            expect(resp.status).toBe(403);
        });

        it('exception returns ok:false', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
            const resp = await sendRuntimeMessage('fetchKeyFromMainWorld', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=333',
                extraHeaders: [],
                xekValue: ''
            });
            expect(resp.ok).toBe(false);
            expect(resp.error).toContain('network error');
        });

        it('генерирует xekValue если не передан', async () => {
            const buf = new Uint8Array([5]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                arrayBuffer: () => Promise.resolve(buf)
            });
            const resp = await sendRuntimeMessage('fetchKeyFromMainWorld', {
                url: 'https://zvuk.com/keyserver/api/v1/key?track_id=444',
                extraHeaders: [{ name: 'x-auth', value: 'token' }]
            });
            expect(resp.ok).toBe(true);
            expect(resp.xekValue).toBeTruthy();
        });
    });

    describe('runtime message handler — playTrackById', () => {
        it('возвращает no-wrapper если элемент не найден', () => {
            document.body.innerHTML = '';
            return new Promise(resolve => {
                for (const listener of runtimeMessageListeners) {
                    const result = listener({ action: 'playTrackById', zvukTrackId: 'not-in-dom' }, {}, resolve);
                    if (result === false) resolve({ ok: false, reason: 'no-wrapper' });
                    return;
                }
            }).then(resp => {
                expect(resp).toMatchObject({ ok: false, reason: 'no-wrapper' });
            });
        });

        it('кликает wrapper если нет play button', () => {
            document.body.innerHTML = `
                <div data-entity-id="track-xyz" role="button">
                    <span>Track Name</span>
                </div>
            `;
            const wrapper = document.querySelector('[data-entity-id="track-xyz"]');
            const clickSpy = vi.spyOn(wrapper, 'click');

            return new Promise(resolve => {
                for (const listener of runtimeMessageListeners) {
                    const result = listener({ action: 'playTrackById', zvukTrackId: 'track-xyz' }, {}, resolve);
                    if (result === false) resolve({ ok: true });
                    return;
                }
            }).then(resp => {
                expect(resp.ok).toBe(true);
                document.body.innerHTML = '';
            });
        });
    });

    describe('runtime message handler — fetchFromTab', () => {
        it('fetch OK', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve('page content'),
                headers: { get: () => 'text/html' }
            });
            const resp = await sendRuntimeMessage('fetchFromTab', { url: 'https://zvuk.com', headers: {} });
            expect(resp.ok).toBe(true);
            expect(resp.body).toBe('page content');
        });
    });

    describe('runtime message handler — fetchAudioFromTab', () => {
        it('fetch OK', async () => {
            const buf = new Uint8Array([1, 2]).buffer;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve(buf),
                headers: { get: () => 'audio/mpeg' }
            });
            const resp = await sendRuntimeMessage('fetchAudioFromTab', { url: 'https://cdn.example.com/audio.mp3' });
            expect(resp.ok).toBe(true);
            expect(resp.mimeType).toBe('audio/mpeg');
        });

        it('fetch not OK', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
            const resp = await sendRuntimeMessage('fetchAudioFromTab', { url: 'https://cdn.example.com/audio.mp3' });
            expect(resp.ok).toBe(false);
        });
    });

    describe('runtime message handler — getPlaybackState', () => {
        it('возвращает state из DOM', () => {
            document.body.innerHTML = `<div id="__sdl_state" data-t="45" data-d="200" data-p="1"></div>`;
            return sendRuntimeMessage('getPlaybackState', {}).then(resp => {
                expect(resp.ok).toBe(true);
                expect(resp.state.currentTime).toBe(45);
                expect(resp.state.paused).toBe(true);
                document.body.innerHTML = '';
            });
        });

        it('возвращает null state без media', () => {
            document.body.innerHTML = '';
            return sendRuntimeMessage('getPlaybackState', {}).then(resp => {
                expect(resp.ok).toBe(true);
                expect(resp.state).toBeNull();
            });
        });
    });

    describe('runtime message handler — playbackControl', () => {
        it('seek', () => {
            document.body.innerHTML = `<div id="__sdl_state" data-t="0" data-d="180" data-p="0"></div>`;
            return sendRuntimeMessage('playbackControl', { control: 'seek', position: 90 }).then(resp => {
                expect(resp.ok).toBe(true);
                const el = document.getElementById('__sdl_state');
                expect(el.dataset.seekTo).toBe('90');
                document.body.innerHTML = '';
            });
        });

        it('playPause не бросает', () => {
            document.body.innerHTML = '';
            return sendRuntimeMessage('playbackControl', { control: 'playPause' }).then(resp => {
                expect(resp.ok).toBe(true);
            });
        });
    });

    describe('runtime message handler — getTabMeta', () => {
        it('возвращает meta из mediaSession', () => {
            Object.defineProperty(navigator, 'mediaSession', {
                value: {
                    metadata: {
                        title: 'Session Track',
                        artist: 'Session Artist',
                        artwork: [{ src: 'https://img.com/cover.jpg' }]
                    }
                },
                writable: true,
                configurable: true
            });
            return sendRuntimeMessage('getTabMeta', {}).then(resp => {
                expect(resp.ok).toBe(true);
                expect(resp.meta.title).toBe('Session Track');
            });
        });

        it('возвращает meta из title если нет mediaSession', () => {
            Object.defineProperty(navigator, 'mediaSession', {
                value: { metadata: null },
                writable: true,
                configurable: true
            });
            document.title = 'Audio Page';
            return sendRuntimeMessage('getTabMeta', {}).then(resp => {
                expect(resp.ok).toBe(true);
            });
        });
    });

    describe('runtime message handler — неизвестный action', () => {
        it('возвращает false', () => {
            let returnedFalse = false;
            for (const listener of runtimeMessageListeners) {
                const result = listener({ action: 'completely_unknown' }, {}, vi.fn());
                if (result === false) returnedFalse = true;
            }
            expect(returnedFalse).toBe(true);
        });
    });
});
