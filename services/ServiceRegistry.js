/**
 * SoundDLib service registry
 * @module services/ServiceRegistry
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    global.SERVICE_DEFINITIONS = [
        {
            name: 'zvuk',
            matches: ['https://zvuk.com/*', 'https://*.zvuk.com/*'],
            scripts: {
                background: [
                    '/services/zvuk/config.js',
                    '/services/BaseAudioService.js',
                    '/services/zvuk/ZvukService.js',
                    '/services/zvuk/ZvukMessageHandler.js',
                    '/services/zvuk/ZvukRequestInterceptor.js'
                ],
                popup: [
                    '/services/zvuk/config.js',
                    '/services/BaseAudioService.js',
                    '/core/base/BaseHlsDownloader.js',
                    '/services/zvuk/ZvukHlsDownloader.js',
                    '/services/zvuk/ZvukService.js'
                ],
                contentMain: [
                    'core/base/BaseInterceptor.js',
                    'services/zvuk/ZvukInterceptor.js'
                ],
                contentIsolated: [
                    'core/base/BaseRelay.js',
                    'services/zvuk/ZvukRelay.js'
                ]
            }
        },
        {
            name: 'yandex',
            matches: [
                'https://music.yandex.ru/*',
                'https://music.yandex.com/*',
                'https://music.yandex.by/*',
                'https://music.yandex.kz/*',
                'https://music.yandex.ua/*'
            ],
            scripts: {
                background: [
                    '/services/yandex/config.js',
                    '/services/BaseAudioService.js',
                    '/services/yandex/YandexService.js',
                    '/services/yandex/YandexMessageHandler.js',
                    '/services/yandex/YandexRequestInterceptor.js'
                ],
                popup: [
                    '/services/yandex/config.js',
                    '/services/BaseAudioService.js',
                    '/services/yandex/YandexService.js'
                ],
                contentMain: [
                    'core/base/BaseInterceptor.js',
                    'services/yandex/YandexInterceptor.js'
                ],
                contentIsolated: [
                    'core/base/BaseRelay.js',
                    'services/yandex/YandexRelay.js'
                ]
            }
        }
    ];

    class ServiceRegistry {
        constructor() {
            this.services = new Map();
        }

        register(ServiceClass) {
            try {
                const instance = new ServiceClass();
                this.services.set(instance.name, {
                    class: ServiceClass,
                    instance,
                    matcher: ServiceClass.matches
                });
                console.log(`[ServiceRegistry] Registered: ${instance.name}`);
            } catch (e) {
                console.error('[ServiceRegistry] Failed to register service:', e);
            }
        }

        getServiceByUrl(url) {
            for (const [name, { instance, matcher }] of this.services) {
                try {
                    if (matcher(url)) return instance;
                } catch (e) {
                    console.error(`[ServiceRegistry] Error checking matcher for ${name}:`, e);
                }
            }
            return null;
        }

        getService(name) {
            return this.services.get(name)?.instance || null;
        }

        createService(name) {
            const entry = this.services.get(name);
            if (!entry) return null;
            try {
                return new entry.class();
            } catch (e) {
                console.error(`[ServiceRegistry] Failed to create service: ${name}`, e);
                return null;
            }
        }

        getAllServices() {
            return Array.from(this.services.values()).map(s => s.instance);
        }
    }

    global.ServiceRegistry = ServiceRegistry;
    global.serviceRegistry = new ServiceRegistry();
    console.log('[ServiceRegistry] Loaded');
})(typeof window !== 'undefined' ? window : self);
