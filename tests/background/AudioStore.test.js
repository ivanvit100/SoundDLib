import { describe, it, expect, beforeEach } from 'vitest';
import '../../background/AudioStore.js';

describe('AudioStore', () => {
    let store;

    beforeEach(() => {
        // Always work with a fresh AudioStore instance
        store = new globalThis.audioStore.constructor();
    });

    it('audioStore создан', () => {
        expect(globalThis.audioStore).toBeDefined();
    });

    describe('put', () => {
        it('сохраняет трек и возвращает id', () => {
            const id = store.put('t1', { id: 't1', meta: { title: 'Test' }, mimeType: 'audio/mpeg', capturedAt: Date.now() });
            expect(id).toBe('t1');
        });

        it('обновляет существующий трек по id', () => {
            store.put('t1', { id: 't1', meta: { title: 'v1' }, mimeType: 'audio/mpeg', capturedAt: Date.now() });
            store.put('t1', { id: 't1', meta: { title: 'v2' }, mimeType: 'audio/mpeg', capturedAt: Date.now() });
            expect(store.get('t1').meta.title).toBe('v2');
        });

        it('дедуплицирует по url — возвращает существующий id', () => {
            store.put('t1', { id: 't1', url: 'https://example.com/audio.mp3', meta: {}, capturedAt: Date.now() });
            const id2 = store.put('t2', { id: 't2', url: 'https://example.com/audio.mp3', meta: {}, capturedAt: Date.now() });
            expect(id2).toBe('t1');
        });

        it('обновляет data при дедупликации если data отсутствовала', () => {
            store.put('t1', { id: 't1', url: 'https://example.com/a.mp3', data: null, meta: {}, capturedAt: Date.now() });
            store.put('t2', { id: 't2', url: 'https://example.com/a.mp3', data: new Uint8Array([1, 2, 3]), meta: {}, capturedAt: Date.now() });
            expect(store.get('t1').data).toBeInstanceOf(Uint8Array);
        });

        it('не обновляет data если уже есть данные', () => {
            const existing = new Uint8Array([5, 6, 7]);
            store.put('t1', { id: 't1', url: 'https://example.com/b.mp3', data: existing, meta: {}, capturedAt: Date.now() });
            store.put('t2', { id: 't2', url: 'https://example.com/b.mp3', data: new Uint8Array([8, 9]), meta: {}, capturedAt: Date.now() });
            expect(store.get('t1').data).toBe(existing);
        });

        it('вытесняет старые треки при превышении MAX_TRACKS=10', () => {
            for (let i = 0; i < 10; i++) {
                store.put(`t${i}`, { id: `t${i}`, meta: {}, mimeType: 'audio/mpeg', capturedAt: Date.now() });
            }
            store.put('t10', { id: 't10', meta: {}, mimeType: 'audio/mpeg', capturedAt: Date.now() });
            expect(store.get('t0')).toBeNull();
            expect(store.get('t10')).toBeTruthy();
        });

        it('вытесняет трек с url из urlIndex', () => {
            for (let i = 0; i < 10; i++) {
                store.put(`t${i}`, { id: `t${i}`, url: `https://example.com/${i}.mp3`, meta: {}, capturedAt: Date.now() });
            }
            store.put('t10', { id: 't10', meta: {}, capturedAt: Date.now() });
            expect(store.hasUrl('https://example.com/0.mp3')).toBe(false);
        });

        it('устанавливает latestId', () => {
            store.put('t1', { id: 't1', meta: {}, capturedAt: Date.now() });
            store.put('t2', { id: 't2', meta: {}, capturedAt: Date.now() });
            expect(store.getLatestId()).toBe('t2');
        });
    });

    describe('updateMeta', () => {
        it('обновляет метаданные трека', () => {
            store.put('t1', { id: 't1', meta: { title: 'Old' }, capturedAt: Date.now() });
            store.updateMeta('t1', { title: 'New', artist: 'Artist' });
            expect(store.get('t1').meta.title).toBe('New');
        });

        it('не падает для несуществующего трека', () => {
            expect(() => store.updateMeta('nonexistent', { title: 'x' })).not.toThrow();
        });
    });

    describe('hasUrl', () => {
        it('возвращает true для известного url', () => {
            store.put('t1', { id: 't1', url: 'https://a.com/audio.mp3', meta: {}, capturedAt: Date.now() });
            expect(store.hasUrl('https://a.com/audio.mp3')).toBe(true);
        });

        it('возвращает false для неизвестного url', () => {
            expect(store.hasUrl('https://unknown.com/audio.mp3')).toBe(false);
        });

        it('возвращает false для null/undefined', () => {
            expect(store.hasUrl(null)).toBe(false);
            expect(store.hasUrl(undefined)).toBe(false);
        });
    });

    describe('get', () => {
        it('возвращает трек по id', () => {
            store.put('t1', { id: 't1', meta: { title: 'T' }, capturedAt: Date.now() });
            expect(store.get('t1').meta.title).toBe('T');
        });

        it('возвращает null для несуществующего', () => {
            expect(store.get('nonexistent')).toBeNull();
        });
    });

    describe('getLatest / getLatestId', () => {
        it('возвращает null если нет треков', () => {
            expect(store.getLatest()).toBeNull();
            expect(store.getLatestId()).toBeNull();
        });

        it('возвращает последний трек', () => {
            store.put('t1', { id: 't1', meta: { title: 'First' }, mimeType: 'audio/mpeg', capturedAt: Date.now() });
            store.put('t2', { id: 't2', meta: { title: 'Latest' }, mimeType: 'audio/mpeg', capturedAt: Date.now() });
            expect(store.getLatest().meta.title).toBe('Latest');
            expect(store.getLatestId()).toBe('t2');
        });
    });

    describe('list', () => {
        it('возвращает список треков без data', () => {
            store.put('t1', { id: 't1', meta: { title: 'T' }, mimeType: 'audio/mpeg', capturedAt: 123 });
            const list = store.list();
            expect(list).toHaveLength(1);
            expect(list[0]).toEqual({ id: 't1', meta: { title: 'T' }, mimeType: 'audio/mpeg', capturedAt: 123 });
        });
    });

    describe('findByZvukId', () => {
        it('находит трек по zvukId в url', () => {
            store.put('t1', { id: 't1', url: 'https://cdn.zvuk.com/drm/track/12345/stream.m3u8', meta: {}, capturedAt: Date.now() });
            const found = store.findByZvukId('12345');
            expect(found).toBeTruthy();
            expect(found.id).toBe('t1');
        });

        it('находит трек по zvukId в masterUrl с подчёркиванием', () => {
            store.put('t1', { id: 't1', masterUrl: 'https://cdn.zvuk.com/drm/track/12345_2/master.m3u8', meta: {}, capturedAt: Date.now() });
            const found = store.findByZvukId('12345');
            expect(found).toBeTruthy();
        });

        it('возвращает null если не найдено', () => {
            expect(store.findByZvukId('99999')).toBeNull();
        });
    });

    describe('remove', () => {
        it('удаляет трек по id', () => {
            store.put('t1', { id: 't1', meta: {}, capturedAt: Date.now() });
            store.remove('t1');
            expect(store.get('t1')).toBeNull();
        });

        it('обновляет latestId после удаления последнего', () => {
            store.put('t1', { id: 't1', meta: {}, capturedAt: Date.now() });
            store.put('t2', { id: 't2', meta: {}, capturedAt: Date.now() });
            store.remove('t2');
            expect(store.getLatestId()).toBe('t1');
        });

        it('устанавливает latestId в null если треков нет', () => {
            store.put('t1', { id: 't1', meta: {}, capturedAt: Date.now() });
            store.remove('t1');
            expect(store.getLatestId()).toBeNull();
        });

        it('удаляет url из urlIndex', () => {
            store.put('t1', { id: 't1', url: 'https://a.com/audio.mp3', meta: {}, capturedAt: Date.now() });
            store.remove('t1');
            expect(store.hasUrl('https://a.com/audio.mp3')).toBe(false);
        });

        it('не падает для несуществующего id', () => {
            expect(() => store.remove('nonexistent')).not.toThrow();
        });
    });

    describe('clear', () => {
        it('очищает все треки', () => {
            store.put('t1', { id: 't1', meta: {}, capturedAt: Date.now() });
            store.put('t2', { id: 't2', meta: {}, capturedAt: Date.now() });
            store.clear();
            expect(store.getLatestId()).toBeNull();
            expect(store.list()).toHaveLength(0);
        });
    });
});
