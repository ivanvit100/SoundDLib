import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../core/base/BaseRelay.js';

describe('BaseRelay — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../../core/base/BaseRelay.js');
        vi.unstubAllGlobals();
        expect(globalThis.BaseRelay).toBeDefined();
    });
});

describe('BaseRelay', () => {
    let relay;
    let mockApi;
    let messageListeners;
    let runtimeListeners;

    beforeEach(() => {
        messageListeners = [];
        runtimeListeners = [];

        window.addEventListener = vi.fn((evt, handler) => {
            if (evt === 'message') messageListeners.push(handler);
        });

        mockApi = {
            runtime: {
                onMessage: {
                    addListener: vi.fn((handler) => { runtimeListeners.push(handler); })
                }
            }
        };

        relay = new globalThis.BaseRelay(mockApi);
    });

    it('BaseRelay класс существует', () => {
        expect(globalThis.BaseRelay).toBeDefined();
    });

    describe('registerHandler', () => {
        it('регистрирует handler для action', () => {
            const handler = vi.fn();
            relay.registerHandler('test', handler);
            expect(relay._msgHandlers.has('test')).toBe(true);
        });

        it('биндит handler к relay', () => {
            let capturedThis;
            const handler = function() { capturedThis = this; };
            relay.registerHandler('test', handler);
            relay._msgHandlers.get('test')();
            expect(capturedThis).toBe(relay);
        });
    });

    describe('registerInjector', () => {
        it('регистрирует injector функцию', () => {
            const before = relay._injectors.length;
            const injector = vi.fn();
            relay.registerInjector(injector);
            expect(relay._injectors.length).toBe(before + 1);
        });
    });

    describe('start', () => {
        beforeEach(() => {
            const observeFn = vi.fn();
            window.MutationObserver = class {
                constructor(cb) { this._cb = cb; }
                observe() { observeFn(); }
                disconnect() {}
            };
        });

        it('добавляет window message listener', () => {
            relay.start();
            expect(window.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('добавляет runtime onMessage listener', () => {
            relay.start();
            expect(mockApi.runtime.onMessage.addListener).toHaveBeenCalled();
        });

        it('запускает injectors при start', () => {
            const injector = vi.fn();
            relay.registerInjector(injector);
            relay.start();
            expect(injector).toHaveBeenCalled();
        });

        it('window message listener игнорирует не-sounddlib события', () => {
            const onMainWorld = vi.spyOn(relay, '_onMainWorldMessage');
            relay.start();
            const listener = messageListeners[0];
            listener({ data: { __sounddlib: false, type: 'test' } });
            expect(onMainWorld).not.toHaveBeenCalled();
        });

        it('window message listener вызывает _onMainWorldMessage для sounddlib', () => {
            const onMainWorld = vi.spyOn(relay, '_onMainWorldMessage');
            relay.start();
            const listener = messageListeners[0];
            listener({ data: { __sounddlib: true, type: 'TEST', payload: 1 } });
            expect(onMainWorld).toHaveBeenCalledWith({ __sounddlib: true, type: 'TEST', payload: 1 });
        });

        it('runtime listener возвращает false для неизвестного action', () => {
            relay.start();
            const listener = runtimeListeners[0];
            const result = listener({ action: 'unknown' }, {}, vi.fn());
            expect(result).toBe(false);
        });

        it('runtime listener вызывает handler и возвращает true', async () => {
            const handler = vi.fn().mockResolvedValue({ ok: true });
            relay.registerHandler('myAction', handler);
            relay.start();
            const listener = runtimeListeners[0];
            const sendResponse = vi.fn();
            const result = listener({ action: 'myAction' }, {}, sendResponse);
            expect(result).toBe(true);
            await new Promise(r => setTimeout(r, 10));
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
        });

        it('runtime listener отвечает с ошибкой если handler бросает', async () => {
            const handler = vi.fn().mockRejectedValue(new Error('fail'));
            relay.registerHandler('errAction', handler);
            relay.start();
            const listener = runtimeListeners[0];
            const sendResponse = vi.fn();
            listener({ action: 'errAction' }, {}, sendResponse);
            await new Promise(r => setTimeout(r, 10));
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Error: fail' });
        });

        it('MutationObserver callback вызывает _runInjectors', async () => {
            vi.useFakeTimers();
            let observerCallback = null;
            window.MutationObserver = class {
                constructor(cb) { observerCallback = cb; }
                observe() {}
                disconnect() {}
            };
            const injector = vi.fn();
            relay.registerInjector(injector);
            relay.start();
            injector.mockClear();
            observerCallback([]);
            vi.advanceTimersByTime(300);
            expect(injector).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('observe использует documentElement если document.body null', () => {
            let observeTarget = null;
            window.MutationObserver = class {
                constructor(cb) {}
                observe(target) { observeTarget = target; }
                disconnect() {}
            };
            const origBody = document.body;
            Object.defineProperty(document, 'body', { value: null, configurable: true });
            relay.start();
            Object.defineProperty(document, 'body', { value: origBody, configurable: true });
            expect(observeTarget).toBe(document.documentElement);
        });
    });

    describe('_runInjectors', () => {
        it('запускает все injectors', () => {
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            relay.registerInjector(fn1);
            relay.registerInjector(fn2);
            relay._runInjectors();
            expect(fn1).toHaveBeenCalled();
            expect(fn2).toHaveBeenCalled();
        });

        it('не падает если injector бросает', () => {
            relay.registerInjector(() => { throw new Error('injector error'); });
            expect(() => relay._runInjectors()).not.toThrow();
        });
    });

    describe('_onMainWorldMessage', () => {
        it('базовая реализация ничего не делает', () => {
            expect(() => relay._onMainWorldMessage({ type: 'TEST' })).not.toThrow();
        });
    });
});
