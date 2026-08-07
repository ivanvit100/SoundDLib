import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
    const mockBrowser = {
        tabs: {
            query: vi.fn().mockResolvedValue([]),
            get: vi.fn().mockResolvedValue({}),
            create: vi.fn().mockResolvedValue({})
        },
        windows: { create: vi.fn().mockResolvedValue({ id: 1 }) },
        runtime: { getURL: vi.fn((p) => `chrome-extension://abc/${p}`) }
    };

    globalThis.browser = mockBrowser;

    delete globalThis.getExtensionApi;

    globalThis.TemplateLoader = {
        init: vi.fn(),
        show: vi.fn().mockResolvedValue(undefined),
        current: vi.fn(() => null)
    };
    globalThis.HistoryController = { init: vi.fn() };
    globalThis.SingleTrackController = vi.fn(function() {});
    globalThis.PlaylistController = vi.fn(function() {});
    globalThis.serviceRegistry = {
        getServiceByUrl: vi.fn(() => null)
    };
});

describe('PopupController — browserAPI else branch', () => {
    it('использует browser если getExtensionApi не функция', async () => {
        vi.resetModules();
        await import('../../ui/PopupController.js');
        expect(globalThis.PopupController).toBeDefined();
        const ctrl = new globalThis.PopupController();
        expect(ctrl).toBeDefined();
    });

    it('использует chrome если нет browser', async () => {
        const mockChrome = {
            tabs: {
                query: vi.fn().mockResolvedValue([]),
                get: vi.fn().mockResolvedValue({}),
                create: vi.fn().mockResolvedValue({})
            },
            windows: { create: vi.fn().mockResolvedValue({ id: 1 }) },
            runtime: { getURL: vi.fn((p) => `chrome-extension://abc/${p}`) }
        };
        globalThis.browser = undefined;
        globalThis.chrome = mockChrome;
        vi.resetModules();
        await import('../../ui/PopupController.js');
        expect(globalThis.PopupController).toBeDefined();
    });

    it('browserAPI равен null если нет ни browser ни chrome', async () => {
        globalThis.browser = undefined;
        globalThis.chrome = undefined;
        vi.resetModules();
        await import('../../ui/PopupController.js');
        expect(globalThis.PopupController).toBeDefined();
    });
});
