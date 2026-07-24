/**
 * SoundDLib core template module
 * Base class for request interceptors
 * @module core/base/BaseInterceptor
 * @author ivanvit
 * @version 0.0.1
 */

(function(global) {
    class BaseInterceptor {
        _post(type, payload) {
            window.postMessage({ __sounddlib: true, type, ...payload }, '*');
        }

        install() {
            throw new Error('BaseInterceptor.install() must be implemented');
        }
    }

    global.BaseInterceptor = BaseInterceptor;
})(typeof window !== 'undefined' ? window : self);
