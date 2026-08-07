import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../core/Storage.js';

describe('Storage — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../core/Storage.js');
        vi.unstubAllGlobals();
        expect(globalThis.Storage).toBeDefined();
    });
});

describe('Storage', () => {
    let storage;

    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
        storage = new globalThis.Storage();
    });

    it('Storage класс существует', () => {
        expect(globalThis.Storage).toBeDefined();
    });

    describe('isAvailable', () => {
        it('возвращает true в jsdom', () => {
            expect(storage.isAvailable()).toBe(true);
        });

        it('возвращает false если localStorage недоступен', () => {
            const s = new globalThis.Storage();
            s._available = false;
            expect(s.isAvailable()).toBe(false);
        });

        it('конструктор обрабатывает ошибку localStorage через прототип', () => {
            const proto = Object.getPrototypeOf(localStorage);
            const orig = proto.setItem;
            proto.setItem = function() { throw new Error('unavailable'); };
            const s = new globalThis.Storage();
            proto.setItem = orig;
            expect(s.isAvailable()).toBe(false);
        });
    });

    describe('get', () => {
        it('возвращает null для несуществующего ключа', () => {
            expect(storage.get('no-such-key')).toBeNull();
        });

        it('возвращает значение существующего ключа', () => {
            localStorage.setItem('k', 'val');
            expect(storage.get('k')).toBe('val');
        });

        it('возвращает null если unavailable', () => {
            const s = new globalThis.Storage();
            s._available = false;
            expect(s.get('k')).toBeNull();
        });

        it('возвращает null при ошибке getItem', () => {
            const proto = Object.getPrototypeOf(localStorage);
            const orig = proto.getItem;
            proto.getItem = function() { throw new Error('err'); };
            const result = storage.get('k');
            proto.getItem = orig;
            expect(result).toBeNull();
        });
    });

    describe('getJSON', () => {
        it('возвращает null для несуществующего ключа', () => {
            expect(storage.getJSON('no-key')).toBeNull();
        });

        it('парсирует JSON значение', () => {
            localStorage.setItem('obj', JSON.stringify({ a: 1 }));
            expect(storage.getJSON('obj')).toEqual({ a: 1 });
        });

        it('возвращает null при невалидном JSON', () => {
            localStorage.setItem('bad', 'not-json{[');
            expect(storage.getJSON('bad')).toBeNull();
        });

        it('возвращает null если unavailable', () => {
            const s = new globalThis.Storage();
            s._available = false;
            expect(s.getJSON('k')).toBeNull();
        });
    });

    describe('set', () => {
        it('сохраняет строку', () => {
            expect(storage.set('k', 'v')).toBe(true);
            expect(localStorage.getItem('k')).toBe('v');
        });

        it('конвертирует число в строку', () => {
            storage.set('num', 42);
            expect(localStorage.getItem('num')).toBe('42');
        });

        it('возвращает false если unavailable', () => {
            const s = new globalThis.Storage();
            s._available = false;
            expect(s.set('k', 'v')).toBe(false);
        });

        it('возвращает false при ошибке setItem', () => {
            const s = new globalThis.Storage();
            const proto = Object.getPrototypeOf(localStorage);
            const origSetItem = proto.setItem;
            proto.setItem = function() { throw new Error('quota'); };
            const result = s.set('k', 'v');
            proto.setItem = origSetItem;
            expect(result).toBe(false);
        });
    });

    describe('setJSON', () => {
        it('сохраняет JSON', () => {
            expect(storage.setJSON('k', { x: 1 })).toBe(true);
            expect(JSON.parse(localStorage.getItem('k'))).toEqual({ x: 1 });
        });

        it('возвращает false если unavailable', () => {
            const s = new globalThis.Storage();
            s._available = false;
            expect(s.setJSON('k', {})).toBe(false);
        });

        it('возвращает false при ошибке', () => {
            const s = new globalThis.Storage();
            const proto = Object.getPrototypeOf(localStorage);
            const origSetItem = proto.setItem;
            proto.setItem = function() { throw new Error('err'); };
            const result = s.setJSON('k', {});
            proto.setItem = origSetItem;
            expect(result).toBe(false);
        });
    });

    describe('remove', () => {
        it('удаляет ключ', () => {
            localStorage.setItem('r', 'v');
            storage.remove('r');
            expect(localStorage.getItem('r')).toBeNull();
        });

        it('не падает при удалении несуществующего ключа', () => {
            expect(() => storage.remove('no-key')).not.toThrow();
        });

        it('не делает ничего если unavailable', () => {
            const s = new globalThis.Storage();
            s._available = false;
            expect(() => s.remove('k')).not.toThrow();
        });

        it('не падает при ошибке removeItem', () => {
            const proto = Object.getPrototypeOf(localStorage);
            const orig = proto.removeItem;
            proto.removeItem = function() { throw new Error('err'); };
            expect(() => storage.remove('k')).not.toThrow();
            proto.removeItem = orig;
        });
    });
});
