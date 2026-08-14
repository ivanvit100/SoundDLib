/**
 * SoundDLib — yandex music service config
 * @module services/yandex/config
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    global.yandexConfig = {
        name: 'yandex',
        color: '#FC3F1D',
        logo: 'icons/logo2.png',
        baseUrl: 'https://music.yandex.ru',
        apiUrl: 'https://music.yandex.ru',
        headers: {
            'Referer': 'https://music.yandex.ru/',
            'Accept': 'application/json',
            'X-Retpath-Y': 'https://music.yandex.ru'
        }
    };
})(typeof window !== 'undefined' ? window : self);
