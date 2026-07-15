/**
 * SoundDLib core module
 * Downloads and decrypts an HLS stream.
 * @module core/HlsDownloader
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class HlsDownloader {
        async download(qualityUrl, api, onProgress) {
            const m3u8Resp = await api.runtime.sendMessage({
                action: 'fetchWithRateLimit',
                url: qualityUrl,
                options: { headers: { 'Referer': 'https://zvuk.com/' } }
            });
            if (!m3u8Resp?.ok)
                throw new Error(`Не удалось загрузить плейлист качества (${m3u8Resp?.status ?? 'network error'})`);

            const baseUrl = qualityUrl.substring(0, qualityUrl.lastIndexOf('/') + 1);
            const { keyUrl, ivHex, initUrl, segments } = this._parseMediaPlaylist(m3u8Resp.body, baseUrl);

            if (!keyUrl)    throw new Error('HLS-плейлист не содержит EXT-X-KEY — неожиданный формат');
            if (!initUrl)   throw new Error('HLS-плейлист не содержит EXT-X-MAP — неожиданный формат');
            if (!segments.length) throw new Error('HLS-плейлист не содержит сегментов');

            onProgress?.('key', 0, segments.length);
            const keyResp = await api.runtime.sendMessage({ action: 'fetchKeyFromTab', url: keyUrl });
            if (!keyResp?.ok) {
                const status = keyResp?.status;
                const hint = status === 400
                    ? ' Сначала воспроизведите трек в браузере — расширению нужен токен от нативного плеера.'
                    : (status === 401 || status === 403)
                        ? ' Требуется авторизация — войдите в аккаунт на zvuk.com.'
                        : '';
                throw new Error(`Не удалось получить ключ расшифровки (${status ?? keyResp?.error}).${hint}`);
            }

            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                new Uint8Array(keyResp.data).buffer,
                { name: 'AES-CBC' },
                false,
                ['decrypt']
            );
            const ivArray = this._hexToUint8Array(ivHex);

            onProgress?.('init', 0, segments.length);
            const initResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: initUrl });
            if (!initResp?.ok)
                throw new Error(`Не удалось загрузить init-сегмент (${initResp?.status ?? 'network error'})`);

            const buffers = [new Uint8Array(initResp.data)];

            for (let i = 0; i < segments.length; i++) {
                onProgress?.('segment', i, segments.length);

                const segResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: segments[i] });
                if (!segResp?.ok)
                    throw new Error(`Сегмент ${i + 1}/${segments.length} не загрузился (${segResp?.status ?? 'network error'})`);

                const decrypted = await crypto.subtle.decrypt(
                    { name: 'AES-CBC', iv: ivArray },
                    cryptoKey,
                    new Uint8Array(segResp.data).buffer
                );
                buffers.push(new Uint8Array(decrypted));
            }

            const totalLen = buffers.reduce((s, b) => s + b.length, 0);
            const assembled = new Uint8Array(totalLen);
            let off = 0;
            for (const b of buffers) { assembled.set(b, off); off += b.length; }

            return { data: assembled.buffer, mimeType: 'audio/mp4' };
        }

        _parseMediaPlaylist(text, baseUrl) {
            const lines = text.split('\n').map(l => l.trim());
            let keyUrl = '', ivHex = '', initUrl = '';
            const segments = [];

            for (const line of lines) {
                if (line.startsWith('#EXT-X-KEY:')) {
                    const km = line.match(/URI="([^"]+)"/);
                    const im = line.match(/IV=(?:0x)?([0-9a-fA-F]+)/i);
                    if (km) keyUrl = km[1];
                    if (im) ivHex = im[1];
                } else if (line.startsWith('#EXT-X-MAP:')) {
                    const mm = line.match(/URI="([^"]+)"/);
                    if (mm) {
                        const u = mm[1];
                        initUrl = /^https?:\/\//.test(u) ? u : baseUrl + u;
                    }
                } else if (line.length && !line.startsWith('#'))
                    segments.push(/^https?:\/\//.test(line) ? line : baseUrl + line);
            }

            return { keyUrl, ivHex, initUrl, segments };
        }

        _hexToUint8Array(hex) {
            const clean = hex.replace(/^0x/i, '');
            const pairs = clean.match(/.{1,2}/g) || [];
            return new Uint8Array(pairs.map(b => parseInt(b, 16)));
        }
    }

    global.HlsDownloader = HlsDownloader;
    console.log('[HlsDownloader] Loaded');
})(typeof window !== 'undefined' ? window : self);
