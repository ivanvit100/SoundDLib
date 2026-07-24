/**
 * SoundDLib popup module
 * Loads service scripts in popup context
 * @module popup/ServicesLoader
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    const defs = (typeof window !== 'undefined' && window.SERVICE_DEFINITIONS) || [];
    const files = defs.flatMap(s => s.scripts?.popup || []);
    files.forEach(src => document.write(`<script src="${src}"><\/script>`));
})();
