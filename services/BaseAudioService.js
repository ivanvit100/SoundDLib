/**
 * SoundDLib service module
 * Base class for audio streaming services
 * @module services/BaseAudioService
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class BaseAudioService {
        constructor(config) {
            this.config = config;
            this.name = config.name;
            this.color = config.color || '#22c375';
            this.logo = config.logo || 'icons/logo1.png';
            console.log(`[BaseAudioService] Created: ${this.name}`);
        }

        get extensionApi() {
            return typeof global.getExtensionApi === 'function'
                ? global.getExtensionApi()
                : (global.chrome || global.browser || null);
        }

        static matches(_url) {
            throw new Error('matches() must be implemented');
        }

        static isPlaylistPage(_url) {
            return false;
        }

        extractPlaylistId(_url) {
            return null;
        }

        extractTrackId(_url) {
            return null;
        }

        static get capturePatterns() { return []; }

        static captureFromUrl(_url, _text) { return null; }

        getAudioData(_trackEntry, _options, _api, _onProgress) {
            throw new Error(`${this.name}: getAudioData() not implemented`);
        }

        fetchTrackMeta(_trackId) {
            throw new Error('fetchTrackMeta() must be implemented');
        }

        fetchPlaylistMeta(_playlistId) {
            throw new Error('fetchPlaylistMeta() must be implemented');
        }

        fetchAllPlaylistTracks(_playlistId, _onProgress) {
            throw new Error('fetchAllPlaylistTracks() must be implemented');
        }

        async apiFetch(url, options = {}) {
            const opts = {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                ...options,
                headers: { ...this.config.headers, ...(options.headers || {}) }
            };

            const response = await this.extensionApi.runtime.sendMessage({
                action: 'fetchWithRateLimit',
                url,
                options: opts
            });

            if (!response?.ok)
                throw new Error(`API error ${response?.status}: ${url}`);

            return JSON.parse(response.body);
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    global.BaseAudioService = BaseAudioService;
    console.log('[BaseAudioService] Loaded');
})(typeof window !== 'undefined' ? window : self);
