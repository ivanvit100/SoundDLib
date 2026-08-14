import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(async () => {
    globalThis.yandexConfig = {
        name: 'yandex',
        color: '#FC3F1D',
        logo: 'icons/logo2.png',
        baseUrl: 'https://music.yandex.ru',
        apiUrl: 'https://music.yandex.ru',
        headers: {
            'Referer': 'https://music.yandex.ru/',
            'Accept': 'application/json',
            'X-Retpath-Y': 'https://music.yandex.ru'
        }
    };

    globalThis.getExtensionApi = vi.fn(() => ({
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({
                ok: true,
                body: JSON.stringify({})
            })
        }
    }));

    globalThis.BaseAudioService = class {
        constructor(config) {
            this.config = config;
            this.name = config.name;
            this.color = config.color || '#FC3F1D';
            this.logo = config.logo || 'icons/logo2.png';
        }
        get extensionApi() {
            return typeof globalThis.getExtensionApi === 'function' ? globalThis.getExtensionApi() : null;
        }
        async apiFetch(url, options = {}) {
            const opts = {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                ...options,
                headers: { ...this.config.headers, ...(options.headers || {}) }
            };
            const response = await this.extensionApi.runtime.sendMessage({
                action: 'fetchWithRateLimit',
                url,
                options: opts
            });
            if (!response?.ok) throw new Error(`API error ${response?.status}: ${url}`);
            return JSON.parse(response.body);
        }
        delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    };

    globalThis.serviceRegistry = { register: vi.fn() };

    vi.resetModules();
    await import('../../../services/yandex/YandexService.js');
});

describe('YandexService — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../../services/yandex/YandexService.js');
        vi.unstubAllGlobals();
        expect(globalThis.YandexService).toBeDefined();
    });
});

describe('YandexService', () => {
    let service;

    beforeEach(() => {
        service = new globalThis.YandexService();
    });

    describe('static matches()', () => {
        it('принимает music.yandex.ru', () => {
            expect(globalThis.YandexService.matches('https://music.yandex.ru/album/1')).toBe(true);
        });
        it('принимает music.yandex.com', () => {
            expect(globalThis.YandexService.matches('https://music.yandex.com/album/1')).toBe(true);
        });
        it('принимает music.yandex.by', () => {
            expect(globalThis.YandexService.matches('https://music.yandex.by/album/1')).toBe(true);
        });
        it('отклоняет zvuk.com', () => {
            expect(globalThis.YandexService.matches('https://zvuk.com/track/1')).toBe(false);
        });
        it('отклоняет yandex.ru (без music.)', () => {
            expect(globalThis.YandexService.matches('https://yandex.ru')).toBe(false);
        });
        it('отклоняет невалидный URL', () => {
            expect(globalThis.YandexService.matches('not-a-url')).toBe(false);
        });
    });

    describe('static isPlaylistPage()', () => {
        it('album страница — плейлист', () => {
            expect(globalThis.YandexService.isPlaylistPage('https://music.yandex.ru/album/12345')).toBe(true);
        });
        it('пользовательский плейлист — плейлист', () => {
            expect(globalThis.YandexService.isPlaylistPage('https://music.yandex.ru/users/user123/playlists/1001')).toBe(true);
        });
        it('страница исполнителя — плейлист', () => {
            expect(globalThis.YandexService.isPlaylistPage('https://music.yandex.ru/artist/9999')).toBe(true);
        });
        it('страница трека — не плейлист', () => {
            expect(globalThis.YandexService.isPlaylistPage('https://music.yandex.ru/album/12345/track/67890')).toBe(false);
        });
        it('главная страница — не плейлист', () => {
            expect(globalThis.YandexService.isPlaylistPage('https://music.yandex.ru/')).toBe(false);
        });
    });

    describe('extractPlaylistId()', () => {
        it('возвращает album:id для альбома', () => {
            expect(service.extractPlaylistId('https://music.yandex.ru/album/12345')).toBe('album:12345');
        });
        it('возвращает playlist:owner:kind для плейлиста', () => {
            expect(service.extractPlaylistId('https://music.yandex.ru/users/user123/playlists/1001')).toBe('playlist:user123:1001');
        });
        it('возвращает artist:id для исполнителя', () => {
            expect(service.extractPlaylistId('https://music.yandex.ru/artist/9999')).toBe('artist:9999');
        });
        it('возвращает null для неизвестного URL', () => {
            expect(service.extractPlaylistId('https://music.yandex.ru/')).toBeNull();
        });
    });

    describe('extractTrackId()', () => {
        it('возвращает trackId из URL трека', () => {
            expect(service.extractTrackId('https://music.yandex.ru/album/12345/track/67890')).toBe('67890');
        });
        it('возвращает null если трек не в URL', () => {
            expect(service.extractTrackId('https://music.yandex.ru/album/12345')).toBeNull();
        });
    });

    describe('capturePatterns', () => {
        it('пустой массив (перехват через content script)', () => {
            expect(globalThis.YandexService.capturePatterns).toHaveLength(0);
        });
        it('captureFromUrl возвращает null', () => {
            expect(globalThis.YandexService.captureFromUrl('https://music.yandex.ru', '')).toBeNull();
        });
    });

    describe('_normalizeTrack()', () => {
        it('нормализует трек с массивом artists', () => {
            const raw = {
                id: '100',
                title: 'Test Song',
                artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
                albums: [{ title: 'Test Album', coverUri: 'avatars.yandex.net/cover/%%' }],
                durationMs: 180000
            };
            const track = service._normalizeTrack(raw);
            expect(track.id).toBe('100');
            expect(track.title).toBe('Test Song');
            expect(track.artist).toBe('Artist A, Artist B');
            expect(track.album).toBe('Test Album');
            expect(track.duration).toBe(180);
            expect(track.cover).toBe('https://avatars.yandex.net/cover/400x400');
            expect(track.streamUrl).toBeNull();
        });

        it('использует coverUri если есть', () => {
            const raw = {
                id: '1',
                title: 'T',
                artists: [],
                coverUri: 'cover.yandex.net/%%',
                durationMs: 0
            };
            const track = service._normalizeTrack(raw);
            expect(track.cover).toBe('https://cover.yandex.net/400x400');
        });

        it('возвращает null если raw === null', () => {
            expect(service._normalizeTrack(null)).toBeNull();
        });

        it('fallback для отсутствующих полей', () => {
            const track = service._normalizeTrack({ id: '42' });
            expect(track.title).toBe('Unknown');
            expect(track.artist).toBe('Unknown');
            expect(track.duration).toBe(0);
            expect(track.cover).toBeNull();
        });
    });

    describe('fetchPlaylistMeta() — album', () => {
        it('возвращает мета альбома', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            title: 'My Album',
                            trackCount: 10,
                            coverUri: 'avatars.mds.yandex.net/%%'
                        })
                    })
                }
            });
            const meta = await service.fetchPlaylistMeta('album:555');
            expect(meta.title).toBe('My Album');
            expect(meta.trackCount).toBe(10);
            expect(meta.cover).toBe('https://avatars.mds.yandex.net/400x400');
        });
    });

    describe('fetchPlaylistMeta() — playlist', () => {
        it('возвращает мета плейлиста', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            playlist: {
                                title: 'Cool Playlist',
                                trackCount: 5,
                                ogImage: 'avatars.net/pl/%%'
                            }
                        })
                    })
                }
            });
            const meta = await service.fetchPlaylistMeta('playlist:user1:42');
            expect(meta.title).toBe('Cool Playlist');
            expect(meta.trackCount).toBe(5);
        });
    });

    describe('fetchPlaylistMeta() — artist', () => {
        it('возвращает мета исполнителя', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            artist: { name: 'Test Artist', ogImage: 'img.net/%%' }
                        })
                    })
                }
            });
            const meta = await service.fetchPlaylistMeta('artist:7');
            expect(meta.title).toBe('Test Artist');
            expect(meta.trackCount).toBeNull();
        });
    });

    describe('fetchPlaylistMeta() — fallbacks', () => {
        it('неизвестный тип возвращает базовый объект', async () => {
            const meta = await service.fetchPlaylistMeta('unknown:1');
            expect(meta.title).toBe('Плейлист');
        });
    });

    describe('fetchAllPlaylistTracks() — album', () => {
        it('возвращает треки из volumes', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            volumes: [[
                                { id: '1', title: 'T1', artists: [{ name: 'A' }], durationMs: 3000 },
                                { id: '2', title: 'T2', artists: [], durationMs: 0 }
                            ]]
                        })
                    })
                }
            });
            const tracks = await service.fetchAllPlaylistTracks('album:1', null);
            expect(tracks).toHaveLength(2);
            expect(tracks[0].title).toBe('T1');
        });

        it('пустые volumes возвращают пустой массив', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({ volumes: [] })
                    })
                }
            });
            const tracks = await service.fetchAllPlaylistTracks('album:1', null);
            expect(tracks).toHaveLength(0);
        });
    });

    describe('fetchAllPlaylistTracks() — playlist', () => {
        it('возвращает треки из playlist.tracks', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            playlist: {
                                tracks: [
                                    { track: { id: '10', title: 'Song', artists: [], durationMs: 200000 } }
                                ]
                            }
                        })
                    })
                }
            });
            const tracks = await service.fetchAllPlaylistTracks('playlist:u:1', null);
            expect(tracks).toHaveLength(1);
            expect(tracks[0].title).toBe('Song');
        });

        it('onProgress вызывается', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            playlist: { tracks: [{ track: { id: '1', title: 'T', artists: [], durationMs: 0 } }] }
                        })
                    })
                }
            });
            const onProgress = vi.fn();
            await service.fetchAllPlaylistTracks('playlist:u:1', onProgress);
            expect(onProgress).toHaveBeenCalled();
        });
    });

    describe('fetchAllPlaylistTracks() — неизвестный тип', () => {
        it('возвращает пустой массив', async () => {
            const tracks = await service.fetchAllPlaylistTracks('unknown:1', null);
            expect(tracks).toHaveLength(0);
        });
    });

    describe('getAudioData()', () => {
        it('скачивает трек по url', async () => {
            const mockApi = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        data: [1, 2, 3],
                        mimeType: 'audio/mpeg'
                    })
                }
            };
            const result = await service.getAudioData({ url: 'https://cdn/track.mp3' }, {}, mockApi, null);
            expect(mockApi.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'fetchAudioTrack', url: 'https://cdn/track.mp3' })
            );
            expect(result.mimeType).toBe('audio/mpeg');
        });

        it('выбрасывает ошибку если нет URL', () => {
            expect(() => service.getAudioData({}, {}, {}, null)).toThrow();
        });
    });

    describe('getTrackBuffer()', () => {
        it('запрашивает resolveYandexStreamUrl и скачивает', async () => {
            const mockApi = {
                runtime: {
                    sendMessage: vi.fn()
                        .mockResolvedValueOnce({ ok: true, url: 'https://cdn/mp3' })
                        .mockResolvedValueOnce({ ok: true, data: [1, 2, 3], mimeType: 'audio/mpeg' })
                }
            };
            const result = await service.getTrackBuffer({ id: '42' }, mockApi, null);
            expect(mockApi.runtime.sendMessage).toHaveBeenNthCalledWith(1,
                expect.objectContaining({ action: 'resolveYandexStreamUrl', trackId: '42' })
            );
            expect(result.mimeType).toBe('audio/mpeg');
        });

        it('выбрасывает ошибку если resolveYandexStreamUrl не ok', async () => {
            const mockApi = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'no tab' })
                }
            };
            await expect(service.getTrackBuffer({ id: '1' }, mockApi, null)).rejects.toThrow('no tab');
        });
    });
});
