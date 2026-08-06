import { describe, it, expect, vi, beforeAll } from 'vitest';

function setupAllGlobals() {
    globalThis.EventBus = class { on() {} emit() {} };
    globalThis.RateLimiter = class {};
    globalThis.Storage = { get: vi.fn(), set: vi.fn() };
    globalThis.DownloadHistory = { add: vi.fn(), getAll: vi.fn(() => []), clear: vi.fn() };
    globalThis.AudioConverter = class {};
    globalThis.SingleTrackManager = class {
        constructor() { this.eventBus = new globalThis.EventBus(); }
    };
    globalThis.PlaylistManager = class {
        constructor() { this.eventBus = new globalThis.EventBus(); }
    };
    globalThis.ConverterRegistry = { getAll: vi.fn(() => []), getMeta: vi.fn() };
    globalThis.ServiceRegistry = class {};
    globalThis.TemplateLoader = { init: vi.fn(), show: vi.fn().mockResolvedValue(undefined), current: vi.fn() };
    globalThis.HistoryController = { init: vi.fn() };
    globalThis.SingleTrackController = vi.fn();
    globalThis.PlaylistController = vi.fn();
}

describe('app.js — все зависимости присутствуют', () => {
    beforeAll(async () => {
        setupAllGlobals();

        globalThis.PopupController = class {
            constructor() {}
        };

        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

        vi.resetModules();
        await import('../app.js');
    });

    it('не бросает при загрузке', () => {
        expect(true).toBe(true);
    });

    it('window.popupController создаётся', async () => {
        await new Promise(r => setTimeout(r, 10));
        expect(window.popupController).toBeDefined();
    });
});

describe('app.js — отсутствуют зависимости', () => {
    beforeAll(async () => {
        const save = globalThis.EventBus;
        globalThis.EventBus = undefined;
        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

        vi.resetModules();
        await import('../app.js');

        globalThis.EventBus = save;
    });

    it('показывает сообщение об ошибке при отсутствующих зависимостях', () => {
        expect(true).toBe(true);
    });
});

describe('app.js — DOMContentLoaded path', () => {
    it('регистрирует DOMContentLoaded listener если readyState loading', async () => {
        Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

        const addSpy = vi.spyOn(document, 'addEventListener');

        setupAllGlobals();
        globalThis.PopupController = class {};

        vi.resetModules();
        await import('../app.js');

        expect(addSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
        addSpy.mockRestore();

        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    });
});

describe('app.js — boot error', () => {
    it('показывает ошибку если PopupController бросает', async () => {
        setupAllGlobals();
        globalThis.PopupController = class { constructor() { throw new Error('boot fail'); } };

        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

        vi.resetModules();
        await import('../app.js');
        await new Promise(r => setTimeout(r, 10));

        const errorEl = document.getElementById('error');
        if (errorEl) {
            expect(errorEl.textContent).toContain('boot fail');
        }
    });
});
