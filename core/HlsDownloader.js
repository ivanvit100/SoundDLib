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

            console.log('[HlsDownloader] keyUrl:', keyUrl);
            console.log('[HlsDownloader] ivHex:', ivHex || '(empty — will use zero IV)');
            console.log('[HlsDownloader] initUrl:', initUrl);
            console.log('[HlsDownloader] segments:', segments.length, segments[0]);

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

            const ivArray = ivHex
                ? this._hexToUint8Array(ivHex)
                : new Uint8Array(16);
            console.log('[HlsDownloader] IV bytes:', ivArray.length, Array.from(ivArray).map(b => b.toString(16).padStart(2,'0')).join(''));

            const firstSegResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: segments[0] });
            if (!firstSegResp?.ok)
                throw new Error(`Сегмент 1/${segments.length} не загрузился (${firstSegResp?.status ?? 'network error'})`);

            const { cryptoKey, firstSegDecrypted } = await this._findKey(
                new Uint8Array(keyResp.data), keyResp.xekValue ?? '', ivArray,
                new Uint8Array(firstSegResp.data), keyResp.source
            );

            onProgress?.('init', 0, segments.length);
            const initResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: initUrl });
            if (!initResp?.ok)
                throw new Error(`Не удалось загрузить init-сегмент (${initResp?.status ?? 'network error'})`);

            const initRaw = new Uint8Array(initResp.data);
            let initData = initRaw;
            if (initRaw.length % 16 === 0 && initRaw.length >= 16) {
                try {
                    const dec = await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivArray }, cryptoKey, initRaw.buffer
                    );
                    initData = new Uint8Array(dec);
                } catch {}
            }

            const buffers = [initData, firstSegDecrypted];

            const BATCH = 5;
            for (let start = 1; start < segments.length; start += BATCH) {
                onProgress?.('segment', start, segments.length);
                const slice = segments.slice(start, start + BATCH);
                const decryptedBatch = await Promise.all(slice.map(async (segUrl, j) => {
                    const segResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: segUrl });
                    if (!segResp?.ok)
                        throw new Error(`Сегмент ${start + j + 1}/${segments.length} не загрузился (${segResp?.status ?? 'network error'})`);
                    return new Uint8Array(await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivArray },
                        cryptoKey,
                        new Uint8Array(segResp.data).buffer
                    ));
                }));
                buffers.push(...decryptedBatch);
            }

            const totalLen = buffers.reduce((s, b) => s + b.length, 0);
            const assembled = new Uint8Array(totalLen);
            let off = 0;
            for (const b of buffers) { assembled.set(b, off); off += b.length; }

            return { data: assembled.buffer, mimeType: 'audio/mp4' };
        }

        async _findKey(rawBytes, xekValue, ivArray, firstSegBytes, source) {
            const candidates = source === 'spy'
                ? [rawBytes]
                : this._deriveKeyCandidates(rawBytes, xekValue);

            for (let i = 0; i < candidates.length; i++) {
                try {
                    const key = await crypto.subtle.importKey(
                        'raw', candidates[i], { name: 'AES-CBC' }, false, ['decrypt']
                    );
                    const decrypted = await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivArray }, key, firstSegBytes.buffer
                    );
                    console.log('[HlsDownloader] key transform #' + i + ' succeeded');
                    return { cryptoKey: key, firstSegDecrypted: new Uint8Array(decrypted) };
                } catch {}
            }
            throw new Error('Не удалось подобрать ключ расшифровки — попробуйте воспроизвести трек перед скачиванием.');
        }

        _deriveKeyCandidates(rawBytes, xekValue) {
            if (xekValue) {
                const decrypted = this._decryptZvukKey(rawBytes, xekValue);
                if (decrypted) return [decrypted];
            }
            return [new Uint8Array(rawBytes)];
        }

        _decryptZvukKey(rawBytes, salt) {
            try {
                const keyBytes = Uint8Array.from(
                    atob('VDR2TnFLOHNSMnBIY1o2bUw5eFdqRDN5RjdnQnFBMXQ='),
                    c => c.charCodeAt(0)
                );
                const saltBytes = new TextEncoder().encode(salt);
                const combined = new Uint8Array(keyBytes.length + saltBytes.length);
                combined.set(keyBytes, 0);
                combined.set(saltBytes, keyBytes.length);

                let seed = this._fnv1a64(combined);
                const result = new Uint8Array(rawBytes.length);
                for (let i = 0; i < rawBytes.length; i++) {
                    seed = this._xorshift64Star((seed ^ BigInt(i)) & 0xffffffffffffffffn);
                    const r = Number(seed >> 56n & 255n);
                    const rot = Number(7n & seed);
                    result[i] = (this._ror8(rawBytes[i], rot) - r + 256) & 255;
                    seed ^= BigInt(rawBytes[i]);
                }
                return result;
            } catch {
                return null;
            }
        }

        _fnv1a64(buf) {
            let h = 0xcbf29ce484222325n;
            for (let i = 0; i < buf.length; i++) {
                h ^= BigInt(buf[i]);
                h = 1099511628211n * h & 0xffffffffffffffffn;
            }
            h = (h + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
            h ^= h >> 30n;
            h = 0xbf58476d1ce4e5b9n * h & 0xffffffffffffffffn;
            h ^= h >> 27n;
            h = 0x94d049bb133111ebn * h & 0xffffffffffffffffn;
            return 0xffffffffffffffffn & (h ^= h >> 31n);
        }

        _xorshift64Star(e) {
            e ^= e >> 12n & 0xffffffffffffffffn;
            e ^= e << 25n & 0xffffffffffffffffn;
            return 0x2545f4914f6cdd1dn * (e ^= e >> 27n & 0xffffffffffffffffn) & 0xffffffffffffffffn;
        }

        _ror8(v, r) { r &= 7; return ((v >>> r) | (v << (8 - r))) & 255; }

        _parseMediaPlaylist(text, baseUrl) {
            const lines = text.split('\n').map(l => l.trim());
            let keyUrl = '', ivHex = '', initUrl = '';
            const segments = [];

            for (const line of lines) {
                if (line.startsWith('#EXT-X-KEY:')) {
                    console.log('[HlsDownloader] EXT-X-KEY:', line);
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
