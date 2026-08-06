import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('HlsDownloader', () => {
    beforeAll(async () => {
        globalThis.ZvukHlsDownloader = class FakeZvukHlsDownloader {};
        vi.resetModules();
        await import('../../core/HlsDownloader.js');
    });

    it('HlsDownloader является псевдонимом ZvukHlsDownloader', () => {
        expect(globalThis.HlsDownloader).toBe(globalThis.ZvukHlsDownloader);
    });
});

describe('HlsDownloader — без ZvukHlsDownloader', () => {
    beforeAll(async () => {
        globalThis.ZvukHlsDownloader = undefined;
        delete globalThis.HlsDownloader;
        vi.resetModules();
        await import('../../core/HlsDownloader.js');
    });

    it('не создаёт HlsDownloader если ZvukHlsDownloader не существует', () => {
        expect(globalThis.HlsDownloader).toBeUndefined();
    });
});
