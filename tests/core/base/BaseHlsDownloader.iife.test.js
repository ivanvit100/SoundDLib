import { describe, it, expect, vi } from 'vitest';

describe('BaseHlsDownloader — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../../core/base/BaseHlsDownloader.js');
        vi.unstubAllGlobals();
        expect(globalThis.BaseHlsDownloader).toBeDefined();
    });
});
