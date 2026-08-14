/**
 * SoundDLib — Яндекс.Музыка service
 * @module services/yandex/YandexService
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const HOST_RE = /(?:^|\.)music\.yandex\.(?:ru|com|by|kz|ua)$/;
    const PLAYLIST_RE = new RegExp(
        'music\\.yandex\\.(?:ru|com|by|kz|ua)\\/' +
        '(?:album\\/\\d+|users\\/[^/?#]+\\/playlists\\/\\d+|artist\\/\\d+(?:\\/tracks)?)' +
        '(?:[/?#]|$)'
    );
    const TRACK_RE = /\/album\/\d+\/track\/(\d+)/;
    const ALBUM_RE = /\/album\/(\d+)/;
    const USER_PLAYLIST_RE = /\/users\/([^/?#]+)\/playlists\/(\d+)/;
    const ARTIST_RE = /\/artist\/(\d+)/;

    class YandexService extends global.BaseAudioService {
        constructor() {
            super(global.yandexConfig);
        }

        static matches(url) {
            try { return HOST_RE.test(new URL(url).hostname); }
            catch { return false; }
        }

        static isPlaylistPage(url) {
            if (TRACK_RE.test(url)) return false;
            return PLAYLIST_RE.test(url);
        }

        extractPlaylistId(url) {
            const album = url.match(ALBUM_RE);
            if (album) return `album:${album[1]}`;

            const pl = url.match(USER_PLAYLIST_RE);
            if (pl) return `playlist:${pl[1]}:${pl[2]}`;

            const artist = url.match(ARTIST_RE);
            if (artist) return `artist:${artist[1]}`;

            return null;
        }

        extractTrackId(url) {
            const m = url.match(TRACK_RE);
            return m ? m[1] : null;
        }

        static get capturePatterns() { return []; }

        static captureFromUrl(_url, _text) { return null; }

        getAudioData(trackEntry, _options, api, onProgress) {
            const audioUrl = trackEntry.url || trackEntry.streamUrl;
            if (!audioUrl) throw new Error('YandexService.getAudioData: нет URL трека');
            return this._fetchBinary(audioUrl, api, onProgress);
        }

        async getTrackBuffer(track, api, onSegment) {
            onSegment?.('key', 0, 1);
            const resolved = await api.runtime.sendMessage({
                action: 'resolveYandexStreamUrl',
                trackId: String(track.id)
            });
            if (!resolved?.ok)
                throw new Error(resolved?.error || `Не удалось получить URL трека ${track.id}`);

            onSegment?.('download', 0, 1);
            const resp = await api.runtime.sendMessage({
                action: 'fetchAudioTrack',
                url: resolved.url
            });
            if (!resp?.ok) throw new Error(`Не удалось скачать трек ${track.id} (${resp?.status ?? resp?.error})`);
            onSegment?.('download', 1, 1);
            return { buffer: new Uint8Array(resp.data).buffer, mimeType: resp.mimeType || 'audio/mpeg' };
        }

        async _fetchBinary(url, api, onProgress) {
            onProgress?.('download', 0, 1);
            const resp = await api.runtime.sendMessage({ action: 'fetchAudioTrack', url });
            if (!resp?.ok) throw new Error(`Ошибка скачивания (${resp?.status ?? resp?.error})`);
            onProgress?.('download', 1, 1);
            return { data: new Uint8Array(resp.data).buffer, mimeType: resp.mimeType || 'audio/mpeg' };
        }

        async fetchTrackMeta(trackId) {
            const data = await this.apiFetch(
                `${this.config.apiUrl}/handlers/track.jsx?track=${trackId}&lang=ru`
            );
            return this._normalizeTrack(data?.track || data);
        }

        fetchPlaylistMeta(playlistId) {
            const [type, ...parts] = playlistId.split(':');
            if (type === 'album')    return this._fetchAlbumMeta(playlistId, parts[0]);
            if (type === 'playlist') return this._fetchUserPlaylistMeta(playlistId, parts[0], parts[1]);
            if (type === 'artist')   return this._fetchArtistMeta(playlistId, parts[0]);
            return { id: playlistId, title: 'Плейлист', cover: null, trackCount: null };
        }

        async _fetchAlbumMeta(playlistId, albumId) {
            const data = await this.apiFetch(
                `${this.config.apiUrl}/handlers/album.jsx?album=${albumId}&lang=ru`
            );
            return {
                id: playlistId,
                title: data?.title || `Альбом ${albumId}`,
                cover: data?.coverUri ? `https://${data.coverUri.replace('%%', '400x400')}` : null,
                trackCount: data?.trackCount ?? null
            };
        }

        async _fetchUserPlaylistMeta(playlistId, owner, kind) {
            const data = await this.apiFetch(
                `${this.config.apiUrl}/handlers/playlist.jsx?owner=${owner}&kinds=${kind}&lang=ru`
            );
            const pl = data?.playlist || data;
            return {
                id: playlistId,
                title: pl?.title || 'Плейлист',
                cover: pl?.ogImage ? `https://${pl.ogImage.replace('%%', '400x400')}` : null,
                trackCount: pl?.trackCount ?? null
            };
        }

        async _fetchArtistMeta(playlistId, artistId) {
            const data = await this.apiFetch(
                `${this.config.apiUrl}/handlers/artist.jsx?artist=${artistId}&what=tracks&lang=ru`
            );
            return {
                id: playlistId,
                title: data?.artist?.name || `Исполнитель ${artistId}`,
                cover: data?.artist?.ogImage
                    ? `https://${data.artist.ogImage.replace('%%', '400x400')}`
                    : null,
                trackCount: null
            };
        }

        async fetchAllPlaylistTracks(playlistId, onProgress) {
            const [type, ...parts] = playlistId.split(':');

            if (type === 'album') {
                const data = await this.apiFetch(
                    `${this.config.apiUrl}/handlers/album.jsx?album=${parts[0]}&lang=ru`
                );
                const volumes = data?.volumes ?? [];
                const tracks = volumes.flatMap(v => v.map(t => this._normalizeTrack(t)));
                if (onProgress) onProgress(tracks.length, tracks.length);
                return tracks;
            }

            if (type === 'playlist') {
                const [owner, kind] = parts;
                const data = await this.apiFetch(
                    `${this.config.apiUrl}/handlers/playlist.jsx?owner=${owner}&kinds=${kind}&lang=ru`
                );
                const pl = data?.playlist || data;
                const rawTracks = pl?.tracks ?? [];
                const tracks = rawTracks.map(item => this._normalizeTrack(item.track || item));
                if (onProgress) onProgress(tracks.length, tracks.length);
                return tracks;
            }

            if (type === 'artist') {
                const tracks = [];
                let page = 0;
                const PAGE_SIZE = 20;
                do {
                    const data = await this.apiFetch(
                        `${this.config.apiUrl}/handlers/artist.jsx?artist=${parts[0]}&what=tracks&lang=ru&page=${page}`
                    );
                    const batch = data?.tracks ?? [];
                    for (const t of batch) tracks.push(this._normalizeTrack(t));
                    if (onProgress) onProgress(tracks.length, null);
                    if (batch.length < PAGE_SIZE) break;
                    page += 1;
                    await this.delay(150);
                } while (true);
                return tracks;
            }

            return [];
        }

        _normalizeTrack(raw) {
            if (!raw) return null;
            const artists = Array.isArray(raw.artists)
                ? raw.artists.map(a => a.name || a.title || '').filter(Boolean).join(', ')
                : (raw.artist || '');
            const albumObj = Array.isArray(raw.albums) ? raw.albums[0] : (raw.album ?? null);
            let cover = null;
            if (raw.coverUri)
                cover = `https://${raw.coverUri.replace('%%', '400x400')}`;
            else if (albumObj?.coverUri)
                cover = `https://${albumObj.coverUri.replace('%%', '400x400')}`;
            else if (albumObj?.ogImage)
                cover = `https://${albumObj.ogImage.replace('%%', '400x400')}`;
            return {
                id: String(raw.id),
                title: raw.title || 'Unknown',
                artist: artists || 'Unknown',
                album: albumObj?.title || '',
                duration: raw.durationMs ? Math.round(raw.durationMs / 1000) : 0,
                cover,
                streamUrl: null
            };
        }
    }

    global.YandexService = YandexService;
    if (global.serviceRegistry) global.serviceRegistry.register(YandexService);
    console.log('[YandexService] Loaded');
})(typeof window !== 'undefined' ? window : self);
