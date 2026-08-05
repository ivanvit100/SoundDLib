import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
    globalThis.getExtensionApi = vi.fn(() => ({
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({ ok: true, body: '{"data":1}' })
        }
    }));
    globalThis.chrome = undefined;
    globalThis.browser = undefined;
});

import '../../services/BaseAudioService.js';

describe('BaseAudioService', () => {
    let service;

    beforeEach = () => {};

    it('BaseAudioService класс существует', () => {
        expect(globalThis.BaseAudioService).toBeDefined();
    });

    it('создаёт сервис с конфигом', () => {
        service = new globalThis.BaseAudioService({
            name: 'test',
            color: '#ff0000',
            logo: 'icons/test.png'
        });
        expect(service.name).toBe('test');
        expect(service.color).toBe('#ff0000');
        expect(service.logo).toBe('icons/test.png');
    });

    it('использует дефолтные значения color и logo', () => {
        service = new globalThis.BaseAudioService({ name: 'minimal' });
        expect(service.color).toBe('#22c375');
        expect(service.logo).toBe('icons/logo1.png');
    });

    describe('extensionApi getter', () => {
        it('возвращает api через getExtensionApi если доступен', () => {
            service = new globalThis.BaseAudioService({ name: 'test' });
            const api = service.extensionApi;
            expect(api).toBeTruthy();
            expect(globalThis.getExtensionApi).toHaveBeenCalled();
        });

        it('возвращает chrome если нет getExtensionApi', () => {
            const origGetApi = globalThis.getExtensionApi;
            globalThis.getExtensionApi = undefined;
            globalThis.chrome = { runtime: { sendMessage: vi.fn() } };
            service = new globalThis.BaseAudioService({ name: 'test' });
            const api = service.extensionApi;
            expect(api).toBe(globalThis.chrome);
            globalThis.getExtensionApi = origGetApi;
            globalThis.chrome = undefined;
        });
    });

    describe('статические методы', () => {
        it('matches бросает при вызове', () => {
            expect(() => globalThis.BaseAudioService.matches('https://example.com')).toThrow();
        });

        it('isPlaylistPage возвращает false по умолчанию', () => {
            expect(globalThis.BaseAudioService.isPlaylistPage('https://example.com')).toBe(false);
        });

        it('capturePatterns возвращает []', () => {
            expect(globalThis.BaseAudioService.capturePatterns).toEqual([]);
        });

        it('captureFromUrl возвращает null', () => {
            expect(globalThis.BaseAudioService.captureFromUrl('url', 'text')).toBeNull();
        });
    });

    describe('методы экземпляра', () => {
        beforeEach(() => {
            service = new globalThis.BaseAudioService({ name: 'svc', headers: { 'Accept': 'application/json' } });
        });

        it('extractPlaylistId возвращает null', () => {
            expect(service.extractPlaylistId('https://example.com/playlist/123')).toBeNull();
        });

        it('extractTrackId возвращает null', () => {
            expect(service.extractTrackId('https://example.com/track/456')).toBeNull();
        });

        it('getAudioData бросает', () => {
            expect(() => service.getAudioData({}, {}, null, null)).toThrow(/not implemented/);
        });

        it('fetchTrackMeta бросает', () => {
            expect(() => service.fetchTrackMeta('123')).toThrow(/must be implemented/);
        });

        it('fetchPlaylistMeta бросает', () => {
            expect(() => service.fetchPlaylistMeta('123')).toThrow(/must be implemented/);
        });

        it('fetchAllPlaylistTracks бросает', () => {
            expect(() => service.fetchAllPlaylistTracks('123')).toThrow(/must be implemented/);
        });

        it('delay возвращает Promise', async () => {
            await expect(service.delay(1)).resolves.toBeUndefined();
        });

        it('apiFetch делает запрос через runtime.sendMessage', async () => {
            const result = await service.apiFetch('https://api.zvuk.com/track/1');
            expect(result).toEqual({ data: 1 });
        });

        it('apiFetch бросает при ошибке', async () => {
            globalThis.getExtensionApi.mockReturnValueOnce({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: false, status: 404 })
                }
            });
            await expect(service.apiFetch('https://api.example.com')).rejects.toThrow(/API error/);
        });

        it('apiFetch бросает если response null', async () => {
            globalThis.getExtensionApi.mockReturnValueOnce({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue(null)
                }
            });
            await expect(service.apiFetch('https://api.example.com')).rejects.toThrow(/API error/);
        });
    });
});
