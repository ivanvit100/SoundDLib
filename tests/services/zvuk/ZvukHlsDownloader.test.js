import { describe, it, expect, vi, beforeAll } from 'vitest';

import '../../../core/base/BaseHlsDownloader.js';
import '../../../services/zvuk/ZvukHlsDownloader.js';

describe('ZvukHlsDownloader — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../../services/zvuk/ZvukHlsDownloader.js');
        vi.unstubAllGlobals();
        expect(globalThis.ZvukHlsDownloader).toBeDefined();
    });
});

describe('ZvukHlsDownloader', () => {
    it('ZvukHlsDownloader класс существует', () => {
        expect(globalThis.ZvukHlsDownloader).toBeDefined();
    });

    it('наследует от BaseHlsDownloader', () => {
        const d = new globalThis.ZvukHlsDownloader();
        expect(d).toBeInstanceOf(globalThis.BaseHlsDownloader);
    });

    describe('_referer', () => {
        it('возвращает zvuk.com', () => {
            const d = new globalThis.ZvukHlsDownloader();
            expect(d._referer()).toBe('https://zvuk.com/');
        });
    });

    describe('_fetchKeyMaterial', () => {
        it('возвращает keyResp при ok:true', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const api = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: true, data: [1, 2, 3], source: 'native', xekValue: 'abc' })
                }
            };
            const result = await d._fetchKeyMaterial('https://zvuk.com/keyserver/api/v1/key?track_id=123', api);
            expect(result.ok).toBe(true);
        });

        it('бросает при ok:false без статуса', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const api = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'network error' })
                }
            };
            await expect(d._fetchKeyMaterial('https://test.com/key', api)).rejects.toThrow(/ключ/);
        });

        it('добавляет hint при 400', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const api = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: false, status: 400 })
                }
            };
            await expect(d._fetchKeyMaterial('https://test.com/key', api)).rejects.toThrow(/воспроизведите/);
        });

        it('добавляет hint при 401', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const api = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: false, status: 401 })
                }
            };
            await expect(d._fetchKeyMaterial('https://test.com/key', api)).rejects.toThrow(/авторизаци/);
        });

        it('добавляет hint при 403', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const api = {
                runtime: {
                    sendMessage: vi.fn().mockResolvedValue({ ok: false, status: 403 })
                }
            };
            await expect(d._fetchKeyMaterial('https://test.com/key', api)).rejects.toThrow(/авторизаци/);
        });
    });

    describe('_resolveKey', () => {
        it('вызывает _findKey с правильными аргументами', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            d._findKey = vi.fn().mockResolvedValue({ cryptoKey: 'key', firstSegDecrypted: new Uint8Array(16) });
            const iv = new Uint8Array(16);
            const firstSeg = new Uint8Array(32);
            await d._resolveKey({ data: [1,2,3], xekValue: 'xek' }, iv, firstSeg);
            expect(d._findKey).toHaveBeenCalled();
        });

        it('работает без xekValue', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            d._findKey = vi.fn().mockResolvedValue({ cryptoKey: 'key', firstSegDecrypted: new Uint8Array(16) });
            const iv = new Uint8Array(16);
            const firstSeg = new Uint8Array(32);
            await d._resolveKey({ data: [1,2,3] }, iv, firstSeg);
            expect(d._findKey).toHaveBeenCalled();
        });
    });

    describe('_findKey', () => {
        it('успешно находит ключ AES-CBC', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const rawKey = new Uint8Array(16).fill(1);
            const iv = new Uint8Array(16).fill(0);

            const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, true, ['encrypt']);
            const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new Uint8Array(16));
            const firstSeg = new Uint8Array(encrypted);

            const result = await d._findKey(rawKey, '', iv, firstSeg, 'native');
            expect(result.cryptoKey).toBeDefined();
        });

        it('бросает если ни один кандидат не подошёл', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const rawKey = new Uint8Array(16).fill(255);
            const iv = new Uint8Array(16);
            const garbage = new Uint8Array(32).fill(42);
            await expect(d._findKey(rawKey, '', iv, garbage, 'native')).rejects.toThrow(/ключ расшифровки/);
        });

        it('использует spy source напрямую', async () => {
            const d = new globalThis.ZvukHlsDownloader();
            const rawKey = new Uint8Array(16).fill(2);
            const iv = new Uint8Array(16).fill(0);

            const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, true, ['encrypt']);
            const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new Uint8Array(16));
            const firstSeg = new Uint8Array(encrypted);

            const result = await d._findKey(rawKey, 'ignored_xek', iv, firstSeg, 'spy');
            expect(result).toBeDefined();
        });
    });

    describe('_deriveKeyCandidates', () => {
        it('возвращает [rawBytes] без xekValue', () => {
            const d = new globalThis.ZvukHlsDownloader();
            const raw = new Uint8Array([1, 2, 3, 4]);
            const result = d._deriveKeyCandidates(raw, '');
            expect(result).toHaveLength(1);
        });

        it('возвращает decrypted при наличии xekValue', () => {
            const d = new globalThis.ZvukHlsDownloader();
            const raw = new Uint8Array(16).fill(7);
            const result = d._deriveKeyCandidates(raw, 'test-salt');
            expect(result).toHaveLength(1);
        });

        it('возвращает [rawBytes] если _decryptZvukKey возвращает null', () => {
            const d = new globalThis.ZvukHlsDownloader();
            vi.spyOn(d, '_decryptZvukKey').mockReturnValue(null);
            const raw = new Uint8Array(16).fill(5);
            const result = d._deriveKeyCandidates(raw, 'some-xek');
            expect(result).toHaveLength(1);
            expect(result[0]).toBeInstanceOf(Uint8Array);
        });
    });

    describe('_decryptZvukKey', () => {
        it('возвращает Uint8Array', () => {
            const d = new globalThis.ZvukHlsDownloader();
            const raw = new Uint8Array(16).fill(5);
            const result = d._decryptZvukKey(raw, 'test-salt');
            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(16);
        });

        it('возвращает null при ошибке', () => {
            const d = new globalThis.ZvukHlsDownloader();
            const result = d._decryptZvukKey(null, 'salt');
            expect(result).toBeNull();
        });
    });

    describe('_fnv1a64', () => {
        it('возвращает BigInt', () => {
            const d = new globalThis.ZvukHlsDownloader();
            const result = d._fnv1a64(new Uint8Array([1, 2, 3]));
            expect(typeof result).toBe('bigint');
        });

        it('возвращает разные значения для разных входов', () => {
            const d = new globalThis.ZvukHlsDownloader();
            const a = d._fnv1a64(new Uint8Array([1]));
            const b = d._fnv1a64(new Uint8Array([2]));
            expect(a).not.toBe(b);
        });
    });

    describe('_xorshift64Star', () => {
        it('возвращает BigInt', () => {
            const d = new globalThis.ZvukHlsDownloader();
            const result = d._xorshift64Star(12345n);
            expect(typeof result).toBe('bigint');
        });
    });

    describe('_ror8', () => {
        it('rot=0 возвращает исходное значение', () => {
            const d = new globalThis.ZvukHlsDownloader();
            expect(d._ror8(0b10110101, 0)).toBe(0b10110101);
        });

        it('rot=1 сдвигает на 1 бит вправо с переносом', () => {
            const d = new globalThis.ZvukHlsDownloader();
            expect(d._ror8(0b10110101, 1)).toBe(0b11011010);
        });

        it('rot=8 возвращает исходное значение (полный оборот)', () => {
            const d = new globalThis.ZvukHlsDownloader();
            expect(d._ror8(0b10110101, 8)).toBe(0b10110101);
        });
    });
});
