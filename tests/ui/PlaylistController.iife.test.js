import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
    globalThis.PlaylistManager = class {
        constructor() { this.eventBus = { on: vi.fn(), once: vi.fn(), emit: vi.fn(), off: vi.fn() }; }
        async loadPlaylist() { return []; }
        pause() {} resume() {} stop() {}
    };
    globalThis.AudioConverter = class {};
    globalThis.ConverterRegistry = { getFormats: vi.fn(() => []), getMeta: vi.fn(() => ({})) };
    globalThis.Storage = { get: vi.fn(() => null), set: vi.fn() };
});

describe('PlaylistController — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../ui/PlaylistController.js');
        vi.unstubAllGlobals();
        expect(globalThis.PlaylistController).toBeDefined();
    });
});
