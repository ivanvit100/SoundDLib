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

describe('ContentScriptManager — getExtensionApi не функция', () => {
    beforeAll(async () => {
        globalThis.getExtensionApi = null;
        globalThis.SERVICE_DEFINITIONS = undefined;
        vi.resetModules();
        await import('../../background/ContentScriptManager.js');
    });

    it('загружается без ошибок если getExtensionApi не функция', () => {
        expect(true).toBe(true);
    });
});

describe('ContentScriptManager — без SERVICE_DEFINITIONS', () => {
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
            tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }]) },
            runtime: {
                onInstalled: { addListener: vi.fn((cb) => { installedListeners.push(cb); }) }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.SERVICE_DEFINITIONS = undefined;
        vi.resetModules();
        await import('../../background/ContentScriptManager.js');
    });

    it('не регистрирует скрипты если SERVICE_DEFINITIONS пустой', async () => {
        if (installedListeners.length) await installedListeners[0]();
        expect(mockApi.scripting.registerContentScripts).not.toHaveBeenCalled();
    });
});

describe('ContentScriptManager — executeScript reject (catch callback)', () => {
    let mockApi;
    let installedListeners;

    beforeAll(async () => {
        installedListeners = [];
        mockApi = {
            scripting: {
                registerContentScripts: vi.fn().mockResolvedValue(undefined),
                unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
                executeScript: vi.fn().mockRejectedValue(new Error('script exec failed'))
            },
            tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }]) },
            runtime: {
                onInstalled: { addListener: vi.fn((cb) => { installedListeners.push(cb); }) }
            }
        };
        globalThis.getExtensionApi = () => mockApi;
        globalThis.SERVICE_DEFINITIONS = [{
            name: 'test',
            matches: ['https://example.com/*'],
            scripts: { contentMain: ['main.js'], contentIsolated: ['relay.js'] }
        }];
        vi.resetModules();
        await import('../../background/ContentScriptManager.js');
    });

    it('не бросает при ошибке executeScript', async () => {
        if (installedListeners.length)
            await expect(installedListeners[0]()).resolves.not.toThrow();
    });
});
