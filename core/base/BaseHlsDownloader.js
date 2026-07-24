/**
 * SoundDLib core template module
 * Base class for HLS downloaders
 * @module core/base/BaseHlsDownloader
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class BaseHlsDownloader {
        _referer() { return ''; }

        async _fetchPlaylist(qualityUrl, api) {
            const ref = this._referer();
            const headers = ref ? { 'Referer': ref } : {};
            const resp = await api.runtime.sendMessage({
                action: 'fetchWithRateLimit',
                url: qualityUrl,
                options: { headers }
            });
            if (!resp?.ok)
                throw new Error(`Не удалось загрузить плейлист качества (${resp?.status ?? 'network error'})`);
            return resp;
        }

        _decryptBatch(slice, api, cryptoKey, ivArray, startIdx, total) {
            return Promise.all(slice.map(async (segUrl, j) => {
                const segResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: segUrl });
                if (!segResp?.ok) {
                    throw new Error(
                        `Сегмент ${startIdx + j + 1}/${total} не загрузился (${segResp?.status ?? 'network error'})`
                    );
                }
                return new Uint8Array(await crypto.subtle.decrypt(
                    { name: 'AES-CBC', iv: ivArray }, cryptoKey, new Uint8Array(segResp.data).buffer
                ));
            }));
        }

        _assembleBuffers(buffers) {
            const totalLen = buffers.reduce((s, b) => s + b.length, 0);
            const assembled = new Uint8Array(totalLen);
            let off = 0;
            for (const b of buffers) { assembled.set(b, off); off += b.length; }
            return assembled;
        }

        async download(qualityUrl, api, onProgress) {
            const m3u8Resp = await this._fetchPlaylist(qualityUrl, api);
            const baseUrl = qualityUrl.substring(0, qualityUrl.lastIndexOf('/') + 1);
            const { keyUrl, ivHex, initUrl, segments } = this._parseMediaPlaylist(m3u8Resp.body, baseUrl);

            if (!keyUrl)          throw new Error('HLS-плейлист не содержит EXT-X-KEY — неожиданный формат');
            if (!initUrl)         throw new Error('HLS-плейлист не содержит EXT-X-MAP — неожиданный формат');
            if (!segments.length) throw new Error('HLS-плейлист не содержит сегментов');

            onProgress?.('key', 0, segments.length);
            const keyMaterial = await this._fetchKeyMaterial(keyUrl, api);
            const ivArray = ivHex ? this._hexToUint8Array(ivHex) : new Uint8Array(16);

            const firstSegResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: segments[0] });
            if (!firstSegResp?.ok)
                throw new Error(`Сегмент 1/${segments.length} не загрузился (${firstSegResp?.status ?? 'network error'})`);

            const { cryptoKey, firstSegDecrypted } = await this._resolveKey(
                keyMaterial, ivArray, new Uint8Array(firstSegResp.data)
            );

            onProgress?.('init', 0, segments.length);
            const initResp = await api.runtime.sendMessage({ action: 'fetchBinary', url: initUrl });
            if (!initResp?.ok)
                throw new Error(`Не удалось загрузить init-сегмент (${initResp?.status ?? 'network error'})`);

            const initData = await this._processInitSegment(new Uint8Array(initResp.data), cryptoKey, ivArray);
            const buffers = [initData, firstSegDecrypted];

            const BATCH = 5;
            for (let start = 1; start < segments.length; start += BATCH) {
                onProgress?.('segment', start, segments.length);
                const slice = segments.slice(start, start + BATCH);
                buffers.push(...await this._decryptBatch(slice, api, cryptoKey, ivArray, start, segments.length));
            }

            return { data: this._assembleBuffers(buffers).buffer, mimeType: 'audio/mp4' };
        }

        _fetchKeyMaterial(_keyUrl, _api) {
            throw new Error('BaseHlsDownloader._fetchKeyMaterial() must be implemented');
        }

        _resolveKey(_keyMaterial, _ivArray, _firstSegBytes) {
            throw new Error('BaseHlsDownloader._resolveKey() must be implemented');
        }

        async _processInitSegment(initRaw, cryptoKey, ivArray) {
            if (initRaw.length % 16 === 0 && initRaw.length >= 16) {
                try {
                    const dec = await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivArray }, cryptoKey, initRaw.buffer
                    );
                    return new Uint8Array(dec);
                } catch {}
            }
            return initRaw;
        }

        _parseMediaPlaylist(text, baseUrl) {
            const lines = text.split('\n').map(l => l.trim());
            let keyUrl = '', ivHex = '', initUrl = '';
            const segments = [];
            for (const line of lines) {
                if (line.startsWith('#EXT-X-KEY:')) {
                    const km = line.match(/URI="([^"]+)"/);
                    const im = line.match(/IV=(?:0x)?([0-9a-f]+)/i);
                    if (km) [, keyUrl] = km;
                    if (im) [, ivHex] = im;
                } else if (line.startsWith('#EXT-X-MAP:')) {
                    const mm = line.match(/URI="([^"]+)"/);
                    if (mm) { const [, u] = mm; initUrl = /^https?:\/\//.test(u) ? u : baseUrl + u; }
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

    global.BaseHlsDownloader = BaseHlsDownloader;
    console.log('[BaseHlsDownloader] Loaded');
})(typeof window !== 'undefined' ? window : self);
