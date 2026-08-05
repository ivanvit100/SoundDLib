import { describe, it, expect, vi } from 'vitest';
import '../../../core/base/BaseInterceptor.js';

describe('BaseInterceptor', () => {
    it('BaseInterceptor класс существует', () => {
        expect(globalThis.BaseInterceptor).toBeDefined();
    });

    describe('_post', () => {
        it('вызывает window.postMessage с корректными данными', () => {
            const postMessage = vi.fn();
            vi.stubGlobal('postMessage', postMessage);

            const interceptor = new globalThis.BaseInterceptor();
            interceptor._post('TEST_TYPE', { foo: 'bar' });

            expect(postMessage).toHaveBeenCalledWith(
                { __sounddlib: true, type: 'TEST_TYPE', foo: 'bar' },
                '*'
            );
            vi.unstubAllGlobals();
        });

        it('отправляет пустой payload', () => {
            const postMessage = vi.fn();
            vi.stubGlobal('postMessage', postMessage);

            const interceptor = new globalThis.BaseInterceptor();
            interceptor._post('EMPTY', {});

            expect(postMessage).toHaveBeenCalledWith(
                { __sounddlib: true, type: 'EMPTY' },
                '*'
            );
            vi.unstubAllGlobals();
        });
    });

    describe('install', () => {
        it('бросает Error при вызове базового install', () => {
            const interceptor = new globalThis.BaseInterceptor();
            expect(() => interceptor.install()).toThrow('BaseInterceptor.install() must be implemented');
        });
    });
});
