import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadModule } from '../helpers/loadModule.js';

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

    it('вызывает importScripts с фоновыми скриптами', () => {
        loadModule('background/ServicesLoader.js');
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
        // document exists in jsdom, document.write available
        document.write = vi.fn();
    });

    it('использует document.write если importScripts недоступен', () => {
        Object.defineProperty(document, 'currentScript', { value: {}, configurable: true });
        loadModule('background/ServicesLoader.js');
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

    it('ничего не делает если нет сервисов', () => {
        expect(() => loadModule('background/ServicesLoader.js')).not.toThrow();
    });
});

describe('ServicesLoader — нет SERVICE_DEFINITIONS', () => {
    beforeAll(() => {
        globalThis.SERVICE_DEFINITIONS = undefined;
        globalThis.importScripts = undefined;
    });

    it('ничего не делает если SERVICE_DEFINITIONS не существует', () => {
        expect(() => loadModule('background/ServicesLoader.js')).not.toThrow();
    });
});
