/**
 * SoundDLib core module
 * Wraps ffmpeg.wasm for audio format conversion
 * @module core/AudioConverter
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const CODEC_ARGS = {
        mp3:  ['-codec:a', 'libmp3lame', '-q:a', '0'],
        flac: ['-codec:a', 'flac'],
        ogg:  ['-codec:a', 'libvorbis', '-q:a', '6'],
        opus: ['-codec:a', 'libopus', '-b:a', '128k'],
        wav:  ['-codec:a', 'pcm_s16le'],
        aac:  ['-codec:a', 'aac', '-b:a', '256k']
    };

    const MIME_TO_EXT = {
        'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
        'audio/flac': 'flac',
        'audio/ogg': 'ogg',
        'audio/opus': 'opus',
        'audio/wav': 'wav', 'audio/wave': 'wav',
        'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a'
    };

    const MIN_VALID_BYTES = 4096;

    class AudioConverter {
        constructor() {
            this._ffmpeg = null;
            this._loadPromise = null;
        }

        _ensureLoaded() {
            if (this._ffmpeg?.isLoaded()) return;
            if (this._loadPromise) return this._loadPromise;

            if (!global.FFmpeg)
                throw new Error('FFmpeg library not loaded. Add lib/ffmpeg.min.js to popup.html');

            const api = typeof global.getExtensionApi === 'function'
                ? global.getExtensionApi()
                : (global.chrome || global.browser);

            const corePath = api?.runtime?.getURL('lib/ffmpeg-core.js');
            this._ffmpeg = global.FFmpeg.createFFmpeg({ corePath, mainName: 'main', log: true });

            this._loadPromise = this._ffmpeg.load().then(() => {
                this._loadPromise = null;
                console.log('[AudioConverter] ffmpeg.wasm loaded');
            });

            return this._loadPromise;
        }

        async convert(inputBuffer, inputMimeType, outputFormat, onProgress) {
            await this._ensureLoaded();

            if (!inputBuffer || inputBuffer.byteLength < MIN_VALID_BYTES) {
                throw new Error(
                    `Аудиоданные слишком маленькие (${inputBuffer?.byteLength ?? 0} байт). ` +
                    `Возможно, захват не удался — попробуйте снова.`
                );
            }

            const bytes = new Uint8Array(inputBuffer);

            if (bytes[0] === 0x3C) {
                throw new Error(
                    'CDN вернул HTML вместо аудиоданных. ' +
                    'Токен мог устареть — перезапустите воспроизведение и попробуйте снова.'
                );
            }

            const inputExt = MIME_TO_EXT[inputMimeType?.toLowerCase()] || 'mp3';
            const outputExt = outputFormat === 'aac' ? 'm4a' : outputFormat;
            const codecArgs = CODEC_ARGS[outputFormat];
            if (!codecArgs) throw new Error(`Unsupported output format: ${outputFormat}`);

            console.log(`[AudioConverter] convert: ${bytes.length} bytes, ${inputMimeType} → ${outputFormat}`);
            console.log(`[AudioConverter] First 4 bytes: ${bytes[0].toString(16)} ${bytes[1].toString(16)} ${bytes[2].toString(16)} ${bytes[3].toString(16)}`);

            if (onProgress)
                this._ffmpeg.setProgress(({ ratio }) => onProgress(Math.round(ratio * 100)));

            this._ffmpeg.FS('writeFile', `in.${inputExt}`, bytes);

            try {
                await this._ffmpeg.run(
                    '-i', `in.${inputExt}`,
                    ...codecArgs,
                    `out.${outputExt}`
                );
                const output = this._ffmpeg.FS('readFile', `out.${outputExt}`);
                return output.buffer;
            } finally {
                try { this._ffmpeg.FS('unlink', `in.${inputExt}`); } catch {}

                try { this._ffmpeg.FS('unlink', `out.${outputExt}`); } catch {}
                if (onProgress) this._ffmpeg.setProgress(() => {});
            }
        }
    }

    global.AudioConverter = AudioConverter;
    console.log('[AudioConverter] Loaded');
})(typeof window !== 'undefined' ? window : self);
