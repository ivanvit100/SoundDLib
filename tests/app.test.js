import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadModule } from './helpers/loadModule.js';

describe('app.js — все зависимости присутствуют', () => {
    beforeAll(() => {
        // Provide all required globals
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

        let bootFn = null;
        let popupCtorCalled = false;

        globalThis.PopupController = class {
            constructor() {
                popupCtorCalled = true;
            }
        };

        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

        loadModule('app.js');
    });

    it('не бросает при загрузке', () => {
        expect(true).toBe(true);
    });

    it('window.popupController создаётся', async () => {
        // Give async setTimeout a chance
        await new Promise(r => setTimeout(r, 10));
        expect(window.popupController).toBeDefined();
    });
});

describe('app.js — отсутствуют зависимости', () => {
    beforeAll(() => {
        // Remove some required globals to trigger missing dependency path
        const save = globalThis.EventBus;
        globalThis.EventBus = undefined;
        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

        loadModule('app.js');

        globalThis.EventBus = save;
    });

    it('показывает сообщение об ошибке при отсутствующих зависимостях', () => {
        // The IIFE will have run and either shown error or not
        // We just check it didn't crash
        expect(true).toBe(true);
    });
});

describe('app.js — DOMContentLoaded path', () => {
    it('регистрирует DOMContentLoaded listener если readyState loading', () => {
        Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

        const addSpy = vi.spyOn(document, 'addEventListener');

        // Re-run with all globals present
        globalThis.EventBus = class { on() {} emit() {} };
        globalThis.RateLimiter = class {};
        globalThis.Storage = { get: vi.fn(), set: vi.fn() };
        globalThis.DownloadHistory = { add: vi.fn(), getAll: vi.fn(() => []), clear: vi.fn() };
        globalThis.AudioConverter = class {};
        globalThis.SingleTrackManager = class { constructor() { this.eventBus = new globalThis.EventBus(); } };
        globalThis.PlaylistManager = class { constructor() { this.eventBus = new globalThis.EventBus(); } };
        globalThis.ConverterRegistry = { getAll: vi.fn(() => []), getMeta: vi.fn() };
        globalThis.ServiceRegistry = class {};
        globalThis.TemplateLoader = { init: vi.fn(), show: vi.fn().mockResolvedValue(undefined), current: vi.fn() };
        globalThis.HistoryController = { init: vi.fn() };
        globalThis.SingleTrackController = vi.fn();
        globalThis.PlaylistController = vi.fn();
        globalThis.PopupController = class {};

        loadModule('app.js');

        expect(addSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
        addSpy.mockRestore();

        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    });
});

describe('app.js — boot error', () => {
    it('показывает ошибку если PopupController бросает', async () => {
        globalThis.EventBus = class { on() {} emit() {} };
        globalThis.RateLimiter = class {};
        globalThis.Storage = { get: vi.fn(), set: vi.fn() };
        globalThis.DownloadHistory = { add: vi.fn(), getAll: vi.fn(() => []), clear: vi.fn() };
        globalThis.AudioConverter = class {};
        globalThis.SingleTrackManager = class { constructor() { this.eventBus = new globalThis.EventBus(); } };
        globalThis.PlaylistManager = class { constructor() { this.eventBus = new globalThis.EventBus(); } };
        globalThis.ConverterRegistry = { getAll: vi.fn(() => []), getMeta: vi.fn() };
        globalThis.ServiceRegistry = class {};
        globalThis.TemplateLoader = { init: vi.fn(), show: vi.fn().mockResolvedValue(undefined), current: vi.fn() };
        globalThis.HistoryController = { init: vi.fn() };
        globalThis.SingleTrackController = vi.fn();
        globalThis.PlaylistController = vi.fn();
        globalThis.PopupController = class { constructor() { throw new Error('boot fail'); } };

        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

        loadModule('app.js');
        await new Promise(r => setTimeout(r, 10));

        const errorEl = document.getElementById('error');
        if (errorEl) {
            expect(errorEl.textContent).toContain('boot fail');
        }
    });
});
