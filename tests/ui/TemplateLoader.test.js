import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import '../../ui/TemplateLoader.js';

describe('TemplateLoader — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../ui/TemplateLoader.js');
        vi.unstubAllGlobals();
        expect(globalThis.TemplateLoader).toBeDefined();
    });
});

describe('TemplateLoader', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="view"></div>';
        globalThis.TemplateLoader._anchor = null;
        globalThis.TemplateLoader._current = null;
    });

    it('TemplateLoader объект существует', () => {
        expect(globalThis.TemplateLoader).toBeDefined();
    });

    describe('init', () => {
        it('инициализирует anchor по id', () => {
            globalThis.TemplateLoader.init('view');
            expect(globalThis.TemplateLoader._anchor).toBeTruthy();
        });

        it('логирует ошибку если anchor не найден', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            globalThis.TemplateLoader.init('nonexistent-id');
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Anchor element not found'), 'nonexistent-id');
            consoleSpy.mockRestore();
        });
    });

    describe('show', () => {
        it('возвращает undefined если anchor не инициализирован', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const result = await globalThis.TemplateLoader.show('template');
            expect(result).toBeUndefined();
            consoleSpy.mockRestore();
        });

        it('загружает template успешно', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve('<h1>Template</h1>')
            });
            globalThis.TemplateLoader.init('view');
            await globalThis.TemplateLoader.show('single-track');
            expect(globalThis.TemplateLoader._current).toBe('single-track');
            expect(document.getElementById('view').innerHTML).toBe('<h1>Template</h1>');
        });

        it('вызывает onReady callback после загрузки', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve('<div>ready</div>')
            });
            globalThis.TemplateLoader.init('view');
            const onReady = vi.fn();
            await globalThis.TemplateLoader.show('history', onReady);
            expect(onReady).toHaveBeenCalled();
        });

        it('логирует ошибку при HTTP ошибке', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404
            });
            globalThis.TemplateLoader.init('view');
            await globalThis.TemplateLoader.show('notfound');
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('логирует ошибку при fetch failure', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
            globalThis.TemplateLoader.init('view');
            await globalThis.TemplateLoader.show('fail-template');
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('current', () => {
        it('возвращает null изначально', () => {
            expect(globalThis.TemplateLoader.current()).toBeNull();
        });

        it('возвращает текущий template после show', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                text: () => Promise.resolve('<div></div>')
            });
            globalThis.TemplateLoader.init('view');
            await globalThis.TemplateLoader.show('playlist');
            expect(globalThis.TemplateLoader.current()).toBe('playlist');
        });
    });
});
