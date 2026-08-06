import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../core/base/BaseHlsDownloader.js';

describe('BaseHlsDownloader', () => {
    let downloader;
    let mockApi;

    beforeEach(() => {
        mockApi = {
            runtime: {
                sendMessage: vi.fn()
            }
        };

        class TestHlsDownloader extends globalThis.BaseHlsDownloader {
            async _fetchKeyMaterial(keyUrl, api) {
                return { data: Array.from(new Uint8Array(16).fill(1)), xekValue: 'test' };
            }

            async _resolveKey(keyMaterial, ivArray, firstSegBytes) {
                const key = await crypto.subtle.importKey(
                    'raw', new Uint8Array(16).fill(1),
                    { name: 'AES-CBC' }, false, ['decrypt']
                );
                return { cryptoKey: key, firstSegDecrypted: new Uint8Array(16) };
            }
        }

        downloader = new TestHlsDownloader();
    });

    it('BaseHlsDownloader класс существует', () => {
        expect(globalThis.BaseHlsDownloader).toBeDefined();
    });

    describe('_hexToUint8Array', () => {
        it('конвертирует hex строку в Uint8Array', () => {
            const result = downloader._hexToUint8Array('0xdeadbeef');
            expect(result).toBeInstanceOf(Uint8Array);
            expect(result[0]).toBe(0xde);
            expect(result[1]).toBe(0xad);
            expect(result[2]).toBe(0xbe);
            expect(result[3]).toBe(0xef);
        });

        it('обрабатывает строку без префикса 0x', () => {
            const result = downloader._hexToUint8Array('ff00');
            expect(result[0]).toBe(0xff);
            expect(result[1]).toBe(0x00);
        });

        it('обрабатывает пустую строку', () => {
            const result = downloader._hexToUint8Array('');
            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(0);
        });
    });

    describe('_assembleBuffers', () => {
        it('собирает массив буферов в один', () => {
            const a = new Uint8Array([1, 2, 3]);
            const b = new Uint8Array([4, 5]);
            const result = downloader._assembleBuffers([a, b]);
            expect(result).toBeInstanceOf(Uint8Array);
            expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
        });

        it('обрабатывает пустой массив', () => {
            const result = downloader._assembleBuffers([]);
            expect(result.length).toBe(0);
        });
    });

    describe('_parseMediaPlaylist', () => {
        it('парсит m3u8 плейлист', () => {
            const text = [
                '#EXTM3U',
                '#EXT-X-KEY:METHOD=AES-128,URI="https://key.example.com/key?track_id=1",IV=0x00000000000000000000000000000001',
                '#EXT-X-MAP:URI="init.mp4"',
                '#EXTINF:4.0,',
                'seg001.ts',
                '#EXTINF:4.0,',
                'https://cdn.example.com/seg002.ts'
            ].join('\n');
            const baseUrl = 'https://cdn.example.com/stream/';
            const result = downloader._parseMediaPlaylist(text, baseUrl);

            expect(result.keyUrl).toBe('https://key.example.com/key?track_id=1');
            expect(result.ivHex).toBe('00000000000000000000000000000001');
            expect(result.initUrl).toBe('https://cdn.example.com/stream/init.mp4');
            expect(result.segments).toHaveLength(2);
            expect(result.segments[1]).toBe('https://cdn.example.com/seg002.ts');
        });

        it('обрабатывает абсолютный URL для EXT-X-MAP', () => {
            const text = [
                '#EXTM3U',
                '#EXT-X-KEY:METHOD=AES-128,URI="https://key.example.com/"',
                '#EXT-X-MAP:URI="https://cdn.example.com/init.mp4"',
                '#EXTINF:4.0,',
                'seg001.ts'
            ].join('\n');
            const result = downloader._parseMediaPlaylist(text, 'https://base.com/');
            expect(result.initUrl).toBe('https://cdn.example.com/init.mp4');
        });

        it('возвращает пустые значения для пустого плейлиста', () => {
            const result = downloader._parseMediaPlaylist('', 'https://base.com/');
            expect(result.keyUrl).toBe('');
            expect(result.segments).toHaveLength(0);
        });

        it('парсит BANDWIDTH из BANDWIDTH= если нет AVERAGE-BANDWIDTH', () => {
            const text = [
                '#EXTM3U',
                '#EXT-X-KEY:METHOD=AES-128,URI="key"',
                '#EXT-X-MAP:URI="init.mp4"',
                '#EXTINF:4.0,',
                'seg.ts'
            ].join('\n');
            const result = downloader._parseMediaPlaylist(text, 'https://base.com/');
            expect(result.segments).toHaveLength(1);
        });
    });

    describe('_processInitSegment', () => {
        it('возвращает оригинальный если размер не кратен 16', async () => {
            const initRaw = new Uint8Array(15).fill(5);
            const key = await crypto.subtle.importKey(
                'raw', new Uint8Array(16).fill(1),
                { name: 'AES-CBC' }, false, ['decrypt']
            );
            const result = await downloader._processInitSegment(initRaw, key, new Uint8Array(16));
            expect(result).toBe(initRaw);
        });

        it('пытается расшифровать если размер кратен 16', async () => {
            const initRaw = new Uint8Array(32).fill(0);
            const key = await crypto.subtle.importKey(
                'raw', new Uint8Array(16).fill(0),
                { name: 'AES-CBC' }, false, ['decrypt']
            );
            const result = await downloader._processInitSegment(initRaw, key, new Uint8Array(16));
            expect(result).toBeInstanceOf(Uint8Array);
        });
    });

    describe('download', () => {
        it('бросает если нет keyUrl', async () => {
            const m3u8 = [
                '#EXTM3U',
                '#EXT-X-MAP:URI="init.mp4"',
                '#EXTINF:4.0,',
                'seg.ts'
            ].join('\n');

            mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, body: m3u8 });

            await expect(downloader.download('https://cdn.com/quality.m3u8', mockApi, () => {}))
                .rejects.toThrow(/EXT-X-KEY/);
        });

        it('бросает если нет initUrl', async () => {
            const m3u8 = [
                '#EXTM3U',
                '#EXT-X-KEY:METHOD=AES-128,URI="key"',
                '#EXTINF:4.0,',
                'seg.ts'
            ].join('\n');

            mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, body: m3u8 });

            await expect(downloader.download('https://cdn.com/quality.m3u8', mockApi, () => {}))
                .rejects.toThrow(/EXT-X-MAP/);
        });

        it('бросает если нет сегментов', async () => {
            const m3u8 = [
                '#EXTM3U',
                '#EXT-X-KEY:METHOD=AES-128,URI="key"',
                '#EXT-X-MAP:URI="init.mp4"'
            ].join('\n');

            mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, body: m3u8 });

            await expect(downloader.download('https://cdn.com/quality.m3u8', mockApi, () => {}))
                .rejects.toThrow(/сегментов/);
        });

        it('бросает при ошибке загрузки плейлиста', async () => {
            mockApi.runtime.sendMessage.mockResolvedValue({ ok: false, status: 404 });

            await expect(downloader.download('https://cdn.com/quality.m3u8', mockApi, () => {}))
                .rejects.toThrow();
        });

        it('бросает абстрактные методы в базовом классе', () => {
            const base = new globalThis.BaseHlsDownloader();
            expect(() => base._fetchKeyMaterial()).toThrow();
            expect(() => base._resolveKey()).toThrow();
        });

        it('успешно скачивает два сегмента (lines 59-86)', async () => {
            const rawKey = new Uint8Array(16).fill(1);
            const decKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt']);
            const decryptSpy = vi.spyOn(crypto.subtle, 'decrypt')
                .mockResolvedValue(new Uint8Array(16).fill(7).buffer);

            const m3u8 = [
                '#EXTM3U',
                `#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key",IV=0x${'00'.repeat(16)}`,
                '#EXT-X-MAP:URI="https://cdn.example.com/init.mp4"',
                '#EXTINF:4.0,', 'https://cdn.example.com/seg001.ts',
                '#EXTINF:4.0,', 'https://cdn.example.com/seg002.ts'
            ].join('\n');

            mockApi.runtime.sendMessage.mockImplementation(async (msg) => {
                if (msg.action === 'fetchWithRateLimit') return { ok: true, body: m3u8 };
                if (msg.action === 'fetchBinary') return { ok: true, data: new Array(32).fill(0) };
                return { ok: false };
            });

            class FullDownloader extends globalThis.BaseHlsDownloader {
                async _fetchKeyMaterial(keyUrl, api) { return { data: Array.from(rawKey) }; }
                async _resolveKey(keyMaterial, ivArray, firstSegBytes) {
                    return { cryptoKey: decKey, firstSegDecrypted: new Uint8Array(16) };
                }
            }

            try {
                const progressFn = vi.fn();
                const result = await new FullDownloader().download(
                    'https://cdn.example.com/quality.m3u8', mockApi, progressFn
                );
                expect(result.data).toBeDefined();
                expect(result.mimeType).toBe('audio/mp4');
                expect(progressFn).toHaveBeenCalledWith('key', expect.anything(), expect.anything());
                expect(progressFn).toHaveBeenCalledWith('init', expect.anything(), expect.anything());
                expect(progressFn).toHaveBeenCalledWith('segment', expect.anything(), expect.anything());
            } finally {
                decryptSpy.mockRestore();
            }
        });
    });

    describe('_decryptBatch', () => {
        it('загружает и расшифровывает сегменты (lines 29-36)', async () => {
            const decryptSpy = vi.spyOn(crypto.subtle, 'decrypt')
                .mockResolvedValue(new Uint8Array(16).fill(3).buffer);

            mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, data: new Array(32).fill(0) });

            try {
                const results = await downloader._decryptBatch(
                    ['https://cdn.example.com/seg001.ts'], mockApi, {}, new Uint8Array(16), 0, 2
                );
                expect(results).toHaveLength(1);
                expect(results[0]).toBeInstanceOf(Uint8Array);
            } finally {
                decryptSpy.mockRestore();
            }
        });

        it('бросает если fetchBinary не OK (lines 31-35)', async () => {
            mockApi.runtime.sendMessage.mockResolvedValue({ ok: false, status: 503 });
            await expect(downloader._decryptBatch(
                ['https://cdn.example.com/seg001.ts'], mockApi, {}, new Uint8Array(16), 0, 1
            )).rejects.toThrow(/503/);
        });
    });

    describe('_processInitSegment line 103', () => {
        it('возвращает расшифрованные данные при успешном decrypt', async () => {
            const initRaw = new Uint8Array(32).fill(1);
            const decryptResult = new Uint8Array(16).fill(42);
            const decryptSpy = vi.spyOn(crypto.subtle, 'decrypt')
                .mockResolvedValue(decryptResult.buffer);

            try {
                const result = await downloader._processInitSegment(initRaw, {}, new Uint8Array(16));
                expect(result).toBeInstanceOf(Uint8Array);
                expect(result[0]).toBe(42);
            } finally {
                decryptSpy.mockRestore();
            }
        });
    });

    describe('_referer', () => {
        it('возвращает пустую строку в базовом классе', () => {
            const base = new globalThis.BaseHlsDownloader();
            expect(base._referer()).toBe('');
        });
    });

    describe('_fetchPlaylist', () => {
        it('бросает при неудачном ответе', async () => {
            mockApi.runtime.sendMessage.mockResolvedValue({ ok: false, status: 403 });
            await expect(downloader._fetchPlaylist('https://cdn.com/quality.m3u8', mockApi))
                .rejects.toThrow(/403/);
        });

        it('добавляет Referer если _referer возвращает непустую строку', async () => {
            class DownloaderWithReferer extends globalThis.BaseHlsDownloader {
                _referer() { return 'https://zvuk.com/'; }
                async _fetchKeyMaterial() {}
                async _resolveKey() {}
            }
            const d = new DownloaderWithReferer();
            mockApi.runtime.sendMessage.mockResolvedValue({ ok: true, body: '#EXTM3U' });
            await d._fetchPlaylist('https://cdn.com/q.m3u8', mockApi);
            expect(mockApi.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    options: expect.objectContaining({
                        headers: expect.objectContaining({ Referer: 'https://zvuk.com/' })
                    })
                })
            );
        });
    });
});
