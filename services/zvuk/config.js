/**
 * SoundDLib — zvuk.com service config
 * @module services/zvuk/config
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    global.zvukConfig = {
        name: 'zvuk',
        color: '#00D074',
        logo: 'icons/logo1.png',
        baseUrl: 'https://zvuk.com',
        apiUrl: 'https://zvuk.com/api/v1',
        graphqlUrl: 'https://zvuk.com/api/v1/graphql',
        headers: {
            'Referer': 'https://zvuk.com/',
            'Origin': 'https://zvuk.com',
            'Accept': 'application/json'
        }
    };
})(typeof window !== 'undefined' ? window : self);
