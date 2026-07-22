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

        async downloadAll(tracks, format, converter, service) {
            this._controller = this._createController();
            const total = tracks.length;
            const api = typeof global.getExtensionApi === 'function'
                ? global.getExtensionApi()
                : (global.chrome || global.browser);
            const formatMeta = global.ConverterRegistry.getMeta(format);

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
                    const { buffer: inputBuffer, mimeType: inputMimeType } =
                        await this._fetchTrackBuffer(track, service, api);

                    this.eventBus.emit('download:progress', {
                        message: `Конвертация ${i + 1}/${total}...`,
                        percent: Math.floor((i / total) * 80) + 5
                    });

                    const outputBuffer = await converter.convert(inputBuffer, inputMimeType, format, () => {});

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

        async downloadAllAsZip(tracks, format, converter, title, service) {
            this._controller = this._createController();
            const total = tracks.length;
            const api = typeof global.getExtensionApi === 'function'
                ? global.getExtensionApi()
                : (global.chrome || global.browser);
            const formatMeta = global.ConverterRegistry.getMeta(format);
            const zipName = `${(title || 'playlist').replace(/[/\\?%*:|"<>]/g, '_')}.zip`;

            let writable = null;
            if (typeof showSaveFilePicker !== 'undefined') {
                try {
                    const handle = await showSaveFilePicker({
                        suggestedName: zipName,
                        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }]
                    });
                    writable = await handle.createWritable();
                } catch {
                    return { done: 0, failed: 0, total, cancelled: true };
                }
            }

            const { Zip, ZipDeflate } = global.fflate;
            const pendingChunks = [];
            const zip = new Zip((err, chunk) => { if (!err) pendingChunks.push(chunk); });

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
                    const { buffer: inputBuffer, mimeType: inputMimeType } =
                        await this._fetchTrackBuffer(track, service, api);

                    this.eventBus.emit('download:progress', {
                        message: `Конвертация ${i + 1}/${total}...`,
                        percent: Math.floor((i / total) * 80) + 5
                    });

                    const outputBuffer = await converter.convert(inputBuffer, inputMimeType, format, () => {});

                    const idx = String(i + 1).padStart(2, '0');
                    const filename = this._buildFilename(idx, track, formatMeta.ext);
                    const deflate = new ZipDeflate(filename, { level: 0 });
                    zip.add(deflate);
                    deflate.push(new Uint8Array(outputBuffer), true);

                    if (writable && pendingChunks.length) {
                        for (const c of pendingChunks.splice(0)) await writable.write(c);
                    }

                    done++;
                } catch (error) {
                    console.error(`[PlaylistManager] Track ${i + 1} failed:`, error);
                    failed++;
                }

                await this._delay(300);
            }

            zip.end();

            if (writable) {
                for (const c of pendingChunks) await writable.write(c);
                await writable.close();
            } else {
                const blob = new Blob(pendingChunks, { type: 'application/zip' });
                this._saveFile(blob, zipName);
            }

            global.DownloadHistory.add({
                service: 'zvuk',
                title: `Плейлист ZIP (${done}/${total} треков)`,
                format,
                failed
            });

            this.eventBus.emit('download:completed', { done, failed, total });
            return { done, failed, total };
        }

        async _fetchTrackBuffer(track, service, api) {
            if (track.streamUrl) {
                const resp = await api.runtime.sendMessage({ action: 'fetchAudioTrack', url: track.streamUrl });
                if (!resp?.ok) throw new Error(resp?.error || `HTTP error`);
                return { buffer: new Uint8Array(resp.data).buffer, mimeType: resp.mimeType };
            }

            const probe = await api.runtime.sendMessage({
                action: 'resolveCdnUrl',
                zvukId: String(track.id)
            });
            if (!probe?.ok)
                throw new Error(probe?.error || `CDN probe failed for track ${track.id}`);

            const qualities = (probe.qualities || []).sort((a, b) => b.bandwidth - a.bandwidth);
            const best = qualities[0];
            if (!best) throw new Error(`No stream quality for track ${track.id}`);

            const result = await service.getAudioData(
                { type: 'hls', masterUrl: probe.masterUrl, qualities: probe.qualities },
                { qualityUrl: best.url },
                api,
                () => {}
            );
            return { buffer: result.data, mimeType: result.mimeType };
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
