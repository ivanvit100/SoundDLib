/**
 * SoundDLib core module
 * Backward compatibility stub — HLS download logic has been moved to:
 *   core/base/BaseHlsDownloader.js  (generic base class)
 *   services/zvuk/ZvukHlsDownloader.js  (zvuk-specific implementation)
 * @module core/HlsDownloader
 * @author ivanvit
 * @version 0.0.1
 */

(function(global) {
    if (global.ZvukHlsDownloader) {
        global.HlsDownloader = global.ZvukHlsDownloader;
        console.log('[HlsDownloader] Aliased to ZvukHlsDownloader (backward compat)');
    }
})(typeof window !== 'undefined' ? window : self);
