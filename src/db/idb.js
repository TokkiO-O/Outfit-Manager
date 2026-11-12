// Outfit Manager · 二改版 | 本地数据库事务
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, DB_NAME, DB_VERSION, STORE_NAME } from './state.js';

// ══════════════════════════════════════════════════════════
//  IndexedDB 底层
// ══════════════════════════════════════════════════════════

export function openDB(cb) {
    if (DB.dbInstance) { cb(DB.dbInstance); return; }
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = function (e) { DB.dbInstance = e.target.result; cb(DB.dbInstance); };
    req.onerror = function () { cb(null); };
}

// 通用：读单个 key
export function idbGet(key, cb) {
    var finished = false;
    function done(value, error) { if (!finished) { finished = true; cb(value, error || null); } }
    try { openDB(function (db) {
        if (!db) { done(null, new Error('无法打开本地衣柜存储')); return; }
        try {
            var tx = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = function () { done(req.result !== undefined ? req.result : null); };
            req.onerror = function () { done(null, req.error || new Error('本地记录读取失败')); };
            tx.onerror = tx.onabort = function () { done(null, tx.error || new Error('本地读取事务未完成')); };
        } catch (error) { done(null, error); }
    }); } catch (error) { done(null, error); }
}

// One transaction, so a repair cannot replace data written by another window.
// Only an absent key is created; stored null/invalid objects remain visible errors.
export function idbGetOrCreate(key, fallback, cb) {
    var finished = false;
    function done(value, error, created) { if (!finished) { finished = true; cb(value, error || null, !!created); } }
    try { openDB(function (db) {
        if (!db) { done(null, new Error('无法打开本地衣柜存储')); return; }
        try {
            var tx = db.transaction(STORE_NAME, 'readwrite'), store = tx.objectStore(STORE_NAME), value, created = false;
            tx.oncomplete = function () { done(value, null, created); };
            tx.onerror = tx.onabort = function () { done(null, tx.error || new Error('补建通用衣柜失败，原有衣柜已保留')); };
            var req = store.get(key);
            req.onsuccess = function () {
                value = req.result;
                if (value === undefined) { value = fallback; created = true; store.put(value, key); }
            };
        } catch (error) { done(null, error); }
    }); } catch (error) { done(null, error); }
}

// 通用：写单个 key
export function idbPut(key, value, cb) {
    openDB(function (db) {
        if (!db) { if (cb) cb(false); return; }
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = function () { if (cb) cb(true); };
        tx.onerror = function () { if (cb) cb(false); };
    });
}

// 通用：删除单个 key
export function idbDelete(key, cb) {
    openDB(function (db) {
        if (!db) { if (cb) cb(false); return; }
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = function () { if (cb) cb(true); };
        tx.onerror = function () { if (cb) cb(false); };
    });
}

// 通用：批量写多个 key（同一事务）
export function idbPutBatch(entries, cb) {
    var finished = false;
    function done(ok) { if (!finished) { finished = true; if (cb) cb(ok); } }
    try { openDB(function (db) {
        if (!db) { done(false); return; }
        var tx = db.transaction(STORE_NAME, 'readwrite'), store = tx.objectStore(STORE_NAME);
        tx.oncomplete = function () { done(true); };
        tx.onerror = tx.onabort = function () { done(false); };
        try { entries.forEach(function (entry) { store.put(entry.value, entry.key); }); }
        catch (error) { try { tx.abort(); } catch (e) {} done(false); }
    }); } catch (error) { done(false); }
}

// 通用：读取所有 key（迁移检测用）
export function idbGetAllKeys(cb) {
    openDB(function (db) {
        if (!db) { cb([]); return; }
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        if (store.getAllKeys) {
            var req = store.getAllKeys();
            req.onsuccess = function () { cb(req.result || []); };
            req.onerror = function () { cb([]); };
        } else {
            // fallback for older browsers
            var keys = [];
            var cursor = store.openKeyCursor();
            cursor.onsuccess = function (e) {
                var c = e.target.result;
                if (c) { keys.push(c.key); c.continue(); }
                else cb(keys);
            };
            cursor.onerror = function () { cb(keys); };
        }
    });
}

// ══════════════════════════════════════════════════════════
