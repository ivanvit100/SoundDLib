import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

let mockApi;

beforeAll(async () => {
    mockApi = {
        tabs: {
            query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://zvuk.com/track/123' }]),
            get: vi.fn().mockResolvedValue({ id: 1, url: 'https://zvuk.com/track/123' }),
            create: vi.fn().mockResolvedValue({})
        },
        windows: {
            create: vi.fn().mockResolvedValue({ id: 1 })
        },
        runtime: {
            getURL: vi.fn((p) => `chrome-extension://abc/${p}`)
        }
    };

    globalThis.getExtensionApi = () => mockApi;

    globalThis.TemplateLoader = {
        _anchor: null,
        _current: null,
        init: vi.fn(),
        show: vi.fn().mockImplementation(async (name, cb) => {
            if (cb) cb();
        }),
        current: vi.fn(() => null)
    };

    globalThis.HistoryController = { init: vi.fn() };
    globalThis.SingleTrackController = vi.fn(() => ({ _init: vi.fn() }));
    globalThis.PlaylistController = vi.fn(() => ({ _init: vi.fn() }));

    globalThis.serviceRegistry = {
        getServiceByUrl: vi.fn((url) => {
            if (url?.includes('zvuk.com')) {
                return {
                    name: 'zvuk',
                    color: '#22c375',
                    logo: 'icons/logo1.png',
                    constructor: {
                        isPlaylistPage: (u) => u.includes('playlist'),
                        capturePatterns: []
                    },
                    extractPlaylistId: (u) => {
                        const m = u.match(/\/playlist\/(\d+)/);
                        return m ? m[1] : null;
                    }
                };
            }
            return null;
        })
    };

    vi.resetModules();
    await import('../../ui/PopupController.js');
});

describe('PopupController', () => {
    it('PopupController класс существует', () => {
        expect(globalThis.PopupController).toBeDefined();
    });

    describe('_darken', () => {
        it('затемняет hex цвет', () => {
            const ctrl = new globalThis.PopupController();
            const darkened = ctrl._darken('#22c375');
            expect(darkened).not.toBe('#22c375');
            expect(darkened).toMatch(/^#[0-9a-f]{6}$/);
        });

        it('не опускает ниже нуля', () => {
            const ctrl = new globalThis.PopupController();
            const darkened = ctrl._darken('#000000');
            expect(darkened).toBe('#000000');
        });
    });

    describe('showError', () => {
        it('показывает ошибку и скрывает через timeout', () => {
            document.body.innerHTML = '<div id="error" class="hidden"></div>';
            const ctrl = new globalThis.PopupController();
            vi.useFakeTimers();
            ctrl.showError('Test error');
            const el = document.getElementById('error');
            expect(el.textContent).toBe('Test error');
            expect(el.classList.contains('hidden')).toBe(false);
            vi.advanceTimersByTime(5000);
            expect(el.classList.contains('hidden')).toBe(true);
            vi.useRealTimers();
            document.body.innerHTML = '';
        });

        it('не бросает если нет #error', () => {
            document.body.innerHTML = '';
            const ctrl = new globalThis.PopupController();
            expect(() => ctrl.showError('error')).not.toThrow();
        });
    });

    describe('showSuccess', () => {
        it('показывает success и скрывает через timeout', () => {
            document.body.innerHTML = '<div id="success" class="hidden"></div>';
            const ctrl = new globalThis.PopupController();
            vi.useFakeTimers();
            ctrl.showSuccess('Done!');
            const el = document.getElementById('success');
            expect(el.textContent).toBe('Done!');
            expect(el.classList.contains('hidden')).toBe(false);
            vi.advanceTimersByTime(4000);
            expect(el.classList.contains('hidden')).toBe(true);
            vi.useRealTimers();
            document.body.innerHTML = '';
        });

        it('не бросает если нет #success', () => {
            document.body.innerHTML = '';
            const ctrl = new globalThis.PopupController();
            expect(() => ctrl.showSuccess('success')).not.toThrow();
        });
    });

    describe('_showWrongService', () => {
        it('показывает wrong-service template', async () => {
            document.body.innerHTML = '<img id="siteLogo" />';
            globalThis.TemplateLoader.show = vi.fn().mockResolvedValue(undefined);
            const ctrl = new globalThis.PopupController();
            await ctrl._showWrongService();
            expect(globalThis.TemplateLoader.show).toHaveBeenCalledWith('wrong-service');
        });

        it('добавляет listeners на openZvuk и openGithub', async () => {
            document.body.innerHTML = '<img id="siteLogo" /><a id="openZvuk"></a><a id="openGithub"></a>';
            globalThis.TemplateLoader.show = vi.fn().mockResolvedValue(undefined);
            mockApi.tabs.create = vi.fn().mockResolvedValue({});
            const ctrl = new globalThis.PopupController();
            await ctrl._showWrongService();
            document.getElementById('openZvuk').click();
            document.getElementById('openGithub').click();
            expect(mockApi.tabs.create).toHaveBeenCalledTimes(2);
        });
    });

    describe('_route', () => {
        it('показывает single-track для трек страницы', async () => {
            mockApi.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://zvuk.com/track/123' }]);
            document.body.innerHTML = '<img id="siteLogo" /><div id="view"></div>';
            const ctrl = new globalThis.PopupController();
            await ctrl._route();
            expect(globalThis.TemplateLoader.show).toHaveBeenCalledWith(
                'single-track', expect.any(Function)
            );
        });

        it('показывает playlist для playlist страницы', async () => {
            mockApi.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://zvuk.com/playlist/42' }]);
            document.body.innerHTML = '<img id="siteLogo" /><div id="view"></div>';
            globalThis.TemplateLoader.show = vi.fn().mockImplementation(async (name, cb) => { if (cb) cb(); });
            globalThis.PlaylistController = vi.fn(function() {});
            const ctrl = new globalThis.PopupController();
            await ctrl._route();
            expect(globalThis.TemplateLoader.show).toHaveBeenCalledWith('playlist', expect.any(Function));
            expect(globalThis.PlaylistController).toHaveBeenCalled();
        });

        it('показывает wrong-service если сервис не найден', async () => {
            mockApi.tabs.query = vi.fn().mockResolvedValue([{ id: 1, url: 'https://other.com/track/1' }]);
            document.body.innerHTML = '<img id="siteLogo" />';
            globalThis.TemplateLoader.show = vi.fn().mockResolvedValue(undefined);
            const ctrl = new globalThis.PopupController();
            await ctrl._route();
            expect(globalThis.TemplateLoader.show).toHaveBeenCalledWith('wrong-service');
        });

        it('показывает wrong-service если нет url', async () => {
            mockApi.tabs.query = vi.fn().mockResolvedValue([{ id: 1 }]);
            globalThis.TemplateLoader.show = vi.fn().mockResolvedValue(undefined);
            const ctrl = new globalThis.PopupController();
            await ctrl._route();
            expect(globalThis.TemplateLoader.show).toHaveBeenCalledWith('wrong-service');
        });

        it('использует forcedTabId из URL params', async () => {
            Object.defineProperty(window, 'location', {
                value: { search: '?tabId=5', href: 'popup.html?tabId=5', pathname: '/popup.html' },
                writable: true,
                configurable: true
            });
            mockApi.tabs.get = vi.fn().mockResolvedValue({ id: 5, url: 'https://zvuk.com/track/100' });
            const ctrl = new globalThis.PopupController();
            await ctrl._route();
            expect(mockApi.tabs.get).toHaveBeenCalledWith(5);
            Object.defineProperty(window, 'location', {
                value: { search: '', href: 'popup.html', pathname: '/popup.html' },
                writable: true,
                configurable: true
            });
        });
    });

    describe('_bindShellEvents', () => {
        it('скрывает popoutBtn в standalone режиме', () => {
            Object.defineProperty(window, 'location', {
                value: { search: '?tabId=1', href: 'popup.html?tabId=1', pathname: '/popup.html' },
                writable: true,
                configurable: true
            });
            document.body.innerHTML = '<button id="popoutBtn"></button><button id="historyBtn"></button>';
            const ctrl = new globalThis.PopupController();
            ctrl._shellBound = false;
            ctrl._bindShellEvents();
            const btn = document.getElementById('popoutBtn');
            expect(btn.style.display).toBe('none');
            Object.defineProperty(window, 'location', {
                value: { search: '', href: 'popup.html', pathname: '/popup.html' },
                writable: true,
                configurable: true
            });
        });

        it('popoutBtn открывает popup окно', async () => {
            Object.defineProperty(window, 'location', {
                value: { search: '', href: 'popup.html', pathname: '/popup.html' },
                writable: true,
                configurable: true
            });
            document.body.innerHTML = '<button id="popoutBtn"></button><button id="historyBtn"></button>';
            mockApi.windows.create = vi.fn().mockResolvedValue({ id: 2 });
            const ctrl = new globalThis.PopupController();
            ctrl._shellBound = false;
            ctrl._bindShellEvents();
            document.getElementById('popoutBtn').click();
            await new Promise(r => setTimeout(r, 10));
            expect(mockApi.windows.create).toHaveBeenCalled();
        });

        it('не вызывает повторно если уже bound', () => {
            const ctrl = new globalThis.PopupController();
            ctrl._shellBound = true;
            document.body.innerHTML = '<button id="popoutBtn"></button>';
            const btn = document.getElementById('popoutBtn');
            const addSpy = vi.spyOn(btn, 'addEventListener');
            ctrl._bindShellEvents();
            expect(addSpy).not.toHaveBeenCalled();
        });

        it('historyBtn показывает history view', () => {
            Object.defineProperty(window, 'location', {
                value: { search: '', href: 'popup.html', pathname: '/popup.html' },
                writable: true,
                configurable: true
            });
            document.body.innerHTML = `
                <button id="popoutBtn"></button>
                <button id="historyBtn"></button>
                <div id="logoInfo"></div>
            `;
            globalThis.TemplateLoader.show = vi.fn().mockImplementation(async (name, cb) => {
                if (cb) cb();
            });
            const ctrl = new globalThis.PopupController();
            ctrl._shellBound = false;
            ctrl._bindShellEvents();
            document.getElementById('historyBtn').click();
            expect(globalThis.TemplateLoader.show).toHaveBeenCalledWith('history', expect.any(Function));
        });
    });

    describe('_restoreMainView', () => {
        it('очищает logoInfo и перезапускает route', async () => {
            document.body.innerHTML = '<div id="logoInfo">old text</div>';
            const ctrl = new globalThis.PopupController();
            const routeSpy = vi.spyOn(ctrl, '_route').mockResolvedValue(undefined);
            await ctrl._restoreMainView();
            expect(document.getElementById('logoInfo').textContent).toBe('');
            expect(routeSpy).toHaveBeenCalled();
        });
    });
});
