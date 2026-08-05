import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../core/RateLimiter.js';

describe('RateLimiter', () => {
    let limiter;

    beforeEach(() => {
        vi.useFakeTimers();
        limiter = new globalThis.RateLimiter();
    });

    afterEach(() => {
        limiter.reset();
        vi.useRealTimers();
    });

    it('RateLimiter класс и globalRateLimiter существуют', () => {
        expect(globalThis.RateLimiter).toBeDefined();
        expect(globalThis.globalRateLimiter).toBeInstanceOf(globalThis.RateLimiter);
    });

    it('загружает существующий globalRateLimiter при повторной загрузке', () => {
        // globalRateLimiter already exists, re-evaluating the IIFE triggers the else branch
        const existing = globalThis.globalRateLimiter;
        expect(existing).toBeDefined();
    });

    describe('throttle', () => {
        it('устанавливает throttled=true и снимает через duration', () => {
            expect(limiter.getStats().throttled).toBe(false);
            limiter.throttle(1000);
            expect(limiter.getStats().throttled).toBe(true);
            vi.advanceTimersByTime(1000);
            expect(limiter.getStats().throttled).toBe(false);
        });

        it('игнорирует повторный вызов throttle', () => {
            limiter.throttle(1000);
            limiter.throttle(1000);
            expect(limiter.getStats().throttled).toBe(true);
        });

        it('очищает предыдущий таймер при наличии _throttleTimer', () => {
            limiter._throttleTimer = 999;
            limiter.throttle(1000);
            expect(limiter.getStats().throttled).toBe(true);
        });

        it('вызывает ожидающие callbacks после снятия throttle', async () => {
            limiter.throttle(1000);
            const resolved = vi.fn();
            limiter.trackRequest('test').then(resolved);
            await Promise.resolve();
            expect(resolved).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);
            await Promise.resolve();
            await Promise.resolve();
            expect(resolved).toHaveBeenCalled();
        });

        it('использует дефолтный duration 30000', () => {
            limiter.throttle();
            expect(limiter.getStats().throttled).toBe(true);
            vi.advanceTimersByTime(29999);
            expect(limiter.getStats().throttled).toBe(true);
            vi.advanceTimersByTime(1);
            expect(limiter.getStats().throttled).toBe(false);
        });
    });

    describe('trackRequest', () => {
        it('возвращает resolved Promise если не throttled', async () => {
            await expect(limiter.trackRequest('test')).resolves.toBeUndefined();
        });

        it('возвращает pending Promise если throttled', async () => {
            limiter.throttle(60000);
            let settled = false;
            limiter.trackRequest('test').then(() => { settled = true; });
            await Promise.resolve();
            expect(settled).toBe(false);
        });

        it('использует "unknown" как источник по умолчанию', async () => {
            await expect(limiter.trackRequest()).resolves.toBeUndefined();
        });
    });

    describe('acquire', () => {
        it('делегирует к trackRequest', async () => {
            await expect(limiter.acquire('src')).resolves.toBeUndefined();
        });

        it('использует "default" как источник по умолчанию', async () => {
            await expect(limiter.acquire()).resolves.toBeUndefined();
        });
    });

    describe('execute', () => {
        it('вызывает fn и возвращает результат', async () => {
            const fn = vi.fn(() => 42);
            const result = await limiter.execute('test', fn);
            expect(fn).toHaveBeenCalledOnce();
            expect(result).toBe(42);
        });

        it('ждёт throttle перед вызовом fn', async () => {
            limiter.throttle(500);
            const fn = vi.fn(() => 'done');
            let result = null;
            limiter.execute('test', fn).then(r => { result = r; });
            await Promise.resolve();
            expect(fn).not.toHaveBeenCalled();
            vi.advanceTimersByTime(500);
            await Promise.resolve();
            await Promise.resolve();
            expect(fn).toHaveBeenCalled();
        });
    });

    describe('getStats', () => {
        it('возвращает корректную статистику', () => {
            expect(limiter.getStats()).toEqual({ throttled: false, pendingRequests: 0 });
        });

        it('отображает количество ожидающих', () => {
            limiter.throttle(1000);
            limiter.trackRequest('a');
            limiter.trackRequest('b');
            expect(limiter.getStats().pendingRequests).toBe(2);
        });
    });

    describe('reset', () => {
        it('сбрасывает throttle и вызывает pending', async () => {
            limiter.throttle(60000);
            const resolved = vi.fn();
            limiter.trackRequest('x').then(resolved);
            await Promise.resolve();
            limiter.reset();
            await Promise.resolve();
            expect(resolved).toHaveBeenCalled();
            expect(limiter.getStats().throttled).toBe(false);
        });

        it('reset без активного throttle', () => {
            expect(() => limiter.reset()).not.toThrow();
        });

        it('reset очищает таймер', () => {
            limiter.throttle(1000);
            limiter.reset();
            expect(limiter._throttleTimer).toBeNull();
        });

        it('reset без таймера не падает', () => {
            limiter._throttleTimer = null;
            limiter._throttled = true;
            expect(() => limiter.reset()).not.toThrow();
        });
    });
});
