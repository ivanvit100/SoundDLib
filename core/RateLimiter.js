/**
 * SoundDLib core module
 * Module to manage request rate limiting
 * @module core/RateLimiter
 * @license MIT
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    console.log('[RateLimiter] Loading...');

    class RateLimiter {
        constructor() {
            this._throttled = false;
            this._throttleTimer = null;
            this._pending = [];
        }

        throttle(duration = 30000) {
            if (this._throttled) {
                console.warn('[RateLimiter] Already throttled, ignoring duplicate');
                return;
            }
            this._throttled = true;
            console.warn(`[RateLimiter] 429 detected: pausing all requests for ${duration}ms`);
            if (this._throttleTimer) clearTimeout(this._throttleTimer);
            this._throttleTimer = setTimeout(() => {
                this._throttled = false;
                this._throttleTimer = null;
                console.log('[RateLimiter] Throttle lifted, resuming requests');
                const cbs = this._pending.splice(0);
                for (const cb of cbs) cb();
            }, duration);
        }

        trackRequest(source = 'unknown') {
            if (!this._throttled) return Promise.resolve();
            console.debug(`[RateLimiter] Request queued (throttled): ${source}`);
            return new Promise(resolve => this._pending.push(resolve));
        }

        acquire(source = 'default') {
            return this.trackRequest(source);
        }

        async execute(source, fn) {
            await this.trackRequest(source);
            return fn();
        }

        getStats() {
            return { throttled: this._throttled, pendingRequests: this._pending.length };
        }

        reset() {
            this._throttled = false;
            if (this._throttleTimer) {
                clearTimeout(this._throttleTimer);
                this._throttleTimer = null;
            }
            const cbs = this._pending.splice(0);
            for (const cb of cbs) cb();
            console.log('[RateLimiter] Reset completed');
        }
    }

    global.RateLimiter = RateLimiter;

    if (!global.globalRateLimiter) global.globalRateLimiter = new RateLimiter();
    else console.log('[RateLimiter] Using existing global RateLimiter instance');

    console.log('[RateLimiter] Loaded');
})(typeof window !== 'undefined' ? window : self);
