import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../core/EventBus.js';

describe('EventBus — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../core/EventBus.js');
        vi.unstubAllGlobals();
        expect(globalThis.EventBus).toBeDefined();
    });
});

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        bus = new globalThis.EventBus();
    });

    describe('on / emit', () => {
        it('вызывает listener при emit события', () => {
            const fn = vi.fn();
            bus.on('test', fn);
            bus.emit('test', { value: 42 });
            expect(fn).toHaveBeenCalledOnce();
            expect(fn).toHaveBeenCalledWith({ value: 42 });
        });

        it('не вызывает listener для другого события', () => {
            const fn = vi.fn();
            bus.on('a', fn);
            bus.emit('b', {});
            expect(fn).not.toHaveBeenCalled();
        });

        it('возвращает функцию отписки, которая удаляет listener', () => {
            const fn = vi.fn();
            const off = bus.on('test', fn);
            off();
            bus.emit('test', {});
            expect(fn).not.toHaveBeenCalled();
        });

        it('не падает при emit несуществующего события', () => {
            expect(() => bus.emit('nonexistent', {})).not.toThrow();
        });

        it('изолирует ошибку в listener и вызывает остальных подписчиков', () => {
            const bad = vi.fn(() => { throw new Error('oops'); });
            const good = vi.fn();
            bus.on('ev', bad);
            bus.on('ev', good);
            expect(() => bus.emit('ev')).not.toThrow();
            expect(good).toHaveBeenCalledOnce();
        });
    });

    describe('once', () => {
        it('вызывает callback ровно один раз при повторных emit', () => {
            const fn = vi.fn();
            bus.once('ping', fn);
            bus.emit('ping');
            bus.emit('ping');
            bus.emit('ping');
            expect(fn).toHaveBeenCalledOnce();
        });

        it('передаёт data в callback', () => {
            const fn = vi.fn();
            bus.once('ping', fn);
            bus.emit('ping', { x: 1 });
            expect(fn).toHaveBeenCalledWith({ x: 1 });
        });
    });

    describe('off', () => {
        it('удаляет конкретный listener, не трогая остальных', () => {
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            bus.on('ev', fn1);
            bus.on('ev', fn2);
            bus.off('ev', fn1);
            bus.emit('ev', null);
            expect(fn1).not.toHaveBeenCalled();
            expect(fn2).toHaveBeenCalledOnce();
        });

        it('не падает при off несуществующего события', () => {
            expect(() => bus.off('never-registered', vi.fn())).not.toThrow();
        });
    });

    describe('clear', () => {
        it('clear(event) удаляет listeners только этого события', () => {
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            bus.on('a', fn1);
            bus.on('b', fn2);
            bus.clear('a');
            bus.emit('a');
            bus.emit('b');
            expect(fn1).not.toHaveBeenCalled();
            expect(fn2).toHaveBeenCalledOnce();
        });

        it('clear() без аргументов удаляет все listeners', () => {
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            bus.on('x', fn1);
            bus.on('y', fn2);
            bus.clear();
            bus.emit('x');
            bus.emit('y');
            expect(fn1).not.toHaveBeenCalled();
            expect(fn2).not.toHaveBeenCalled();
        });
    });
});
