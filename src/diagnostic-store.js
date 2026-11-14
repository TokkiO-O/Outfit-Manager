// Outfit Manager · 二改版 | 排查源文件、起始副本与图片的独立存储
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { diagnosticId } from './diagnostic-job.js';
import { readDiagnosticJob, diagnosticTabId, diagnosticBoot } from './diagnostic-policy.js';

export var DIAGNOSTIC_STORE_NAME = 'outfit_mgr_diagnostic_jobs_v1';
var STORE = 'data';
function ownsJob(id) { var job = readDiagnosticJob(); return !!(job && job.id === id && job.owner === diagnosticTabId && job.phase !== 'restored' && !job.cancelRequested); }
function prefix(id) { if (!diagnosticId(id)) throw new Error('DIAGNOSTIC_ID_INVALID'); return id + ':'; }
export function openDiagnosticDatabase(name) {
    if (name !== DIAGNOSTIC_STORE_NAME && !/^outfit_mgr_diagnostic_[a-f0-9]{32}_[a-f0-9]{32}$/.test(name)) return Promise.reject(new Error('DIAGNOSTIC_DATABASE_INVALID'));
    return new Promise(function (resolve, reject) {
        var request = indexedDB.open(name, 1);
        request.onupgradeneeded = function () { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('DIAGNOSTIC_STORE_UNAVAILABLE')); };
        request.onblocked = function () { reject(new Error('DIAGNOSTIC_STORE_BLOCKED')); };
    });
}
async function transaction(name, mode, action) {
    var db = await openDiagnosticDatabase(name);
    return new Promise(function (resolve, reject) {
        var tx, value;
        try { tx = db.transaction(STORE, mode); value = action(tx.objectStore(STORE), tx); }
        catch (error) { db.close(); reject(error); return; }
        tx.oncomplete = function () { db.close(); resolve(typeof value === 'function' ? value() : value); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error('DIAGNOSTIC_STORE_FAILED')); };
    });
}
export async function diagnosticStoreGet(id, key) {
    var result = null;
    await transaction(DIAGNOSTIC_STORE_NAME, 'readonly', function (store) { var req = store.get(prefix(id) + key); req.onsuccess = function () { result = req.result === undefined ? null : req.result; }; });
    return result;
}
export function diagnosticStorePut(id, entries) {
    if (!ownsJob(id)) return Promise.reject(new Error('DIAGNOSTIC_NOT_OWNER'));
    return transaction(DIAGNOSTIC_STORE_NAME, 'readwrite', function (store) {
        if (!ownsJob(id)) throw new Error('DIAGNOSTIC_CANCELLED');
        entries.forEach(function (entry) { store.put(entry.value, prefix(id) + entry.key); });
    });
}
export async function diagnosticStoreKeys(id, begins) {
    var result = [], p = prefix(id) + (begins || '');
    await transaction(DIAGNOSTIC_STORE_NAME, 'readonly', function (store) {
        var range = typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.bound(p, p + '\uffff') : undefined, req = store.openKeyCursor(range);
        req.onsuccess = function () { var cursor = req.result; if (!cursor) return; if (typeof cursor.key === 'string' && cursor.key.startsWith(p)) result.push(cursor.key.slice(prefix(id).length)); cursor.continue(); };
    });
    return result;
}
export function diagnosticStoreDelete(id) {
    var p = prefix(id);
    return transaction(DIAGNOSTIC_STORE_NAME, 'readwrite', function (store) {
        var range = typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.bound(p, p + '\uffff') : undefined, req = store.openCursor(range);
        req.onsuccess = function () { var cursor = req.result; if (!cursor) return; if (typeof cursor.key === 'string' && cursor.key.startsWith(p)) cursor.delete(); cursor.continue(); };
    });
}
export function diagnosticRoundDatabase(id, round) { return 'outfit_mgr_diagnostic_' + prefix(id).slice(0, -1) + '_' + prefix(round).slice(0, -1); }
export async function seedDiagnosticLocalRound(job, round) {
    var keys = await diagnosticStoreGet(job.id, 'seed-keys');
    if (!Array.isArray(keys) || !keys.includes('meta') || !keys.includes('user:__default__') || !keys.includes('char:__shared__')) throw new Error('DIAGNOSTIC_SEED_MISSING');
    var name = diagnosticRoundDatabase(job.id, round), db = await openDiagnosticDatabase(name); db.close();
    for (var key of keys) {
        if (!ownsJob(job.id)) throw new Error('DIAGNOSTIC_CANCELLED');
        var value = await diagnosticStoreGet(job.id, 'seed:' + key); if (!value) throw new Error('DIAGNOSTIC_SEED_MISSING');
        await transaction(name, 'readwrite', function (store) { store.put(value, key); });
    }
    await transaction(name, 'readwrite', function (store) { store.put({ jobId: job.id, roundId: round }, 'om_diagnostic_seed'); });
    return name;
}
export async function checkDiagnosticRoundSeed() {
    if (!diagnosticBoot.sandbox || diagnosticBoot.storage !== 'local') return true;
    var value = null;
    await transaction(diagnosticBoot.dbName, 'readonly', function (store) { var req = store.get('om_diagnostic_seed'); req.onsuccess = function () { value = req.result; }; });
    return !!(value && value.jobId === diagnosticBoot.jobId && value.roundId === diagnosticBoot.roundId);
}
export function deleteDiagnosticRoundDatabase(id, round) {
    var name = diagnosticRoundDatabase(id, round);
    return new Promise(function (resolve) { var req = indexedDB.deleteDatabase(name); req.onsuccess = function () { resolve(true); }; req.onerror = req.onblocked = function () { resolve(false); }; });
}
// Only image blobs use the shared cache; partition, meta and chat records always
// stay in their own round database. No reads or writes target the normal DB.
export function diagnosticImageGet(key) { return diagnosticStoreGet(diagnosticBoot.jobId, key); }
export function diagnosticImagePut(entries) { return diagnosticStorePut(diagnosticBoot.jobId, entries); }
export function diagnosticImageKeys() { return diagnosticStoreKeys(diagnosticBoot.jobId, 'image:'); }

export function diagnosticSeedMeta(value, target) {
    var result = { _version: 2 };
    ['presets', 'charIndex', 'charFavorites', 'charGroups', 'activePresetId', 'activePartitions', 'currentView', 'currentChar', 'slotRules', 'tagOrder', 'uiTheme', 'customAccent', 'gridCols'].forEach(function (key) {
        if (value[key] !== undefined) result[key] = value[key];
    });
    var id = target === 'user:__default__' ? null : target.slice(5);
    result.activePresetId = id && (result.presets || []).some(function (item) { return item.id === id; }) ? id : null;
    result.activePartitions = {};
    result.apiVision = { endpoint: '', key: '', model: '', allowDirectFallback: false };
    return result;
}
