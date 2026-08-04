// lib/recordings-db.js - IndexedDB wrapper for persisting recordings.
//
// Provides CRUD operations for storing video blobs and their metadata.
// Each recording is stored as { id, name, blob, size, duration, mime, ext, createdAt }.
// A hard cap of MAX_RECORDINGS entries is enforced; the oldest entries are
// evicted when the limit is exceeded.

const RecordingsDB = (() => {
    const DB_NAME = 'screenrecorder-db';
    const DB_VERSION = 1;
    const STORE_NAME = 'recordings';
    const MAX_RECORDINGS = 50;

    let dbInstance = null;

    function open() {
        if (dbInstance) return Promise.resolve(dbInstance);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
            req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
            req.onerror = () => reject(req.error);
        });
    }

    function tx(mode) {
        return open().then(db => {
            const transaction = db.transaction(STORE_NAME, mode);
            return transaction.objectStore(STORE_NAME);
        });
    }

    function promisify(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function uid() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    // Save a recording. Returns the saved recording object (with id).
    async function save({ name, blob, size, duration, mime, ext }) {
        const store = await tx('readwrite');
        const recording = {
            id: uid(),
            name: name || ('Recording_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.' + (ext || 'webm')),
            blob: blob,
            size: size || blob.size,
            duration: duration || 0,
            mime: mime || blob.type || 'video/webm',
            ext: ext || 'webm',
            createdAt: Date.now()
        };
        await promisify(store.put(recording));
        await enforceLimit();
        return { id: recording.id, name: recording.name, size: recording.size, duration: recording.duration, mime: recording.mime, ext: recording.ext, createdAt: recording.createdAt };
    }

    // Get all recordings metadata (without blobs) sorted newest first.
    async function getAll() {
        const store = await tx('readonly');
        const all = await promisify(store.getAll());
        return all
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(r => ({ id: r.id, name: r.name, size: r.size, duration: r.duration, mime: r.mime, ext: r.ext, createdAt: r.createdAt }));
    }

    // Get a single recording including its blob.
    async function getById(id) {
        const store = await tx('readonly');
        return promisify(store.get(id));
    }

    // Get a blob URL for a recording. Caller is responsible for revoking it.
    async function getBlobUrl(id) {
        const rec = await getById(id);
        if (!rec || !rec.blob) return null;
        return URL.createObjectURL(rec.blob);
    }

    // Delete a single recording.
    async function remove(id) {
        const store = await tx('readwrite');
        return promisify(store.delete(id));
    }

    // Delete multiple recordings.
    async function removeBatch(ids) {
        const store = await tx('readwrite');
        for (const id of ids) {
            await promisify(store.delete(id));
        }
    }

    // Clear all recordings.
    async function clear() {
        const store = await tx('readwrite');
        return promisify(store.clear());
    }

    // Get count of recordings.
    async function count() {
        const store = await tx('readonly');
        return promisify(store.count());
    }

    // Evict oldest recordings if over the limit.
    async function enforceLimit() {
        const store = await tx('readwrite');
        const all = await promisify(store.getAll());
        if (all.length <= MAX_RECORDINGS) return;
        const sorted = all.sort((a, b) => a.createdAt - b.createdAt);
        const toDelete = sorted.slice(0, all.length - MAX_RECORDINGS);
        for (const rec of toDelete) {
            await promisify(store.delete(rec.id));
        }
    }

    return { save, getAll, getById, getBlobUrl, remove, removeBatch, clear, count };
})();
