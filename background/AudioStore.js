/**
 * SoundDLib background module
 * In-memory store for audio captured by content scripts
 * @module background/AudioStore
 * @author ivanvit
 * @version 0.0.1
 */

'use strict';

(function() {
    const MAX_TRACKS = 10;

    class AudioStore {
        constructor() {
            this._store = new Map();
            this._order = [];
            this._latestId = null;
            this._urlIndex = new Map();
        }

        put(id, entry) {
            if (entry.url) {
                const existingId = this._urlIndex.get(entry.url);
                if (existingId && this._store.has(existingId)) {
                    const existing = this._store.get(existingId);
                    if (!existing.data && entry.data)
                        this._store.set(existingId, { ...existing, data: entry.data });
                    this._latestId = existingId;
                    return existingId;
                }
                this._urlIndex.set(entry.url, id);
            }

            if (this._store.has(id))
                this._store.set(id, entry);
            else {
                if (this._order.length >= MAX_TRACKS) {
                    const evicted = this._order.shift();
                    const evictedEntry = this._store.get(evicted);
                    if (evictedEntry?.url) this._urlIndex.delete(evictedEntry.url);
                    this._store.delete(evicted);
                }
                this._order.push(id);
                this._store.set(id, entry);
            }
            this._latestId = id;
            console.log(`[AudioStore] Stored track: ${id} (${entry.meta?.title || 'unknown'})`);
            return id;
        }

        updateMeta(id, meta) {
            const entry = this._store.get(id);
            if (entry) this._store.set(id, { ...entry, meta });
        }

        hasUrl(url) {
            return url ? this._urlIndex.has(url) : false;
        }

        get(id) {
            return this._store.get(id) || null;
        }

        getLatest() {
            return this._latestId ? this._store.get(this._latestId) : null;
        }

        getLatestId() {
            return this._latestId;
        }

        list() {
            return this._order.map(id => {
                const e = this._store.get(id);
                return { id, meta: e.meta, mimeType: e.mimeType, capturedAt: e.capturedAt };
            });
        }

        findByZvukId(zvukId) {
            const prefix = `/track/${zvukId}`;
            for (const id of this._order) {
                const e = this._store.get(id);
                const u = e.masterUrl || e.url || '';
                if (u.includes(`${prefix  }/`) || u.includes(`${prefix  }_`)) return e;
            }
            return null;
        }

        remove(id) {
            const entry = this._store.get(id);
            if (entry?.url) this._urlIndex.delete(entry.url);
            this._store.delete(id);
            const idx = this._order.indexOf(id);
            if (idx !== -1) this._order.splice(idx, 1);
            if (this._latestId === id)
                this._latestId = this._order.length ? this._order[this._order.length - 1] : null;
        }

        clear() {
            this._store.clear();
            this._order = [];
            this._latestId = null;
            this._urlIndex.clear();
        }
    }

    globalThis.audioStore = new AudioStore();
    console.log('[AudioStore] Loaded');
})();
