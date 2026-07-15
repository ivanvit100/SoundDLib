/**
 * SoundDLib service registry
 * @module services/ServiceRegistry
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function(global) {
    console.log('[ServiceRegistry] Loading...');

    const SERVICE_SCRIPTS = [
        '/services/zvuk/config.js',
        '/services/BaseAudioService.js',
        '/services/zvuk/ZvukService.js'
    ];

    class ServiceRegistry {
        constructor() {
            this.services = new Map();
            console.log('[ServiceRegistry] Instance created');
        }

        register(ServiceClass) {
            try {
                const instance = new ServiceClass();
                this.services.set(instance.name, {
                    class: ServiceClass,
                    instance: instance,
                    matcher: ServiceClass.matches
                });
                console.log(`[ServiceRegistry] Registered: ${instance.name}`);
            } catch (e) {
                console.error(`[ServiceRegistry] Failed to register service:`, e);
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

    if (typeof importScripts === 'function')
        importScripts(...SERVICE_SCRIPTS);
    else if (typeof document !== 'undefined' && document.currentScript !== null) {
        // no-restricted-globals
        SERVICE_SCRIPTS.forEach(src => document.write(`<script src="${src}"><\/script>`));
    }

    console.log('[ServiceRegistry] Loaded');
})(typeof window !== 'undefined' ? window : self);