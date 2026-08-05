import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { loadModule } from '../../helpers/loadModule.js';

beforeAll(() => {
    globalThis.zvukConfig = {
        name: 'zvuk',
        color: '#22c375',
        logo: 'icons/logo1.png',
        baseUrl: 'https://zvuk.com',
        apiUrl: 'https://zvuk.com/api/v1',
        graphqlUrl: 'https://zvuk.com/api/v1/graphql',
        headers: { 'Accept': 'application/json' }
    };

    globalThis.getExtensionApi = vi.fn(() => ({
        runtime: {
            sendMessage: vi.fn().mockResolvedValue({
                ok: true,
                body: JSON.stringify({ data: { playlist: { id: '1', title: 'My Playlist', tracksCount: 2, image: { src: 'http://img.com/cover_{size}.jpg' } } } })
            })
        }
    }));

    globalThis.BaseAudioService = class {
        constructor(config) {
            this.config = config;
            this.name = config.name;
            this.color = config.color || '#22c375';
            this.logo = config.logo || 'icons/logo1.png';
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

    globalThis.serviceRegistry = {
        register: vi.fn()
    };

    globalThis.ZvukHlsDownloader = class {
        download(qualityUrl, api, onProgress) {
            return Promise.resolve({ data: new ArrayBuffer(100), mimeType: 'audio/mp4' });
        }
    };

    loadModule('services/zvuk/ZvukService.js');
});

describe('ZvukService', () => {
    let service;

    beforeEach(() => {
        service = new globalThis.ZvukService();
    });

    it('ZvukService класс существует', () => {
        expect(globalThis.ZvukService).toBeDefined();
    });

    it('регистрируется в serviceRegistry', () => {
        expect(globalThis.serviceRegistry.register).toHaveBeenCalledWith(globalThis.ZvukService);
    });

    describe('static matches', () => {
        it('возвращает true для zvuk.com', () => {
            expect(globalThis.ZvukService.matches('https://zvuk.com/track/123')).toBe(true);
        });

        it('возвращает true для поддомена zvuk.com', () => {
            expect(globalThis.ZvukService.matches('https://sub.zvuk.com/track/123')).toBe(true);
        });

        it('возвращает false для других сайтов', () => {
            expect(globalThis.ZvukService.matches('https://other.com/track/123')).toBe(false);
        });

        it('возвращает false для невалидного url', () => {
            expect(globalThis.ZvukService.matches('not-a-url')).toBe(false);
        });
    });

    describe('static isPlaylistPage', () => {
        it('возвращает true для playlist url', () => {
            expect(globalThis.ZvukService.isPlaylistPage('https://zvuk.com/playlist/123')).toBe(true);
        });

        it('возвращает true для collection url', () => {
            expect(globalThis.ZvukService.isPlaylistPage('https://zvuk.com/collection/456')).toBe(true);
        });

        it('возвращает true для favorites', () => {
            expect(globalThis.ZvukService.isPlaylistPage('https://zvuk.com/favorites')).toBe(true);
        });

        it('возвращает false для track url', () => {
            expect(globalThis.ZvukService.isPlaylistPage('https://zvuk.com/track/123')).toBe(false);
        });
    });

    describe('extractPlaylistId', () => {
        it('извлекает playlist id', () => {
            expect(service.extractPlaylistId('https://zvuk.com/playlist/42')).toBe('42');
        });

        it('извлекает collection id', () => {
            expect(service.extractPlaylistId('https://zvuk.com/collection/99')).toBe('99');
        });

        it('возвращает "favorites" для favorites url', () => {
            expect(service.extractPlaylistId('https://zvuk.com/favorites')).toBe('favorites');
        });

        it('возвращает null для других url', () => {
            expect(service.extractPlaylistId('https://zvuk.com/track/123')).toBeNull();
        });
    });

    describe('extractTrackId', () => {
        it('извлекает track id', () => {
            expect(service.extractTrackId('https://zvuk.com/track/789')).toBe('789');
        });

        it('возвращает null если нет id', () => {
            expect(service.extractTrackId('https://zvuk.com/playlist/1')).toBeNull();
        });
    });

    describe('static capturePatterns', () => {
        it('содержит CDN паттерн', () => {
            expect(globalThis.ZvukService.capturePatterns).toContain('*://cdn-hls-slicer.zvuk.com/drm/track/*/master.m3u8*');
        });
    });

    describe('static captureFromUrl', () => {
        it('возвращает null для не-m3u8', () => {
            expect(globalThis.ZvukService.captureFromUrl('url', 'not-m3u8')).toBeNull();
        });

        it('возвращает null для m3u8 без STREAM-INF', () => {
            expect(globalThis.ZvukService.captureFromUrl('url', '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0')).toBeNull();
        });

        it('возвращает entry для валидного мастер плейлиста', () => {
            const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nhttps://cdn.example.com/quality.m3u8';
            const result = globalThis.ZvukService.captureFromUrl('https://cdn.example.com/master.m3u8', text);
            expect(result).toBeTruthy();
            expect(result.type).toBe('hls');
            expect(result.qualities).toHaveLength(1);
        });

        it('возвращает null если нет qualities', () => {
            const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n#comment';
            const result = globalThis.ZvukService.captureFromUrl('url', text);
            expect(result).toBeNull();
        });
    });

    describe('static parseMasterPlaylist', () => {
        it('парсирует корректный мастер плейлист', () => {
            const text = [
                '#EXTM3U',
                '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=128000,BANDWIDTH=130000,CODECS="mp4a.40.2"',
                'quality_128.m3u8',
                '#EXT-X-STREAM-INF:BANDWIDTH=320000,CODECS="fLaC"',
                'quality_320.m3u8'
            ].join('\n');
            const result = globalThis.ZvukService.parseMasterPlaylist(text, 'https://cdn.example.com/master/');
            expect(result).toHaveLength(2);
            expect(result[0].bandwidth).toBe(128000);
            expect(result[1].label).toBe('Lossless FLAC');
        });

        it('пропускает строки без URL после STREAM-INF', () => {
            const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\n#comment-not-url';
            const result = globalThis.ZvukService.parseMasterPlaylist(text, 'https://base.com/');
            expect(result).toHaveLength(0);
        });
    });

    describe('static qualityLabel', () => {
        it('возвращает "Lossless FLAC" для flac codecs', () => {
            expect(globalThis.ZvukService.qualityLabel(320000, 'flac')).toBe('Lossless FLAC');
        });

        it('возвращает LQ для низкого битрейта', () => {
            expect(globalThis.ZvukService.qualityLabel(80000, 'aac')).toBe('LQ · 80 kbps');
        });

        it('возвращает MQ для среднего битрейта', () => {
            expect(globalThis.ZvukService.qualityLabel(160000, 'aac')).toBe('MQ · 160 kbps');
        });

        it('возвращает HQ для высокого битрейта', () => {
            expect(globalThis.ZvukService.qualityLabel(320000, 'aac')).toBe('HQ · 320 kbps');
        });
    });

    describe('getAudioData', () => {
        it('скачивает HLS трек', async () => {
            const result = await service.getAudioData(
                { type: 'hls', masterUrl: 'https://cdn.example.com/master.m3u8' },
                { qualityUrl: 'https://cdn.example.com/quality.m3u8' },
                null,
                vi.fn()
            );
            expect(result).toBeDefined();
            expect(result.mimeType).toBe('audio/mp4');
        });

        it('бросает если тип не hls или нет qualityUrl', () => {
            expect(() => service.getAudioData({ type: 'audio' }, {}, null, null))
                .toThrow(/HLS trackEntry and qualityUrl required/);
        });
    });

    describe('fetchPlaylistMeta', () => {
        it('возвращает мета для favorites', async () => {
            const meta = await service.fetchPlaylistMeta('favorites');
            expect(meta.id).toBe('favorites');
            expect(meta.title).toBe('Избранное');
        });

        it('возвращает мета через GraphQL', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            data: {
                                playlist: {
                                    id: '42',
                                    title: 'My Playlist',
                                    tracksCount: 10,
                                    image: { src: 'http://img.com/cover_{size}.jpg' }
                                }
                            }
                        })
                    })
                }
            });
            const meta = await service.fetchPlaylistMeta('42');
            expect(meta.id).toBe('42');
            expect(meta.title).toBe('My Playlist');
            expect(meta.cover).toContain('large');
        });

        it('обрабатывает отсутствие данных', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({ data: { playlist: null } })
                    })
                }
            });
            const meta = await service.fetchPlaylistMeta('0');
            expect(meta.title).toBe('Плейлист');
        });
    });

    describe('fetchTrackMeta', () => {
        it('возвращает нормализованные метаданные', async () => {
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({
                        ok: true,
                        body: JSON.stringify({
                            result: {
                                id: '123',
                                title: 'Test Track',
                                artists: [{ name: 'Artist 1' }, { name: 'Artist 2' }],
                                release: { title: 'Album', image: null, id: '456' },
                                duration: 300,
                                image: 'abc123'
                            }
                        })
                    })
                }
            });
            const meta = await service.fetchTrackMeta('123');
            expect(meta.title).toBe('Test Track');
            expect(meta.artist).toBe('Artist 1, Artist 2');
        });
    });

    describe('fetchAllPlaylistTracks', () => {
        it('загружает треки с пагинацией', async () => {
            let callCount = 0;
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockImplementation(async () => {
                        callCount++;
                        if (callCount === 1) {
                            return {
                                ok: true,
                                body: JSON.stringify({
                                    data: {
                                        playlistTracks: [
                                            { id: '1', title: 'T1', artists: [{ title: 'A', image: { src: 'img_{size}.jpg' } }], release: { title: 'Rel', image: { src: 'r_{size}.jpg' } }, duration: 200 }
                                        ]
                                    }
                                })
                            };
                        }
                        return {
                            ok: true,
                            body: JSON.stringify({ data: { playlistTracks: [] } })
                        };
                    })
                }
            });

            const onProgress = vi.fn();
            const tracks = await service.fetchAllPlaylistTracks('42', onProgress);
            expect(tracks).toHaveLength(1);
            expect(tracks[0].title).toBe('T1');
            expect(onProgress).toHaveBeenCalled();
        });
    });

    describe('_fetchAllLikedTracks', () => {
        it('загружает избранные треки', async () => {
            let callCount = 0;
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockImplementation(async () => {
                        callCount++;
                        if (callCount === 1) {
                            return {
                                ok: true,
                                body: JSON.stringify({
                                    data: {
                                        paginatedCollection: {
                                            tracks: {
                                                items: [
                                                    { id: '10', title: 'Liked 1', artists: [], release: null, duration: 180 }
                                                ],
                                                page: { endCursor: null }
                                            }
                                        }
                                    }
                                })
                            };
                        }
                        return { ok: true, body: JSON.stringify({ data: {} }) };
                    })
                }
            });

            const tracks = await service.fetchAllPlaylistTracks('favorites', null);
            expect(tracks).toHaveLength(1);
        });

        it('продолжает с cursor если есть ещё треки', async () => {
            let callCount = 0;
            globalThis.getExtensionApi.mockReturnValue({
                runtime: {
                    sendMessage: vi.fn().mockImplementation(async () => {
                        callCount++;
                        if (callCount === 1) {
                            return {
                                ok: true,
                                body: JSON.stringify({
                                    data: {
                                        paginatedCollection: {
                                            tracks: {
                                                items: [{ id: '1', title: 'T1', artists: [], release: null, duration: 0 }],
                                                page: { endCursor: 'cursor123' }
                                            }
                                        }
                                    }
                                })
                            };
                        }
                        return {
                            ok: true,
                            body: JSON.stringify({
                                data: {
                                    paginatedCollection: {
                                        tracks: { items: [], page: { endCursor: null } }
                                    }
                                }
                            })
                        };
                    })
                }
            });

            const tracks = await service.fetchAllPlaylistTracks('favorites', null);
            expect(tracks).toHaveLength(1);
        });
    });

    describe('_normalizeTrackGql', () => {
        it('нормализует трек с несколькими артистами', () => {
            const service2 = new globalThis.ZvukService();
            const raw = {
                id: '1',
                title: 'Track',
                artists: [
                    { title: 'Artist A', image: { src: 'img_{size}.jpg' } },
                    { title: 'Artist B', image: null }
                ],
                release: { title: 'Album', image: { src: 'rel_{size}.jpg' } },
                duration: 240
            };
            const track = service2._normalizeTrackGql(raw);
            expect(track.artist).toBe('Artist A, Artist B');
            expect(track.album).toBe('Album');
            expect(track.cover).toContain('large');
        });

        it('нормализует трек без артистов', () => {
            const service2 = new globalThis.ZvukService();
            const raw = {
                id: '2',
                title: null,
                artists: [],
                release: null,
                duration: 0
            };
            const track = service2._normalizeTrackGql(raw);
            expect(track.title).toBe('Unknown');
            expect(track.artist).toBe('Unknown');
        });

        it('использует обложку от артиста если нет release image', () => {
            const service2 = new globalThis.ZvukService();
            const raw = {
                id: '3',
                title: 'T',
                artists: [{ title: 'A', image: { src: 'artist_{size}.jpg' } }],
                release: { title: 'R', image: null },
                duration: 100
            };
            const track = service2._normalizeTrackGql(raw);
            expect(track.cover).toContain('large');
        });
    });

    describe('_normalizeTrackRest', () => {
        it('нормализует REST ответ', () => {
            const service2 = new globalThis.ZvukService();
            const raw = {
                id: '1',
                title: 'Track',
                artist: 'Single Artist',
                release: { title: 'Album', image: null },
                duration: 180,
                stream: 'https://example.com/stream.mp3'
            };
            const track = service2._normalizeTrackRest(raw);
            expect(track.title).toBe('Track');
            expect(track.artist).toBe('Single Artist');
            expect(track.streamUrl).toBe('https://example.com/stream.mp3');
        });

        it('обрабатывает artists массив', () => {
            const service2 = new globalThis.ZvukService();
            const raw = {
                id: '2',
                title: 'T',
                artists: [{ name: 'A1' }, { name: 'A2' }],
                release: null,
                duration: 0
            };
            const track = service2._normalizeTrackRest(raw);
            expect(track.artist).toBe('A1, A2');
        });
    });

    describe('_coverUrlRest', () => {
        it('возвращает строку если image — прямая ссылка', () => {
            const service2 = new globalThis.ZvukService();
            const raw = { image: 'https://cdn.example.com/cover.jpg', id: '1' };
            expect(service2._coverUrlRest(raw)).toBe('https://cdn.example.com/cover.jpg');
        });

        it('строит URL через release image+id', () => {
            const service2 = new globalThis.ZvukService();
            const raw = {
                release: { image: 'hash123', id: '456' },
                image: null,
                id: '789'
            };
            const url = service2._coverUrlRest(raw);
            expect(url).toContain('cdn-image.zvuk.com');
            expect(url).toContain('hash123');
        });

        it('строит URL через image+id если нет release', () => {
            const service2 = new globalThis.ZvukService();
            const raw = { image: 'trackhash', id: '111', release: null };
            const url = service2._coverUrlRest(raw);
            expect(url).toContain('trackhash');
        });

        it('возвращает null если нет данных', () => {
            const service2 = new globalThis.ZvukService();
            expect(service2._coverUrlRest({})).toBeNull();
        });
    });
});
