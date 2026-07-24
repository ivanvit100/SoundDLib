/**
 * SoundDLib background module
 * Loads background scripts for all services declared in SERVICE_DEFINITIONS
 * @module background/ServicesLoader
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const defs = global.SERVICE_DEFINITIONS || [];
    const files = defs.flatMap(s => s.scripts?.background || []);
    if (!files.length) return;

    if (typeof importScripts === 'function')
        importScripts(...files);
    else if (typeof document !== 'undefined' && document.currentScript !== null)
        files.forEach(src => document.write(`<script src="${src}"><\/script>`));

    console.log('[ServicesLoader] Loaded', files.length, 'background files');
})(typeof window !== 'undefined' ? window : self);
