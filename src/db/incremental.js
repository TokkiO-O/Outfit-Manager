// Outfit Manager · 二改版 | 增量同步、待保存修改与冲突处理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, SERVER_BASE } from './state.js';
import { captureRuntimeError } from '../runtime-errors.js';
import { idbGet, idbPut } from './idb.js';
import { getWriteHeaders, scheduleServerCheckpoint, scheduleServerPut } from './server.js';
import { applyChatPartition, metaForStorage, partitionForStorage } from '../chat-state.js';
import { prepareOutgoingImages } from './images.js';

var pendingTail = Promise.resolve();
export var PENDING_KEY = 'om_sync_pending_v3';
export var MANIFEST_KEY = 'om_cache_revisions_v3';
var listeners = [];

export function subscribeSync(listener) {
    listeners.push(listener);
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
}
export function setSyncState(status, error) {
    if (DB.syncState === status && DB.syncError === (error || null)) return;
    DB.syncState = status;
    DB.syncError = error || null;
    if (status === 'error' || status === 'conflict') captureRuntimeError(error, { operation: 'save', source: 'src/db/incremental.js' });
    listeners.slice().forEach(function (listener) { try { listener(); } catch (e) {} });
}

export function persistPending() {
    if (!DB.serverSupportsIncremental || !DB.serverHydrated) return Promise.resolve();
    var keys = Object.keys(Object.assign({}, DB.sendingPartKeys, DB.dirtyPartKeys));
    var value = { version: 1, base: {}, partitions: {}, deletes: Object.keys(DB.pendingPartitionDeletes), at: Date.now() };
    keys.forEach(function (key) {
        value.base[key] = DB.remotePartRevisions[key] || null;
        if (key === 'meta') value.meta = metaForStorage(DB.metaCache);
        else if (DB.partCache[key] && !DB.deletedPartKeys[key]) value.partitions[key] = partitionForStorage(key, DB.partCache[key]);
    });
    value.deletes.forEach(function (key) { value.base[key] = DB.remotePartRevisions[key] || null; });
    value.conflict = DB.syncConflict;
    var snapshot = JSON.parse(JSON.stringify(value));
    pendingTail = pendingTail.catch(function () {}).then(function () {
        return new Promise(function (resolve) {
            idbPut(PENDING_KEY, snapshot, function (ok) {
                if (!ok) setSyncState('error', '待同步内容无法写入本地，请先导出备份并检查空间。');
                resolve(ok);
            });
        });
    });
    return pendingTail;
}

export function readPending(cb) { idbGet(PENDING_KEY, function (value) { cb(value && value.version === 1 ? value : null); }); }
export function persistCacheRevisions() { idbPut(MANIFEST_KEY, DB.cachedPartRevisions); }

export function fetchStorage(url, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 30000);
    var init = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {});
    if (controller) init.signal = controller.signal;
    return fetch(url, init).then(function (response) {
        return response.json().then(function (body) { return { response: response, body: body }; });
    }).finally(function () { clearTimeout(timer); });
}

export function readRemotePartition(key) {
    return fetchStorage(SERVER_BASE + '/partitions/' + encodeURIComponent(key)).then(function (result) {
        if (!result.response.ok || !result.body.ok || !result.body.data || !/^[a-f0-9]{64}$/.test(result.body.revision || '')) throw new Error('衣柜载入失败：' + key);
        return result.body;
    });
}

export async function sendIncremental(entries, options) {
    options = options || {};
    var body = { base: {}, partitions: {}, deleteKeys: [] };
    entries.forEach(function (entry) {
        var key = entry.key;
        if (DB.deletedPartKeys[key]) return;
        body.base[key] = DB.remotePartRevisions[key] || null;
        if (key === 'meta') body.meta = metaForStorage(DB.metaCache);
        else if (DB.partCache[key]) body.partitions[key] = partitionForStorage(key, DB.partCache[key]);
    });
    if (options.full) {
        body.meta = metaForStorage(DB.metaCache);
        body.base.meta = DB.remotePartRevisions.meta || null;
        Object.keys(DB.partCache).forEach(function (key) {
            if (DB.deletedPartKeys[key]) return;
            body.partitions[key] = partitionForStorage(key, DB.partCache[key]);
            body.base[key] = DB.remotePartRevisions[key] || null;
        });
    }
    if (body.meta) Object.keys(DB.pendingPartitionDeletes).forEach(function (key) {
        if (!DB.deletedPartKeys[key]) return;
        body.deleteKeys.push(key); body.base[key] = DB.remotePartRevisions[key] || null;
    });
    var raw;
    try { raw=JSON.stringify(await prepareOutgoingImages(body)); }
    catch(error){setSyncState('error',error.message||'本地图片尚未同步');return false;}
    setSyncState('saving');
    return getWriteHeaders().then(function (headers) {
        return fetchStorage(SERVER_BASE + '/partitions/patch', { method: 'PUT', headers: headers, body: raw });
    }).then(function (result) {
        if (result.response.status === 403) DB.csrfToken = null;
        if (!result.response.ok || !result.body.ok) {
            if (result.body.code === 'EDIT_CONFLICT' || result.body.code === 'STALE_CLIENT_REVISION') {
                DB.syncConflict = { at: Date.now(), code: result.body.code, conflicts: result.body.conflicts || [], message: result.body.error };
                setSyncState('conflict', result.body.error);
            } else setSyncState('error', result.body.error || ('保存失败：HTTP ' + result.response.status));
            return false;
        }
        var revisions = result.body.revisions || {};
        Object.keys(revisions).forEach(function (key) {
            if (revisions[key]) DB.remotePartRevisions[key] = revisions[key];
            else { delete DB.remotePartRevisions[key]; delete DB.cachedPartRevisions[key]; }
        });
        entries.forEach(function (entry) {
            var key = entry.key, canonical = result.body.partitions && result.body.partitions[key];
            if (canonical && (DB.partRevisions[key] || 0) === entry.revision) {
                DB.libraryActiveIds[key] = (canonical.activeIds || []).slice();
                DB.partCache[key] = applyChatPartition(key, canonical);
                idbPut(key, partitionForStorage(key, canonical));
                DB.queuedPartitionJSON[key] = JSON.stringify(partitionForStorage(key, canonical));
                DB.cachedPartRevisions[key] = revisions[key];
            }
        });
        body.deleteKeys.forEach(function (key) {
            if (DB.pendingPartitionDeletes[key]) DB.pendingPartitionDeletes[key].serverCommitted = true;
        });
        DB.syncRetryCount = 0; DB.syncConflict = null;
        persistCacheRevisions();
        setSyncState(Object.keys(DB.dirtyPartKeys).length ? 'pending' : 'saved', result.body.backupWarning ? '内容已保存，备份副本暂未更新：' + result.body.backupWarning : null);
        scheduleServerCheckpoint();
        return true;
    }).catch(function (error) {
        setSyncState('error', error.name === 'AbortError' ? '保存超时，待同步内容仍保存在本机。' : '网络中断，待同步内容仍保存在本机。');
        return false;
    });
}

export function retrySync() {
    if (DB.syncConflict) return false;
    if (DB.serverMode && !DB.serverSupportsPartitions) { scheduleServerPut(); return true; }
    if (typeof DB.flushIncremental === 'function') DB.flushIncremental();
    return true;
}

export function resolveSyncConflicts(choices) {
    if (!DB.syncConflict) return Promise.resolve(false);
    if (DB.syncConflict.code === 'STALE_CLIENT_REVISION') return Promise.reject(new Error('服务器已执行恢复，请先导出本地备份，再重新检测存储。'));
    var conflicts = DB.syncConflict.conflicts || [];
    if (conflicts.some(function (item) { return choices[item.key] !== 'local' && choices[item.key] !== 'remote'; })) return Promise.reject(new Error('请为每个冲突选择要保留的内容。'));
    return new Promise(function (resolve) { idbPut('om_conflict_backup_v3', JSON.parse(JSON.stringify({ meta: DB.metaCache, partitions: DB.partCache, at: Date.now() })), resolve); })
    .then(function (backedUp) {
        if (!backedUp) throw new Error('无法保存冲突前的本地副本，已保留待处理状态。');
        return Promise.all(conflicts.map(function (item) {
            return fetchStorage(SERVER_BASE + '/partitions/' + encodeURIComponent(item.key)).then(function (result) {
                if (result.response.status === 404) return { key: item.key, data: null, revision: null };
                if (!result.response.ok || !result.body.ok) throw new Error('无法重新读取冲突衣柜');
                return { key: item.key, data: result.body.data, revision: result.body.revision };
            });
        }));
    }).then(function (latest) {
        latest.forEach(function (value) {
            DB.remotePartRevisions[value.key] = value.revision;
            if (choices[value.key] === 'remote') {
                delete DB.dirtyPartKeys[value.key];
                delete DB.pendingPartitionDeletes[value.key]; delete DB.deletedPartKeys[value.key];
                if (value.key === 'meta') {
                    if (!value.data) throw new Error('服务器索引缺失，需要恢复');
                    DB.metaCache = value.data; DB.libraryPresetId = value.data.activePresetId || null;
                } else if (value.data) {
                    DB.libraryActiveIds[value.key] = (value.data.activeIds || []).slice();
                    DB.partCache[value.key] = applyChatPartition(value.key, value.data);
                    DB.knownPartKeys[value.key] = true;
                } else { delete DB.partCache[value.key]; delete DB.knownPartKeys[value.key]; }
                if (value.data) idbPut(value.key, value.data);
                DB.queuedPartitionJSON[value.key] = JSON.stringify(value.key === 'meta' ? metaForStorage(DB.metaCache) : value.data && partitionForStorage(value.key, value.data));
            }
        });
        DB.syncConflict = null;
        setSyncState(Object.keys(DB.dirtyPartKeys).length ? 'pending' : 'saved'); persistPending(); retrySync(); return true;
    });
}
