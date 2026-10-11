/* =========================================================
   STORAGE LAYER — IndexedDB
   Stage 1: local persistence only. No network calls.
   Designed to support the future cloud sync queue.
   ========================================================= */

const DB_NAME = 'gardenJournal';
const DB_VERSION = 1;

const STORE_ENTRIES   = 'entries';
const STORE_SECTIONS  = 'sections';
const STORE_PHOTOS    = 'photos';
const STORE_QUEUE     = 'syncQueue';
const STORE_CONFLICTS = 'conflicts';
const STORE_META      = 'meta';

let _db = null;

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (_db) return resolve(_db);
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
                db.createObjectStore(STORE_ENTRIES, { keyPath: '_id' });
            }
            if (!db.objectStoreNames.contains(STORE_SECTIONS)) {
                db.createObjectStore(STORE_SECTIONS, { keyPath: '_id' });
            }
            if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
                db.createObjectStore(STORE_PHOTOS, { keyPath: '_photoId' });
            }
            if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                const q = db.createObjectStore(STORE_QUEUE, { keyPath: '_queueId', autoIncrement: true });
                q.createIndex('by_queuedAt', '_queuedAt');
            }
            if (!db.objectStoreNames.contains(STORE_CONFLICTS)) {
                db.createObjectStore(STORE_CONFLICTS, { keyPath: '_conflictId', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: 'key' });
            }
        };

        req.onsuccess = (event) => {
            _db = event.target.result;
            _db.onversionchange = () => { _db.close(); _db = null; };
            resolve(_db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB upgrade blocked — close other tabs'));
    });
}

function _tx(storeNames, mode) {
    if (!_db) throw new Error('Database not opened');
    return _db.transaction(storeNames, mode);
}

function _reqAsPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function _txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

/* ---------- Meta ---------- */

async function getMeta(key) {
    const tx = _tx([STORE_META], 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    const row = await _reqAsPromise(req);
    return row ? row.value : undefined;
}

async function setMeta(key, value) {
    const tx = _tx([STORE_META], 'readwrite');
    tx.objectStore(STORE_META).put({ key, value });
    await _txDone(tx);
}

/* ---------- Load everything (hydrate-ready) ---------- */

async function loadAll() {
    const tx = _tx([STORE_ENTRIES, STORE_SECTIONS, STORE_PHOTOS], 'readonly');

    const entriesReq  = tx.objectStore(STORE_ENTRIES).getAll();
    const sectionsReq = tx.objectStore(STORE_SECTIONS).getAll();
    const photosReq   = tx.objectStore(STORE_PHOTOS).getAll();

    const [entries, sections, photos] = await Promise.all([
        _reqAsPromise(entriesReq),
        _reqAsPromise(sectionsReq),
        _reqAsPromise(photosReq)
    ]);

    return {
        entries:  entries.filter(e => !e.deleted),
        sections: sections.filter(s => !s.deleted),
        photos:   photos.filter(p => !p.deleted)
    };
}

/* ---------- Persist dirty records ---------- */

async function persistBatch(dirtyEntries, dirtySections, dirtyPhotos) {
    const stores = [STORE_ENTRIES, STORE_SECTIONS, STORE_PHOTOS];
    const tx = _tx(stores, 'readwrite');
    const eStore = tx.objectStore(STORE_ENTRIES);
    const sStore = tx.objectStore(STORE_SECTIONS);
    const pStore = tx.objectStore(STORE_PHOTOS);

    dirtyEntries.forEach(e => eStore.put(e));
    dirtySections.forEach(s => sStore.put(s));
    dirtyPhotos.forEach(p => pStore.put(p));

    await _txDone(tx);
}

/* ---------- Photos ---------- */

async function putPhoto(photoId, blob, mimeType) {
    const tx = _tx([STORE_PHOTOS], 'readwrite');
    tx.objectStore(STORE_PHOTOS).put({
        _photoId: photoId,
        blob,
        mimeType,
        createdAt: Date.now(),
        deleted: false
    });
    await _txDone(tx);
}

async function getPhoto(photoId) {
    const tx = _tx([STORE_PHOTOS], 'readonly');
    const row = await _reqAsPromise(tx.objectStore(STORE_PHOTOS).get(photoId));
    return row || null;
}

async function softDeletePhoto(photoId) {
    const tx = _tx([STORE_PHOTOS], 'readwrite');
    const store = tx.objectStore(STORE_PHOTOS);
    const row = await _reqAsPromise(store.get(photoId));
    if (row) {
        row.deleted = true;
        row.deletedAt = Date.now();
        store.put(row);
    }
    await _txDone(tx);
}

/* ---------- Restore ---------- */

async function replaceAll(entries, sections, photos) {
    const tx = _tx([STORE_ENTRIES, STORE_SECTIONS, STORE_PHOTOS, STORE_META], 'readwrite');

    const eStore = tx.objectStore(STORE_ENTRIES);
    const sStore = tx.objectStore(STORE_SECTIONS);
    const pStore = tx.objectStore(STORE_PHOTOS);
    const mStore = tx.objectStore(STORE_META);

    eStore.clear();
    sStore.clear();
    // Note: photos are NOT cleared — existing Blobs remain attached
    // to any restored sections that reference their _photoId. Photos
    // that are no longer referenced will remain until a future
    // cleanup pass, which is acceptable.

    entries.forEach(e => eStore.put(e));
    sections.forEach(s => sStore.put(s));
    if (photos && photos.length) photos.forEach(p => pStore.put(p));

    mStore.put({ key: 'initialized', value: true });

    await _txDone(tx);
}

/* ---------- Stage 1 stubs for later stages ---------- */

async function enqueueSync()      { /* no-op in Stage 1 */ }
async function listConflicts()    { return []; }
async function resolveConflict()  { /* no-op in Stage 1 */ }
