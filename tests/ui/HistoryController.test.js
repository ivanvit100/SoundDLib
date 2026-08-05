import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import '../../core/EventBus.js';
import '../../core/Storage.js';
import '../../core/DownloadHistory.js';

import '../../ui/HistoryController.js';

describe('HistoryController', () => {
    beforeEach(() => {
        globalThis.DownloadHistory.clear();
        document.body.innerHTML = `
            <div id="historyList"></div>
            <div id="historyEmpty" style="display:none"></div>
            <button id="clearHistoryBtn" style="display:none"></button>
            <button id="backBtn"></button>
            <div id="logoInfo"></div>
        `;
    });

    it('HistoryController объект существует', () => {
        expect(globalThis.HistoryController).toBeDefined();
    });

    describe('init — пустая история', () => {
        it('показывает empty state', () => {
            globalThis.HistoryController.init();
            const empty = document.getElementById('historyEmpty');
            expect(empty.style.display).toBe('block');
        });

        it('скрывает list и clearBtn', () => {
            globalThis.HistoryController.init();
            const list = document.getElementById('historyList');
            const clear = document.getElementById('clearHistoryBtn');
            expect(list.style.display).toBe('none');
            expect(clear.style.display).toBe('none');
        });
    });

    describe('init — с историей', () => {
        beforeEach(() => {
            globalThis.DownloadHistory.add({
                service: 'zvuk',
                title: 'Test Track',
                artist: 'Test Artist',
                cover: 'https://example.com/cover.jpg',
                format: 'mp3'
            });
        });

        it('скрывает empty, показывает list и clearBtn', () => {
            globalThis.HistoryController.init();
            const list = document.getElementById('historyList');
            const empty = document.getElementById('historyEmpty');
            const clear = document.getElementById('clearHistoryBtn');
            expect(list.style.display).toBe('flex');
            expect(empty.style.display).toBe('none');
            expect(clear.style.display).toBe('block');
        });

        it('рендерит карточку для каждого элемента', () => {
            globalThis.HistoryController.init();
            const list = document.getElementById('historyList');
            expect(list.querySelectorAll('.history-card').length).toBe(1);
        });

        it('создаёт карточку с cover img', () => {
            globalThis.HistoryController.init();
            const list = document.getElementById('historyList');
            expect(list.querySelector('.history-cover')).toBeTruthy();
        });

        it('создаёт карточку без cover если не задан', () => {
            globalThis.DownloadHistory.clear();
            globalThis.DownloadHistory.add({
                service: 'zvuk',
                title: 'No Cover Track',
                format: 'flac'
            });
            globalThis.HistoryController.init();
            const list = document.getElementById('historyList');
            expect(list.querySelector('.history-cover')).toBeNull();
        });

        it('использует цвет сервиса', () => {
            globalThis.HistoryController.init();
            const card = document.querySelector('.history-card');
            expect(card.style.borderLeftColor).toBe('rgb(34, 195, 117)');
        });

        it('использует дефолтный цвет для неизвестного сервиса', () => {
            globalThis.DownloadHistory.clear();
            globalThis.DownloadHistory.add({ service: 'unknown', title: 'T', format: 'mp3' });
            globalThis.HistoryController.init();
            const card = document.querySelector('.history-card');
            expect(card.style.borderLeftColor).toBe('rgb(34, 195, 117)');
        });

        it('показывает artist если задан', () => {
            globalThis.HistoryController.init();
            const artist = document.querySelector('.history-artist');
            expect(artist).toBeTruthy();
            expect(artist.textContent).toBe('Test Artist');
        });

        it('не создаёт artist элемент если не задан', () => {
            globalThis.DownloadHistory.clear();
            globalThis.DownloadHistory.add({ service: 'zvuk', title: 'T', format: 'mp3' });
            globalThis.HistoryController.init();
            expect(document.querySelector('.history-artist')).toBeNull();
        });
    });

    describe('events', () => {
        it('clearHistoryBtn очищает историю и перерисовывает', () => {
            globalThis.DownloadHistory.add({ service: 'zvuk', title: 'T1', format: 'mp3' });
            globalThis.HistoryController.init();
            document.getElementById('clearHistoryBtn').click();
            expect(globalThis.DownloadHistory.getAll()).toHaveLength(0);
            expect(document.getElementById('historyEmpty').style.display).toBe('block');
        });

        it('backBtn вызывает _restoreMainView если есть popupController', () => {
            globalThis.popupController = { _restoreMainView: vi.fn() };
            globalThis.HistoryController.init();
            document.getElementById('backBtn').click();
            expect(globalThis.popupController._restoreMainView).toHaveBeenCalled();
            delete globalThis.popupController;
        });

        it('backBtn не бросает если нет popupController', () => {
            globalThis.popupController = undefined;
            globalThis.HistoryController.init();
            expect(() => document.getElementById('backBtn').click()).not.toThrow();
        });
    });

    describe('_render без DOM элементов', () => {
        it('не бросает если DOM не найден', () => {
            document.body.innerHTML = '';
            globalThis.DownloadHistory.add({ service: 'zvuk', title: 'T', format: 'mp3' });
            expect(() => globalThis.HistoryController._render()).not.toThrow();
        });
    });
});
