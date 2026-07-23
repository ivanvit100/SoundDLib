/**
 * SoundDLib — zvuk.com service
 * @module services/zvuk/ZvukService
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const GQL_PLAYLIST_TRACKS = `
query getPlaylistTracks($id: ID!, $limit: Int = 30, $offset: Int = 0) {
  playlistTracks(id: $id, limit: $limit, offset: $offset) {
    id title duration hasFlac explicit availability zchan
    artists { id title image { src } }
    release { id title image { src } }
  }
}`.trim();

    const GQL_PLAYLIST_META = `
query getPlaylist($id: ID!) {
  playlist(id: $id) {
    id title tracksCount
    image { src }
  }
}`.trim();

    const PAGE_LIMIT = 30;

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

        async graphqlFetch(query, variables, operationName) {
            return this.apiFetch(this.config.graphqlUrl, {
                method: 'POST',
                body: JSON.stringify({ query, variables, operationName }),
                headers: { 'content-type': 'application/json' }
            });
        }

        async fetchTrackMeta(trackId) {
            const data = await this.apiFetch(`${this.config.apiUrl}/track/${trackId}`);
            return this._normalizeTrackRest(data.result ?? data);
        }

        async fetchPlaylistMeta(playlistId) {
            const data = await this.graphqlFetch(
                GQL_PLAYLIST_META,
                { id: String(playlistId) },
                'getPlaylist'
            );
            const p = data?.data?.playlist ?? {};
            return {
                id: p.id ?? playlistId,
                title: p.title ?? 'Плейлист',
                cover: p.image?.src?.replace('{size}', 'large') ?? null,
                trackCount: p.tracksCount ?? null
            };
        }

        async fetchAllPlaylistTracks(playlistId, onProgress) {
            const tracks = [];
            let offset = 0;

            do {
                const data = await this.graphqlFetch(
                    GQL_PLAYLIST_TRACKS,
                    { id: String(playlistId), limit: PAGE_LIMIT, offset },
                    'getPlaylistTracks'
                );
                const batch = data?.data?.playlistTracks ?? [];

                for (const t of batch)
                    tracks.push(this._normalizeTrackGql(t));

                offset += batch.length;
                if (onProgress) onProgress(tracks.length, null);

                if (batch.length === 0) break;
                await this.delay(150);
            } while (true);

            return tracks;
        }

        _normalizeTrackGql(raw) {
            const artist = Array.isArray(raw.artists)
                ? raw.artists.map(a => a.title).join(', ')
                : '';
            const cover = raw.release?.image?.src?.replace('{size}', 'large')
                ?? raw.artists?.[0]?.image?.src?.replace('{size}', 'large')
                ?? null;
            return {
                id: String(raw.id),
                title: raw.title ?? 'Unknown',
                artist: artist || 'Unknown',
                album: raw.release?.title ?? '',
                duration: raw.duration ?? 0,
                cover,
                streamUrl: null
            };
        }

        _normalizeTrackRest(raw) {
            const artists = Array.isArray(raw.artists)
                ? raw.artists.map(a => a.name ?? a).join(', ')
                : (raw.artist ?? '');
            return {
                id: raw.id,
                title: raw.title ?? raw.name ?? 'Unknown',
                artist: artists || 'Unknown',
                album: raw.release?.title ?? raw.album ?? '',
                duration: raw.duration ?? 0,
                cover: this._coverUrlRest(raw),
                streamUrl: raw.stream ?? raw.stream_url ?? raw.audio ?? null
            };
        }

        _coverUrlRest(raw) {
            for (const v of [raw.image, raw.cover, raw.release?.image]) {
                if (typeof v === 'string' && v.startsWith('http')) return v;
            }
            if (raw.release?.image && raw.release?.id)
                return `https://cdn-image.zvuk.com/pic?hash=${raw.release.image}&id=${raw.release.id}&size=large&type=release`;
            if (raw.image && raw.id)
                return `https://cdn-image.zvuk.com/pic?hash=${raw.image}&id=${raw.id}&size=large&type=track`;
            return null;
        }
    }

    global.ZvukService = ZvukService;
    if (global.serviceRegistry) global.serviceRegistry.register(ZvukService);
    console.log('[ZvukService] Loaded');
})(typeof window !== 'undefined' ? window : self);
