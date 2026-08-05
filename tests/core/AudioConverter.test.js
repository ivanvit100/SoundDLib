import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

const mockFFmpeg = {
    isLoaded: vi.fn(() => false),
    load: vi.fn().mockResolvedValue(undefined),
    FS: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
    setProgress: vi.fn()
};

beforeAll(() => {
    vi.stubGlobal('FFmpeg', {
        createFFmpeg: vi.fn(() => mockFFmpeg)
    });
    vi.stubGlobal('getExtensionApi', () => ({
        runtime: { getURL: vi.fn(p => `chrome-extension://abc/${p}`) }
    }));
    // eslint-disable-next-line no-undef
    globalThis.chrome = undefined;
    globalThis.browser = undefined;
});

import '../../core/AudioConverter.js';

describe('AudioConverter', () => {
    let converter;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFFmpeg.isLoaded.mockReturnValue(false);
        mockFFmpeg.load.mockResolvedValue(undefined);
        mockFFmpeg.run.mockResolvedValue(undefined);
        mockFFmpeg.FS.mockReset();
        converter = new globalThis.AudioConverter();
    });

    it('AudioConverter класс существует', () => {
        expect(globalThis.AudioConverter).toBeDefined();
    });

    describe('_validateInput', () => {
        it('бросает при слишком маленьком буфере', () => {
            const small = new ArrayBuffer(100);
            expect(() => converter._validateInput(small)).toThrow();
        });

        it('бросает при null буфере', () => {
            expect(() => converter._validateInput(null)).toThrow();
        });

        it('бросает если первый байт 0x3C (HTML)', () => {
            const buf = new ArrayBuffer(5000);
            const view = new Uint8Array(buf);
            view[0] = 0x3C; // '<'
            expect(() => converter._validateInput(buf)).toThrow(/HTML/);
        });

        it('возвращает Uint8Array для корректных данных', () => {
            const buf = new ArrayBuffer(5000);
            const bytes = converter._validateInput(buf);
            expect(bytes).toBeInstanceOf(Uint8Array);
        });
    });

    describe('convert', () => {
        it('выбрасывает для неподдерживаемого формата', async () => {
            const buf = new ArrayBuffer(5000);
            await expect(converter.convert(buf, 'audio/mpeg', 'xyz', () => {}))
                .rejects.toThrow(/Unsupported/);
        });

        it('возвращает inputBuffer для m4a → aac пассивного пути', async () => {
            const buf = new ArrayBuffer(5000);
            const result = await converter.convert(buf, 'audio/mp4', 'aac', () => {});
            expect(result).toBe(buf);
        });

        it('вызывает onProgress(100) при m4a passthrough', async () => {
            const buf = new ArrayBuffer(5000);
            const onProgress = vi.fn();
            await converter.convert(buf, 'audio/mp4', 'aac', onProgress);
            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it('конвертирует аудио для mp3', async () => {
            const outputData = new Uint8Array(1000);
            outputData.buffer;
            mockFFmpeg.isLoaded.mockReturnValue(false);
            mockFFmpeg.load.mockResolvedValue(undefined);
            mockFFmpeg.FS.mockImplementation((op, name, data) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const buf = new ArrayBuffer(5000);
            const onProgress = vi.fn();
            const result = await converter.convert(buf, 'audio/mpeg', 'mp3', onProgress);
            expect(result).toBeDefined();
        });

        it('вызывает setProgress если предоставлен onProgress', async () => {
            mockFFmpeg.isLoaded.mockReturnValue(true);
            mockFFmpeg.FS.mockImplementation((op) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const buf = new ArrayBuffer(5000);
            const onProgress = vi.fn();
            await converter.convert(buf, 'audio/mpeg', 'mp3', onProgress);
            expect(mockFFmpeg.setProgress).toHaveBeenCalled();
        });

        it('все форматы поддерживаются: flac, ogg, opus, wav, aac (не m4a)', async () => {
            mockFFmpeg.isLoaded.mockReturnValue(true);
            mockFFmpeg.FS.mockImplementation((op) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const buf = new ArrayBuffer(5000);
            for (const fmt of ['flac', 'ogg', 'opus', 'wav']) {
                await expect(converter.convert(buf, 'audio/mpeg', fmt, () => {})).resolves.toBeDefined();
            }
        });

        it('maпит mime типы на расширения', async () => {
            mockFFmpeg.isLoaded.mockReturnValue(true);
            mockFFmpeg.FS.mockImplementation((op, name) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const mimeMap = [
                ['audio/flac', 'mp3'],
                ['audio/ogg', 'mp3'],
                ['audio/opus', 'mp3'],
                ['audio/wav', 'mp3'],
                ['audio/wave', 'mp3'],
                ['audio/aac', 'mp3'],
                ['audio/mp3', 'mp3'],
                ['audio/x-m4a', 'mp3'],
                ['unknown/type', 'mp3']
            ];
            for (const [mimeType, format] of mimeMap) {
                const buf = new ArrayBuffer(5000);
                await expect(converter.convert(buf, mimeType, format, () => {})).resolves.toBeDefined();
            }
        });

        it('обрабатывает ExitStatus ошибку с status 0', async () => {
            mockFFmpeg.isLoaded.mockReturnValue(true);
            const exitError = new Error('exit');
            exitError.name = 'ExitStatus';
            exitError.status = 0;
            mockFFmpeg.run.mockRejectedValue(exitError);
            mockFFmpeg.FS.mockImplementation((op) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const buf = new ArrayBuffer(5000);
            const result = await converter.convert(buf, 'audio/mpeg', 'mp3', () => {});
            expect(result).toBeDefined();
            expect(converter._needsRecreation).toBe(true);
        });

        it('пробрасывает не-ExitStatus ошибки', async () => {
            mockFFmpeg.isLoaded.mockReturnValue(true);
            mockFFmpeg.run.mockRejectedValue(new Error('fatal'));
            const buf = new ArrayBuffer(5000);
            await expect(converter.convert(buf, 'audio/mpeg', 'mp3', () => {})).rejects.toThrow('fatal');
        });

        it('пересоздаёт ffmpeg если _needsRecreation', async () => {
            converter._needsRecreation = true;
            converter._ffmpeg = mockFFmpeg;
            converter._loadPromise = null;
            mockFFmpeg.isLoaded.mockReturnValue(false);
            mockFFmpeg.FS.mockImplementation((op) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const buf = new ArrayBuffer(5000);
            await converter.convert(buf, 'audio/mpeg', 'mp3', () => {});
            expect(globalThis.FFmpeg.createFFmpeg).toHaveBeenCalled();
        });

        it('бросает если FFmpeg не загружен и нет globalThis.FFmpeg', async () => {
            const origFFmpeg = globalThis.FFmpeg;
            globalThis.FFmpeg = undefined;
            const conv2 = new globalThis.AudioConverter();
            const buf = new ArrayBuffer(5000);
            await expect(conv2.convert(buf, 'audio/mpeg', 'mp3', () => {})).rejects.toThrow(/FFmpeg library/);
            globalThis.FFmpeg = origFFmpeg;
        });

        it('использует существующий _loadPromise', async () => {
            let resolveLoad;
            const loadPromise = new Promise(r => { resolveLoad = r; });
            converter._ffmpeg = mockFFmpeg;
            converter._loadPromise = loadPromise;
            mockFFmpeg.isLoaded.mockReturnValue(false);
            mockFFmpeg.FS.mockImplementation((op) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const buf = new ArrayBuffer(5000);
            resolveLoad();
            const result = await converter.convert(buf, 'audio/mpeg', 'mp3', () => {});
            expect(result).toBeDefined();
        });

        it('вызывает unlink для in и out файлов', async () => {
            mockFFmpeg.isLoaded.mockReturnValue(true);
            mockFFmpeg.FS.mockImplementation((op) => {
                if (op === 'readFile') return new Uint8Array(100);
            });
            const buf = new ArrayBuffer(5000);
            await converter.convert(buf, 'audio/mpeg', 'mp3', () => {});
            const unlinkCalls = mockFFmpeg.FS.mock.calls.filter(c => c[0] === 'unlink');
            expect(unlinkCalls.length).toBeGreaterThanOrEqual(2);
        });
    });
});
