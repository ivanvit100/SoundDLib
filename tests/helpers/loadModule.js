import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Loads an IIFE browser module so it attaches to globalThis (jsdom window).
 * Works because vitest jsdom environment sets globalThis === window.
 */
export function loadModule(relativePath) {
    const code = readFileSync(resolve(ROOT, relativePath), 'utf-8');
    // eslint-disable-next-line no-new-func
    new Function(code)();
}
