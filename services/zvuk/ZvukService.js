/**
 * SoundDLib — zvuk.com service
 * API endpoints derived from network inspection of zvuk.com
 * @module services/zvuk/ZvukService
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const PAGE_LIMIT = 50;

    class ZvukService extends global.BaseAudioService {
        constructor() {
            super(global.zvukConfig);
        }

        static matches(url) {
            try { return /(?:^|\.)zvuk\.com$/.test(new URL(url).hostname); }
            catch { return false; }
        }

        static isPlaylistPage(url) {
            return /zvuk\.com\/(playlist|collection)\/\d+/.test(url);
        }

        extractPlaylistId(url) {
            const m = url.match(/\/(playlist|collection)\/(\d+)/);
            return m ? m[2] : null;
        }

        extractTrackId(url) {
            const m = url.match(/\/track\/(\d+)/);
            return m ? m[1] : null;
        }

        static get capturePatterns() {
            return ['*://cdn-hls-slicer.zvuk.com/drm/track/*/master.m3u8*'];
        }

        static captureFromUrl(url, text) {
            if (!text.startsWith('#EXTM3U') || !text.includes('#EXT-X-STREAM-INF')) return null;
            const qualities = ZvukService.parseMasterPlaylist(text, url);
            if (!qualities.length) return null;
            return {
                type: 'hls',
                serviceName: 'zvuk',
                mimeType: 'audio/mp4',
                url,
                masterUrl: url,
                qualities,
                meta: {}
            };
        }

        static parseMasterPlaylist(text, masterUrl) {
            const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            const qualities = [];

            for (let i = 0; i < lines.length; i++) {
                if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
                const bw = parseInt(
                    lines[i].match(/AVERAGE-BANDWIDTH=(\d+)/)?.[1] ||
                    lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || '0'
                );
                const codecs = lines[i].match(/CODECS="([^"]+)"/)?.[1] || '';
                const next = lines[i + 1];
                if (next && !next.startsWith('#')) {
                    const url = /^https?:\/\//.test(next) ? next : base + next;
                    qualities.push({ bandwidth: bw, codecs, url, label: ZvukService.qualityLabel(bw, codecs) });
                    i++;
                }
            }
            return qualities;
        }

        static qualityLabel(bandwidth, codecs) {
            if (codecs.toLowerCase().includes('flac')) return 'Lossless FLAC';
            const kbps = Math.round(bandwidth / 1000);
            if (kbps < 100) return `LQ · ${kbps} kbps`;
            if (kbps < 200) return `MQ · ${kbps} kbps`;
            return `HQ · ${kbps} kbps`;
        }

        getAudioData(trackEntry, { qualityUrl }, api, onProgress) {
            if (trackEntry.type !== 'hls' || !qualityUrl)
                throw new Error('ZvukService.getAudioData: HLS trackEntry and qualityUrl required');
            const downloader = new global.HlsDownloader();
            return downloader.download(qualityUrl, api, onProgress);
        }

        async fetchTrackMeta(trackId) {
            const data = await this.apiFetch(
                `${this.config.apiUrl}/track/${trackId}`
            );
            return this._normalizeTrack(data.result ?? data);
        }

        async fetchPlaylistMeta(playlistId) {
            const data = await this.apiFetch(
                `${this.config.apiUrl}/playlist/${playlistId}`
            );
            const p = data.result ?? data;
            return {
                id: p.id,
                title: p.title ?? p.name ?? 'Плейлист',
                cover: p.image ?? p.cover ?? null,
                trackCount: p.tracks_count ?? p.trackCount ?? null
            };
        }

        async fetchAllPlaylistTracks(playlistId, onProgress) {
            const tracks = [];
            let offset = 0;
            let total = null;

            do {
                const data = await this.apiFetch(
                    `${this.config.apiUrl}/playlist/${playlistId}/tracks` +
                    `?offset=${offset}&limit=${PAGE_LIMIT}`
                );

                const result = data.result ?? data;
                const batch = Array.isArray(result.tracks)
                    ? result.tracks
                    : Array.isArray(result) ? result : [];

                if (total === null)
                    total = result.total ?? result.tracks_count ?? batch.length;

                for (const t of batch)
                    tracks.push(this._normalizeTrack(t));

                offset += batch.length;
                if (onProgress) onProgress(tracks.length, total);

                if (batch.length < PAGE_LIMIT) break;
                await this.delay(150);
            } while (tracks.length < total);

            return tracks;
        }

        _normalizeTrack(raw) {
            const artists = Array.isArray(raw.artists)
                ? raw.artists.map(a => a.name ?? a).join(', ')
                : (raw.artist ?? '');

            return {
                id: raw.id,
                title: raw.title ?? raw.name ?? 'Unknown',
                artist: artists || 'Unknown',
                album: raw.release?.title ?? raw.album ?? '',
                duration: raw.duration ?? 0,
                cover: raw.image ?? raw.cover ?? raw.release?.image ?? null,
                streamUrl: raw.stream ?? raw.stream_url ?? raw.audio ?? null
            };
        }
    }

    global.ZvukService = ZvukService;
    if (global.serviceRegistry) global.serviceRegistry.register(ZvukService);
    console.log('[ZvukService] Loaded');
})(typeof window !== 'undefined' ? window : self);
