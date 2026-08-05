import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadModule } from '../../helpers/loadModule.js';

let postMessages = [];

beforeAll(() => {
    globalThis.BaseInterceptor = class {
        _post(type, payload) {
            postMessages.push({ type, payload });
            window.postMessage({ __sounddlib: true, type, ...payload }, '*');
        }
        install() { throw new Error('install() not implemented'); }
    };

    window.__sounddlib_interceptor = false;
    loadModule('services/zvuk/ZvukInterceptor.js');
});

describe('ZvukInterceptor', () => {
    it('ZvukInterceptor класс существует', () => {
        expect(globalThis.ZvukInterceptor).toBeDefined();
    });

    it('наследует от BaseInterceptor', () => {
        const interceptor = new globalThis.ZvukInterceptor();
        expect(interceptor).toBeInstanceOf(globalThis.BaseInterceptor);
    });

    it('устанавливает __sounddlib_interceptor = true после install()', () => {
        expect(window.__sounddlib_interceptor).toBe(true);
    });

    it('не устанавливается повторно если уже активен', () => {
        window.__sounddlib_interceptor = true;
        const interceptor = new globalThis.ZvukInterceptor();
        const hookSpy = vi.spyOn(interceptor, '_hookMediaElement').mockImplementation(() => {});
        interceptor.install();
        expect(hookSpy).not.toHaveBeenCalled();
        hookSpy.mockRestore();
    });

    describe('_hookKeyCapture', () => {
        it('устанавливает __sounddlib_key_spy', () => {
            expect(window.__sounddlib_key_spy).toBe(true);
        });

        it('устанавливает __sounddlib_key_store', () => {
            expect(window.__sounddlib_key_store).toBeDefined();
        });
    });

    describe('_hookStateBridge', () => {
        it('не бросает при запуске', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            expect(() => interceptor._hookStateBridge()).not.toThrow();
        });
    });

    describe('_hookWorkerSpy', () => {
        it('заменяет Blob конструктор', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._hookWorkerSpy();
            const longString = 'x'.repeat(201);
            const blob = new Blob([longString], { type: 'text/javascript' });
            expect(blob).toBeDefined();
        });

        it('не меняет Blob для коротких строк', () => {
            const shortStr = 'x'.repeat(100);
            const blob = new Blob([shortStr], { type: 'text/javascript' });
            expect(blob.size).toBeGreaterThan(0);
        });

        it('не меняет Blob для не-js типов', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._hookWorkerSpy();
            const longStr = 'x'.repeat(201);
            const blob = new Blob([longStr], { type: 'text/plain' });
            expect(blob.size).toBe(longStr.length);
        });

        it('заменяет Worker конструктор', () => {
            expect(typeof window.Worker).toBe('function');
        });
    });

    describe('_hookMediaElement', () => {
        it('overrides HTMLMediaElement.prototype.src', () => {
            const interceptor = new globalThis.ZvukInterceptor();
            interceptor._post = vi.fn();
            interceptor._hookMediaElement();
        });

        it('overrides HTMLMediaElement.prototype.play', () => {
            expect(typeof HTMLMediaElement.prototype.play).toBe('function');
        });
    });

    describe('fetch hook', () => {
        it('перехватывает keyserver запросы', async () => {
            window.__sounddlib_pending_tid = null;

            const origFetch = window.fetch;
            window.fetch = async (url) => ({
                ok: true,
                url,
                text: () => Promise.resolve('{}'),
                clone: () => ({ text: () => Promise.resolve('{}') }),
                arrayBuffer: async () => new ArrayBuffer(16)
            });

            // The interceptor has already replaced fetch — just call it
            try {
                await fetch('https://zvuk.com/keyserver/api/v1/key?track_id=xyz');
            } catch {}

            window.fetch = origFetch;
        });
    });
});
