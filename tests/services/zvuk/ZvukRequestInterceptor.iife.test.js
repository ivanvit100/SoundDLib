import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('ZvukRequestInterceptor IIFE — без serviceRequestInterceptors (line 12 TRUE)', () => {
    beforeAll(async () => {
        delete globalThis.serviceRequestInterceptors;
        vi.resetModules();
        await import('../../../services/zvuk/ZvukRequestInterceptor.js');
    });

    it('создаёт serviceRequestInterceptors если не существует', () => {
        expect(globalThis.serviceRequestInterceptors).toBeDefined();
        expect(Array.isArray(globalThis.serviceRequestInterceptors)).toBe(true);
    });
});
