import { describe, it, expect, vi } from 'vitest';

describe('ZvukService — serviceRegistry FALSE branch', () => {
    it('загружается без serviceRegistry', async () => {
        const origGetApi = globalThis.getExtensionApi;
        const origRegistry = globalThis.serviceRegistry;

        globalThis.getExtensionApi = vi.fn(() => ({
            runtime: { sendMessage: vi.fn() }
        }));
        globalThis.BaseAudioService = class {
            constructor(cfg) { Object.assign(this, cfg); }
            static get capturePatterns() { return []; }
            static matches() { return false; }
        };
        globalThis.serviceRegistry = undefined;
        globalThis.ZvukHlsDownloader = class { download() {} };

        vi.resetModules();
        await import('../../../services/zvuk/ZvukService.js');

        expect(globalThis.ZvukService).toBeDefined();

        globalThis.getExtensionApi = origGetApi;
        globalThis.serviceRegistry = origRegistry;
    });
});
