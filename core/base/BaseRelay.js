/**
 * SoundDLib core template module
 * Base class for relays (content scripts)
 * @module core/base/BaseRelay
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class BaseRelay {
        constructor(api) {
            this._api = api;
            this._msgHandlers = new Map();
            this._injectors = [];
        }

        registerHandler(action, fn) {
            this._msgHandlers.set(action, fn.bind(this));
        }

        registerInjector(fn) {
            this._injectors.push(fn.bind(this));
        }

        start() {
            window.addEventListener('message', (event) => {
                if (!event.data?.__sounddlib) return;
                this._onMainWorldMessage(event.data);
            });

            this._api.runtime.onMessage.addListener((message, sender, sendResponse) => {
                const handler = this._msgHandlers.get(message.action);
                if (!handler) return false;
                (async () => {
                    try { sendResponse(await handler(message, sender)); }
                    catch (e) { sendResponse({ ok: false, error: String(e) }); }
                })();
                return true;
            });

            this._runInjectors();
            let _timer = null;
            new MutationObserver(() => {
                clearTimeout(_timer);
                _timer = setTimeout(() => this._runInjectors(), 250);
            }).observe(document.body || document.documentElement, { childList: true, subtree: true });
        }

        _runInjectors() {
            for (const fn of this._injectors)  try { fn(); } catch {}
        }

        _onMainWorldMessage(_data) {}
    }

    global.BaseRelay = BaseRelay;
    console.log('[BaseRelay] Loaded');
})(typeof window !== 'undefined' ? window : self);
