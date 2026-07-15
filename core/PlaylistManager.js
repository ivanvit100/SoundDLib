/**
 * SoundDLib core module
 * Manages playlist download
 * @module core/PlaylistManager
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class PlaylistManager {
        constructor() {
            this.eventBus = new global.EventBus();
            this._controller = null;
        }

        async loadPlaylist(service, playlistId) {
            this.eventBus.emit('playlist:discovery', { loaded: 0, total: null });

            const tracks = await service.fetchAllPlaylistTracks(playlistId, (loaded, total) => {
                this.eventBus.emit('playlist:discovery', { loaded, total });
            });

            this.eventBus.emit('playlist:ready', { tracks });
            return tracks;
        }

        async downloadAll(tracks, format, converter) {
            this._controller = this._createController();
            const total = tracks.length;
            const api = typeof global.getExtensionApi === 'function'
                ? global.getExtensionApi()
                : (global.chrome || global.browser);

            this.eventBus.emit('download:started', { total });

            let done = 0;
            let failed = 0;

            for (let i = 0; i < total; i++) {
                await this._controller.waitIfPaused();
                if (this._controller.shouldStop()) break;

                const track = tracks[i];
                const label = [track.artist, track.title].filter(Boolean).join(' — ') || `Трек ${i + 1}`;

                this.eventBus.emit('download:progress', {
                    message: `${i + 1}/${total}: ${label}`,
                    percent: Math.floor((i / total) * 80),
                    trackIndex: i
                });

                try {
                    const audioResp = await api.runtime.sendMessage({
                        action: 'fetchAudioTrack',
                        url: track.streamUrl
                    });

                    if (!audioResp?.ok)
                        throw new Error(audioResp?.error || `HTTP error fetching ${track.streamUrl}`);

                    const inputBuffer = new Uint8Array(audioResp.data).buffer;

                    this.eventBus.emit('download:progress', {
                        message: `Конвертация ${i + 1}/${total}...`,
                        percent: Math.floor((i / total) * 80) + 5
                    });

                    const outputBuffer = await converter.convert(
                        inputBuffer,
                        audioResp.mimeType,
                        format,
                        () => {}
                    );

                    const formatMeta = global.ConverterRegistry.getMeta(format);
                    const idx = String(i + 1).padStart(2, '0');
                    const filename = this._buildFilename(idx, track, formatMeta.ext);
                    const blob = new Blob([outputBuffer], { type: formatMeta.mimeType });
                    this._saveFile(blob, filename);
                    done++;
                } catch (error) {
                    console.error(`[PlaylistManager] Track ${i + 1} failed:`, error);
                    failed++;
                }

                await this._delay(300);
            }

            global.DownloadHistory.add({
                service: 'zvuk',
                title: `Плейлист (${done}/${total} треков)`,
                format,
                failed
            });

            this.eventBus.emit('download:completed', { done, failed, total });
            return { done, failed, total };
        }

        pause()  { this._controller?.pause(); }
        resume() { this._controller?.resume(); }
        stop()   { this._controller?.stop(); }

        _createController() {
            let paused = false;
            let stopped = false;
            return {
                pause:  () => { paused = true; },
                resume: () => { paused = false; },
                stop:   () => { stopped = true; },
                isPaused:   () => paused,
                shouldStop: () => stopped,
                waitIfPaused: async () => {
                    while (paused && !stopped)
                        await new Promise(r => setTimeout(r, 100));
                }
            };
        }

        _buildFilename(idx, track, ext) {
            const parts = [idx, track.artist, track.title].filter(Boolean);
            return `${parts.join(' - ')}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
        }

        _saveFile(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 10000);
        }

        _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    }

    global.PlaylistManager = PlaylistManager;
    console.log('[PlaylistManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
