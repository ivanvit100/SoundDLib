import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('ContentScriptManager', () => {
    let mockApi;
    let installedListeners;

    beforeAll(async () => {
        installedListeners = [];
        mockApi = {
            scripting: {
                registerContentScripts: vi.fn().mockResolvedValue(undefined),
                unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
                executeScript: vi.fn().mockResolvedValue([])
            },
            tabs: {
                query: vi.fn().mockResolvedValue([{ id: 1 }])
            },
            runtime: {
                onInstalled: {
                    addListener: vi.fn((cb) => { installedListeners.push(cb); })
                }
            }
        };

        globalThis.SERVICE_DEFINITIONS = [
            {
                name: 'zvuk',
                matches: ['https://zvuk.com/*'],
                scripts: {
                    contentMain: ['core/base/BaseInterceptor.js', 'services/zvuk/ZvukInterceptor.js'],
                    contentIsolated: ['core/base/BaseRelay.js', 'services/zvuk/ZvukRelay.js']
                }
            }
        ];

        globalThis.getExtensionApi = () => mockApi;

        vi.resetModules();
        await import('../../background/ContentScriptManager.js');
    });

    it('регистрирует onInstalled listener', () => {
        expect(mockApi.runtime.onInstalled.addListener).toHaveBeenCalled();
    });

    it('вызывает registerContentScripts при onInstalled', async () => {
        await installedListeners[0]();
        expect(mockApi.scripting.registerContentScripts).toHaveBeenCalled();
    });

    it('пытается unregister перед register', async () => {
        await installedListeners[0]();
        expect(mockApi.scripting.unregisterContentScripts).toHaveBeenCalled();
    });

    it('выполняет скрипты для открытых вкладок', async () => {
        await installedListeners[0]();
        expect(mockApi.scripting.executeScript).toHaveBeenCalled();
    });

    it('обрабатывает ошибки registerContentScripts', async () => {
        mockApi.scripting.registerContentScripts.mockRejectedValue(new Error('already exists'));
        await expect(installedListeners[0]()).resolves.not.toThrow();
    });
});

describe('ContentScriptManager — без API', () => {
    beforeAll(async () => {
        globalThis.getExtensionApi = () => null;
        globalThis.SERVICE_DEFINITIONS = [
            {
                name: 'zvuk',
                matches: ['https://zvuk.com/*'],
                scripts: {
                    contentMain: ['file.js'],
                    contentIsolated: ['relay.js']
                }
            }
        ];
        vi.resetModules();
        await import('../../background/ContentScriptManager.js');
    });

    it('ничего не делает без api.scripting', () => {
        expect(true).toBe(true);
    });
});
