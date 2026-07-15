/**
 * SoundDLib converter registry
 * Holds audio format metadata; actual conversion is done by AudioConverter via ffmpeg.wasm
 * @module converters/ConverterRegistry
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    const FORMATS = {
        mp3:  { label: 'MP3',  mimeType: 'audio/mpeg', ext: 'mp3'  },
        flac: { label: 'FLAC', mimeType: 'audio/flac', ext: 'flac' },
        ogg:  { label: 'OGG',  mimeType: 'audio/ogg',  ext: 'ogg'  },
        opus: { label: 'OPUS', mimeType: 'audio/opus', ext: 'opus' },
        wav:  { label: 'WAV',  mimeType: 'audio/wav',  ext: 'wav'  },
        aac:  { label: 'AAC',  mimeType: 'audio/aac',  ext: 'm4a'  }
    };

    const ConverterRegistry = {
        getFormats() {
            return Object.entries(FORMATS).map(([value, meta]) => ({ value, ...meta }));
        },

        getMeta(format) {
            return FORMATS[format?.toLowerCase()] || null;
        },

        isSupported(format) {
            return format?.toLowerCase() in FORMATS;
        }
    };

    global.ConverterRegistry = ConverterRegistry;
    console.log('[ConverterRegistry] Loaded');
})(typeof window !== 'undefined' ? window : self);
