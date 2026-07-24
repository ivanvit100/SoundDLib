/**
 * SoundDLib services module
 * HLS downloader for Zvuk service
 * @module services/zvuk/ZvukHlsDownloader
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    class ZvukHlsDownloader extends global.BaseHlsDownloader {
        _referer() { return 'https://zvuk.com/'; }

        async _fetchKeyMaterial(keyUrl, api) {
            console.log('[ZvukHlsDownloader] keyUrl:', keyUrl);
            const keyResp = await api.runtime.sendMessage({ action: 'fetchKeyFromTab', url: keyUrl });
            if (!keyResp?.ok) {
                const status = keyResp?.status;
                let hint = '';
                if (status === 400)
                    hint = ' Сначала воспроизведите трек в браузере — расширению нужен токен от нативного плеера.';
                else if (status === 401 || status === 403)
                    hint = ' Требуется авторизация — войдите в аккаунт на zvuk.com.';
                throw new Error(`Не удалось получить ключ расшифровки (${status ?? keyResp?.error}).${hint}`);
            }
            console.log('[ZvukHlsDownloader] key source:', keyResp.source);
            return keyResp;
        }

        _resolveKey(keyMaterial, ivArray, firstSegBytes) {
            console.log('[ZvukHlsDownloader] IV bytes:', ivArray.length,
                Array.from(ivArray).map(b => b.toString(16).padStart(2,'0')).join(''));
            return this._findKey(
                new Uint8Array(keyMaterial.data), keyMaterial.xekValue ?? '',
                ivArray, firstSegBytes, keyMaterial.source
            );
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
                    console.log(`[ZvukHlsDownloader] key transform #${  i  } succeeded`);
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
            } catch { return null; }
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

        _xorshift64Star(val) {
            let e = val;
            e ^= e >> 12n & 0xffffffffffffffffn;
            e ^= e << 25n & 0xffffffffffffffffn;
            return 0x2545f4914f6cdd1dn * (e ^= e >> 27n & 0xffffffffffffffffn) & 0xffffffffffffffffn;
        }

        _ror8(v, rot) { const r = rot & 7; return ((v >>> r) | (v << (8 - r))) & 255; }
    }

    global.ZvukHlsDownloader = ZvukHlsDownloader;
    console.log('[ZvukHlsDownloader] Loaded');
})(typeof window !== 'undefined' ? window : self);
