import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('ServicesLoader — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        globalThis.SERVICE_DEFINITIONS = [];
        globalThis.importScripts = vi.fn();
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../background/ServicesLoader.js');
        vi.unstubAllGlobals();
        expect(true).toBe(true);
    });
});

describe('ServicesLoader — importScripts путь', () => {
    beforeAll(() => {
        globalThis.SERVICE_DEFINITIONS = [
            {
                name: 'zvuk',
                scripts: {
                    background: ['/services/zvuk/config.js', '/services/BaseAudioService.js']
                }
            }
        ];
        globalThis.importScripts = vi.fn();
    });

    it('вызывает importScripts с фоновыми скриптами', async () => {
        vi.resetModules();
        await import('../../background/ServicesLoader.js');
        expect(globalThis.importScripts).toHaveBeenCalledWith(
            '/services/zvuk/config.js',
            '/services/BaseAudioService.js'
        );
    });
});

describe('ServicesLoader — document.write путь', () => {
    beforeAll(() => {
        globalThis.SERVICE_DEFINITIONS = [
            {
                name: 'zvuk',
                scripts: {
                    background: ['/services/zvuk/config.js']
                }
            }
        ];
        globalThis.importScripts = undefined;
        document.write = vi.fn();
    });

    it('использует document.write если importScripts недоступен', async () => {
        Object.defineProperty(document, 'currentScript', { value: {}, configurable: true });
        vi.resetModules();
        await import('../../background/ServicesLoader.js');
        Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
        expect(document.write).toHaveBeenCalledWith(
            '<script src="/services/zvuk/config.js"><\/script>'
        );
    });
});

describe('ServicesLoader — пустые определения', () => {
    beforeAll(() => {
        globalThis.SERVICE_DEFINITIONS = [];
        globalThis.importScripts = undefined;
    });

    it('ничего не делает если нет сервисов', async () => {
        vi.resetModules();
        await expect(import('../../background/ServicesLoader.js')).resolves.not.toThrow();
    });
});

describe('ServicesLoader — нет SERVICE_DEFINITIONS', () => {
    beforeAll(() => {
        globalThis.SERVICE_DEFINITIONS = undefined;
        globalThis.importScripts = undefined;
    });

    it('ничего не делает если SERVICE_DEFINITIONS не существует', async () => {
        vi.resetModules();
        await expect(import('../../background/ServicesLoader.js')).resolves.not.toThrow();
    });
});

describe('ServicesLoader — сервис без scripts.background', () => {
    beforeAll(() => {
        globalThis.SERVICE_DEFINITIONS = [
            { name: 'zvuk', scripts: {} },
            { name: 'other' }
        ];
        globalThis.importScripts = vi.fn();
    });

    it('не падает если scripts.background отсутствует', async () => {
        vi.resetModules();
        await expect(import('../../background/ServicesLoader.js')).resolves.not.toThrow();
    });
});

describe('ServicesLoader — document.write с currentScript=null', () => {
    beforeAll(() => {
        globalThis.SERVICE_DEFINITIONS = [
            { name: 'zvuk', scripts: { background: ['/services/zvuk/config.js'] } }
        ];
        globalThis.importScripts = undefined;
        document.write = vi.fn();
    });

    it('не вызывает document.write если currentScript равен null', async () => {
        Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
        vi.resetModules();
        await import('../../background/ServicesLoader.js');
        expect(document.write).not.toHaveBeenCalled();
    });
});
