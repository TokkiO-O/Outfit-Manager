// Outfit Manager · 二改版 | 固定起始副本、逐轮真实读回与临时数据清理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, STORE_NAME, SERVER_BASE } from './db/state.js';
import { idbGet, idbGetAllKeys } from './db/idb.js';
import { flushDirtyPartitions } from './db/server-partitions.js';
import { withLoadedPartitions } from './db/partitions.js';
import { partitionForStorage } from './chat-state.js';
import { currentSession } from './chat-session.js';
import { copyJson } from './json-data.js';
import { imageBlobAndRef, isLocalImage, hasLocalImage, sha256 } from './db/local-images.js';
import { diagnosticStoreGet, diagnosticStorePut, diagnosticStoreDelete, diagnosticSeedMeta, seedDiagnosticLocalRound, deleteDiagnosticRoundDatabase } from './diagnostic-store.js';
import { diagnosticRequestHeaders } from './diagnostic-host.js';
import { readDiagnosticJob, diagnosticTabId, diagnosticBoot, newDiagnosticId } from './diagnostic-policy.js';

var LIVE = '/api/plugins/outfit-manager';
export function diagnosticOwns(job) { var latest = readDiagnosticJob(); return !!(latest && latest.id === job.id && latest.owner === diagnosticTabId && !latest.cancelRequested && latest.phase !== 'restored'); }
function check(job) { if (!diagnosticOwns(job)) throw new Error('DIAGNOSTIC_CANCELLED'); }
export function diagnosticPause(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
export async function diagnosticServer(path, method, body) {
    var response = await fetch(LIVE + '/diagnostics/' + path, { method: method || 'GET', credentials: 'same-origin', headers: await diagnosticRequestHeaders(), body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    var value; try { value = await response.json(); } catch (ignored) {}
    if (!response.ok || !value || value.ok !== true) throw Object.assign(new Error(value && value.code || 'DIAGNOSTIC_SERVER_UNAVAILABLE'), { code: value && value.code, status: response.status });
    return value;
}
export async function diagnosticFlush(signal) {
    if (DB.syncConflict || DB.serverInitFailed) throw new Error('请先处理衣柜保存或同步错误');
    if (DB.serverMode && !DB.serverSupportsIncremental) throw new Error('当前后端不支持可靠读回，请更新配套后端');
    var start = Date.now();
    while (DB.serverMode && (DB.partFlushInFlight || Object.keys(DB.dirtyPartKeys).length || DB.serverPutInFlight)) {
        if (signal && signal.aborted) throw new Error('DIAGNOSTIC_CANCELLED');
        if (DB.syncConflict || DB.syncState === 'error' || Date.now() - start > 45000) throw new Error('SAVE_FAILED');
        flushDirtyPartitions(); await diagnosticPause(120);
    }
    // A readwrite barrier waits for earlier local writes without changing data.
    if (DB.dbInstance) await new Promise(function (resolve, reject) {
        var tx = DB.dbInstance.transaction(STORE_NAME, 'readwrite'); tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || new Error('SAVE_FAILED')); };
    });
}
export function diagnosticSelection() {
    var session = currentSession(), selection = {};
    if (session) ['presetBindingVersion', 'presetId', 'view', 'active', 'current', 'modes', 'scene', 'switchMode'].forEach(function (key) { if (session[key] !== undefined) selection[key] = copyJson(session[key]); });
    return selection;
}
export async function prepareDiagnosticData(job, file, selection, progress) {
    check(job);
    await diagnosticStorePut(job.id, [{ key: 'source', value: file || null }, { key: 'selection', value: selection || {} }]);
    if (job.storage === 'server') {
        var result = await diagnosticServer('sessions', 'POST', { clientId: job.id, targetUserKey: job.targetUserKey });
        check(job); return result.session;
    }
    var keys = await new Promise(function (resolve) { idbGetAllKeys(resolve); });
    keys = keys.filter(function (key) { return /^(meta|user:(__default__|[A-Za-z0-9_-]+)|char:(__shared__|c_[A-Za-z0-9]{8}))$/.test(key); }).sort();
    if (!['meta', 'user:__default__', 'char:__shared__'].every(function (key) { return keys.includes(key); })) throw new Error('DIAGNOSTIC_SEED_MISSING');
    var meta = diagnosticSeedMeta(await new Promise(function (resolve, reject) { idbGet('meta', function (value, error) { if (error) reject(error); else resolve(value); }); }), job.targetUserKey);
    var copiedImages = new Set(), done = 0;
    for (var key of keys.filter(function (key) { return key !== 'meta'; })) {
        check(job);
        var value = await new Promise(function (resolve, reject) { idbGet(key, function (value, error) { if (error) reject(error); else resolve(value); }); });
        if (!value) throw new Error('DIAGNOSTIC_SEED_MISSING');
        value = copyJson(value);
        if ((key.startsWith('char:') || key === job.targetUserKey) && (value.activeIds || []).length) meta.activePartitions[key] = value.activeIds.slice();
        for (var item of (value.outfits || []).concat(value.accessories || [])) {
            check(job); var ref = item.imageData;
            if (typeof ref === 'string' && ref.startsWith('data:image/')) { var asset = await imageBlobAndRef(ref); ref = item.imageData = asset.ref; if (!copiedImages.has(ref)) await diagnosticStorePut(job.id, [{ key: 'image:' + ref.slice(9), value: asset.blob }]); }
            else if (isLocalImage(ref) && !copiedImages.has(ref)) {
                var blob = await new Promise(function (resolve, reject) { idbGet('image:' + ref.slice(9), function (value, error) { if (error || !(value instanceof Blob)) reject(error || new Error('DIAGNOSTIC_SEED_IMAGE_MISSING')); else resolve(value); }); });
                await diagnosticStorePut(job.id, [{ key: 'image:' + ref.slice(9), value: blob }]);
            }
            if (isLocalImage(ref)) copiedImages.add(ref);
            // A server URL without a server is not a complete starting copy.
            if (typeof ref === 'string' && ref.startsWith(LIVE + '/images/')) throw new Error('DIAGNOSTIC_SEED_IMAGE_MISSING');
        }
        await diagnosticStorePut(job.id, [{ key: 'seed:' + key, value: value }]);
        if (progress) progress(++done, keys.length); await diagnosticPause(0);
    }
    await diagnosticStorePut(job.id, [{ key: 'seed:meta', value: meta }, { key: 'seed-keys', value: keys }]);
    return null;
}
export async function prepareDiagnosticRound(job) {
    check(job);
    if (job.storage === 'server') return (await diagnosticServer('sessions/' + job.serverSession + '/rounds', 'POST', {})).round;
    var round = newDiagnosticId(); await seedDiagnosticLocalRound(job, round); return round;
}
function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(function (key) { return value[key] !== undefined; }).map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
}
function digest(value) { return sha256(new TextEncoder().encode(canonical(value))); }
export async function diagnosticReadback() {
    var keys = Object.keys(DB.knownPartKeys).sort(), summaries = [], outfits = 0, accessories = 0, missingImages = 0;
    await withLoadedPartitions(keys, async function () {
        for (var key of keys) {
            var value = diagnosticBoot.storage === 'local' ? await new Promise(function(resolve,reject){idbGet(key,function(value,error){if(error)reject(error);else resolve(value);});}) : partitionForStorage(key, DB.partCache[key]);
            if (!value) throw new Error('VERIFY_FAILED');
            outfits += (value.outfits || []).length; accessories += (value.accessories || []).length;
            for (var item of (value.outfits || []).concat(value.accessories || [])) if (isLocalImage(item.imageData) && !await hasLocalImage(item.imageData)) missingImages++;
            if (diagnosticBoot.storage === 'local') summaries.push([key, digest({outfits:value.outfits||[],accessories:value.accessories||[],categories:value.categories||[],accCategories:value.accCategories||[]})]); await diagnosticPause(0);
        }
    });
    summaries.push(['wardrobes', digest({ presets: DB.metaCache.presets, charIndex: DB.metaCache.charIndex })]);
    if (diagnosticBoot.storage === 'server') {
        var response = await fetch(SERVER_BASE + '/verify', { cache: 'no-store' }), server = await response.json();
        if (!response.ok || !server.ok || server.missingImages || server.outfits !== outfits || server.accessories !== accessories) throw new Error('VERIFY_FAILED');
        summaries.push(['server', server.digest]);
    }
    if (missingImages) throw new Error('VERIFY_FAILED');
    return { digest: digest(summaries), counts: { outfits: outfits, accessories: accessories } };
}
export async function cleanupDiagnosticData(job, keep) {
    var pending = false;
    if (job.storage === 'server') {
        try { var result = keep && job.serverSession ? await diagnosticServer('sessions/' + job.serverSession + '/pause', 'POST', {}) : await diagnosticServer('clients/' + job.id, 'DELETE'); pending = result.cleanupPending === true; } catch (ignored) { pending = true; }
    }
    if (!keep) {
        if (DB.dbInstance && diagnosticBoot.sandbox) { DB.dbInstance.close(); DB.dbInstance = null; }
        for (var round of job.roundIds || []) if (!await deleteDiagnosticRoundDatabase(job.id, round)) pending = true;
        try { await diagnosticStoreDelete(job.id); } catch (ignored) { pending = true; }
        for (var i = localStorage.length - 1; i >= 0; i--) { var key = localStorage.key(i); if (key && (key.startsWith('om_diagnostic_chat:' + job.id + ':') || key.startsWith('outfit_mgr_diagnostic_seen:' + job.id + ':') || key === 'outfit_mgr_diagnostic_legacy:' + job.id)) localStorage.removeItem(key); }
    }
    return pending;
}
