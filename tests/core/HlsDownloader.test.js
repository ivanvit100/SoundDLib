import { describe, it, expect, beforeAll } from 'vitest';
import { loadModule } from '../helpers/loadModule.js';

describe('HlsDownloader', () => {
    beforeAll(() => {
        // Case 1: ZvukHlsDownloader exists → alias
        globalThis.ZvukHlsDownloader = class FakeZvukHlsDownloader {};
        loadModule('core/HlsDownloader.js');
    });

    it('HlsDownloader является псевдонимом ZvukHlsDownloader', () => {
        expect(globalThis.HlsDownloader).toBe(globalThis.ZvukHlsDownloader);
    });
});

describe('HlsDownloader — без ZvukHlsDownloader', () => {
    beforeAll(() => {
        globalThis.ZvukHlsDownloader = undefined;
        delete globalThis.HlsDownloader;
        loadModule('core/HlsDownloader.js');
    });

    it('не создаёт HlsDownloader если ZvukHlsDownloader не существует', () => {
        // HlsDownloader should not be set in this case
        expect(globalThis.HlsDownloader).toBeUndefined();
    });
});
