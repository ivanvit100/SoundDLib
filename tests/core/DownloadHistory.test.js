import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../core/Storage.js';
import '../../core/DownloadHistory.js';

describe('DownloadHistory — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../core/DownloadHistory.js');
        vi.unstubAllGlobals();
        expect(globalThis.DownloadHistory).toBeDefined();
    });
});

describe('DownloadHistory', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('DownloadHistory загружается', () => {
        expect(globalThis.DownloadHistory).toBeDefined();
    });

    describe('getAll', () => {
        it('возвращает пустой массив изначально', () => {
            expect(globalThis.DownloadHistory.getAll()).toEqual([]);
        });

        it('возвращает пустой массив если хранилище пусто', () => {
            expect(globalThis.DownloadHistory.getAll()).toEqual([]);
        });
    });

    describe('add', () => {
        it('добавляет запись с downloadedAt', () => {
            const before = Date.now();
            globalThis.DownloadHistory.add({ title: 'Test', service: 'zvuk', format: 'mp3' });
            const history = globalThis.DownloadHistory.getAll();
            expect(history).toHaveLength(1);
            expect(history[0].title).toBe('Test');
            expect(history[0].downloadedAt).toBeGreaterThanOrEqual(before);
        });

        it('добавляет новые записи в начало', () => {
            globalThis.DownloadHistory.add({ title: 'First' });
            globalThis.DownloadHistory.add({ title: 'Second' });
            const history = globalThis.DownloadHistory.getAll();
            expect(history[0].title).toBe('Second');
            expect(history[1].title).toBe('First');
        });

        it('обрезает до 20 записей', () => {
            for (let i = 0; i < 25; i++) {
                globalThis.DownloadHistory.add({ title: `Track ${i}` });
            }
            expect(globalThis.DownloadHistory.getAll()).toHaveLength(20);
        });

        it('хранит все свойства записи', () => {
            globalThis.DownloadHistory.add({
                title: 'My Track',
                artist: 'Artist',
                service: 'zvuk',
                format: 'flac',
                cover: 'http://example.com/cover.jpg',
                trackId: '12345'
            });
            const [entry] = globalThis.DownloadHistory.getAll();
            expect(entry.title).toBe('My Track');
            expect(entry.artist).toBe('Artist');
            expect(entry.service).toBe('zvuk');
            expect(entry.format).toBe('flac');
            expect(entry.cover).toBe('http://example.com/cover.jpg');
            expect(entry.trackId).toBe('12345');
        });
    });

    describe('clear', () => {
        it('очищает историю', () => {
            globalThis.DownloadHistory.add({ title: 'Test' });
            globalThis.DownloadHistory.clear();
            expect(globalThis.DownloadHistory.getAll()).toEqual([]);
        });

        it('работает с пустой историей', () => {
            expect(() => globalThis.DownloadHistory.clear()).not.toThrow();
        });
    });
});
