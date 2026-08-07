import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
    globalThis.SERVICE_DEFINITIONS = [{
        name: 'zvuk',
        matches: ['https://zvuk.com/*'],
        scripts: { background: [], popup: [], contentMain: [], contentIsolated: [] }
    }];
});

import '../../services/ServiceRegistry.js';

describe('ServiceRegistry — IIFE self branch', () => {
    it('загружается с self если window не определён', async () => {
        vi.stubGlobal('window', undefined);
        vi.resetModules();
        await import('../../services/ServiceRegistry.js');
        vi.unstubAllGlobals();
        expect(globalThis.ServiceRegistry).toBeDefined();
    });
});

describe('ServiceRegistry', () => {
    let registry;

    beforeEach(() => {
        registry = new globalThis.ServiceRegistry();
    });

    it('ServiceRegistry класс существует', () => {
        expect(globalThis.ServiceRegistry).toBeDefined();
    });

    it('глобальный serviceRegistry создан', () => {
        expect(globalThis.serviceRegistry).toBeInstanceOf(globalThis.ServiceRegistry);
    });

    it('SERVICE_DEFINITIONS устанавливается', () => {
        expect(globalThis.SERVICE_DEFINITIONS).toBeDefined();
    });

    describe('register', () => {
        it('регистрирует сервис', () => {
            class TestService {
                constructor() { this.name = 'test'; }
                static matches(_url) { return true; }
            }
            registry.register(TestService);
            expect(registry.getService('test')).toBeInstanceOf(TestService);
        });

        it('не падает при ошибке в конструкторе', () => {
            class BadService {
                constructor() { throw new Error('init fail'); }
            }
            expect(() => registry.register(BadService)).not.toThrow();
        });
    });

    describe('getServiceByUrl', () => {
        it('возвращает сервис по url', () => {
            class ZvukService {
                constructor() { this.name = 'zvuk'; }
                static matches(url) { return url.includes('zvuk.com'); }
            }
            registry.register(ZvukService);
            const service = registry.getServiceByUrl('https://zvuk.com/track/123');
            expect(service).toBeInstanceOf(ZvukService);
        });

        it('возвращает null если не найдено', () => {
            expect(registry.getServiceByUrl('https://other.com')).toBeNull();
        });

        it('не падает если matcher бросает', () => {
            class ErrorService {
                constructor() { this.name = 'err'; }
                static matches() { throw new Error('matcher fail'); }
            }
            registry.register(ErrorService);
            expect(() => registry.getServiceByUrl('https://test.com')).not.toThrow();
            expect(registry.getServiceByUrl('https://test.com')).toBeNull();
        });

        it('продолжает поиск если первый сервис не совпадает', () => {
            class NoMatchService {
                constructor() { this.name = 'nomatch'; }
                static matches(_url) { return false; }
            }
            class MatchService {
                constructor() { this.name = 'match'; }
                static matches(url) { return url.includes('match'); }
            }
            registry.register(NoMatchService);
            registry.register(MatchService);
            const result = registry.getServiceByUrl('https://match.com');
            expect(result).toBeInstanceOf(MatchService);
        });
    });

    describe('getService', () => {
        it('возвращает сервис по имени', () => {
            class MySvc {
                constructor() { this.name = 'mysvc'; }
                static matches() { return false; }
            }
            registry.register(MySvc);
            expect(registry.getService('mysvc')).toBeInstanceOf(MySvc);
        });

        it('возвращает null для несуществующего', () => {
            expect(registry.getService('nonexistent')).toBeNull();
        });
    });

    describe('createService', () => {
        it('создаёт новый экземпляр', () => {
            class AnotherSvc {
                constructor() { this.name = 'another'; }
                static matches() { return false; }
            }
            registry.register(AnotherSvc);
            const inst1 = registry.getService('another');
            const inst2 = registry.createService('another');
            expect(inst1).not.toBe(inst2);
        });

        it('возвращает null для несуществующего', () => {
            expect(registry.createService('nonexistent')).toBeNull();
        });

        it('возвращает null если конструктор бросает', () => {
            let throwOnCreate = false;
            class BrokenOnCreate {
                constructor() {
                    if (throwOnCreate) throw new Error('fail');
                    this.name = 'broken';
                }
                static matches() { return false; }
            }
            registry.register(BrokenOnCreate);
            throwOnCreate = true;
            expect(registry.createService('broken')).toBeNull();
        });
    });

    describe('getAllServices', () => {
        it('возвращает все сервисы', () => {
            class Svc1 {
                constructor() { this.name = 'svc1'; }
                static matches() { return false; }
            }
            class Svc2 {
                constructor() { this.name = 'svc2'; }
                static matches() { return false; }
            }
            registry.register(Svc1);
            registry.register(Svc2);
            const all = registry.getAllServices();
            expect(all.length).toBeGreaterThanOrEqual(2);
        });
    });
});
