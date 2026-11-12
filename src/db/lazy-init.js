// Outfit Manager · 二改版 | 按需读取的启动状态
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, SERVER_BASE } from './state.js';
import { idbGet, idbPut } from './idb.js';
import { maintainPartitionCache } from './partitions.js';
import { ensureMetaDefaults, ensurePartDefaults } from '../data.js';
import { getChatState, applyChatContext, applyChatPartition } from '../chat-state.js';
import { validateMetaPayload, validatePartitionPayload, collectRequiredPartKeys, failServerInitialization, initLocal, uploadLocalToServerV2, normalizeHydratedServerState } from './init.js';
import { fetchStorage, readRemotePartition, readPending, MANIFEST_KEY, persistCacheRevisions, setSyncState } from './incremental.js';

function localGet(key) { return new Promise(function (resolve) { idbGet(key, resolve); }); }
function localPut(key, value) { return new Promise(function (resolve) { idbPut(key, value, resolve); }); }

export function initFromServerIncremental(cb) {
    DB.suppressServerWrites = true;
    fetchStorage(SERVER_BASE + '/partitions/manifest').then(function (result) {
        var manifest = result.body;
        if (!result.response.ok || !manifest.ok || !manifest.validated || !Array.isArray(manifest.keys) || !manifest.revisions) throw new Error(manifest.error || '后端分包清单无效');
        DB.remotePartRevisions = Object.assign({}, manifest.revisions);
        if (manifest.state === 'NEW_INSTALL' && manifest.meta === null && manifest.keys.length === 0) {
            DB.initialUpload = true;
            return new Promise(function (resolve, reject) {
                initLocal(function () {
                    DB.serverHydrated = true; DB.serverInitFailed = false;
                    normalizeHydratedServerState();
                    uploadLocalToServerV2(function (ok) { if (ok) resolve(); else reject(new Error('本地数据上传失败，原数据已保留')); });
                });
            });
        }
        var error = validateMetaPayload(manifest.meta);
        if (error) throw new Error(error);
        var required = collectRequiredPartKeys(manifest.meta);
        if (manifest.keys.some(function (key) { return key !== 'meta' && !/^(user:(__default__|[A-Za-z0-9_-]+)|char:(__shared__|c_[A-Za-z0-9]{8}))$/.test(key); }) ||
            manifest.keys.some(function (key) { return !/^[a-f0-9]{64}$/.test(manifest.revisions[key] || ''); }) ||
            required.some(function (key) { return manifest.keys.indexOf(key) === -1; })) throw new Error('衣柜目录引用的分包缺失或版本无效');
        return Promise.all([localGet(MANIFEST_KEY), new Promise(readPending)]).then(function (values) {
            DB.cachedPartRevisions = values[0] || {};
            var pending = values[1];
            DB.metaCache = ensureMetaDefaults(pending && pending.meta ? pending.meta : manifest.meta);
            DB.libraryPresetId = DB.metaCache.activePresetId || null;
            DB.queuedPartitionJSON = { meta: JSON.stringify(manifest.meta) };
            DB.partCache = {}; DB.knownPartKeys = {}; DB.libraryActiveIds = {}; DB.deletedPartKeys = {};
            manifest.keys.forEach(function (key) { if (key !== 'meta') DB.knownPartKeys[key] = true; });
            if (pending) {
                Object.keys(pending.partitions || {}).forEach(function (key) {
                    if (validatePartitionPayload(pending.partitions[key], key)) throw new Error('本地待同步分包无效：' + key);
                    DB.partCache[key] = ensurePartDefaults(pending.partitions[key]); DB.knownPartKeys[key] = true;
                    DB.partRevisions[key] = 1; DB.dirtyPartKeys[key] = 1;
                });
                if (pending.meta) { DB.partRevisions.meta = 1; DB.dirtyPartKeys.meta = 1; }
                Object.keys(pending.base || {}).forEach(function (key) { DB.remotePartRevisions[key] = pending.base[key]; });
                (pending.deletes || []).forEach(function (key) {
                    DB.deletedPartKeys[key] = true;
                    DB.pendingPartitionDeletes[key] = { localCommitted: false, serverCommitted: false };
                    delete DB.knownPartKeys[key];
                });
                DB.syncConflict = pending.conflict || null;
            }
            var chat = getChatState();
            var active = chat ? chat.active : (DB.metaCache.activePartitions || {});
            var presetId = chat ? chat.presetId : DB.metaCache.activePresetId;
            var userKey = presetId ? 'user:' + presetId : 'user:__default__';
            var currentKey = DB.metaCache.currentView === 'char' && DB.metaCache.currentChar ? 'char:' + DB.metaCache.currentChar : userKey;
            var preload = Array.from(new Set([currentKey, userKey].concat(Object.keys(active)))).filter(function (key) { return DB.knownPartKeys[key]; });
            var next = 0;
            function loadNext() {
                if (next >= preload.length) return Promise.resolve();
                return loadIncrementalPartition(preload[next++]).then(loadNext);
            }
            return loadNext().then(function () { applyChatContext(); return localPut('meta', manifest.meta); });
        });
    }).then(function () {
        DB.initialUpload = false;
        DB.serverHydrated = true; DB.serverInitFailed = false; DB.suppressServerWrites = false;
        normalizeHydratedServerState();
        maintainPartitionCache();
        persistCacheRevisions();
        setSyncState(DB.syncConflict ? 'conflict' : (Object.keys(DB.dirtyPartKeys).length ? 'pending' : 'saved'));
        cb(null);
        if (Object.keys(DB.dirtyPartKeys).length && !DB.syncConflict && DB.flushIncremental) DB.flushIncremental();
    }).catch(function (error) {
        DB.initialUpload = false;
        DB.suppressServerWrites = false;
        failServerInitialization('后端按需载入失败：' + error.message, { error: error.message }, cb, 'INCREMENTAL_INIT_FAILED');
    });
}

export function loadIncrementalPartition(key) {
    if (DB.partCache[key]) return Promise.resolve(applyChatPartition(key, DB.partCache[key]));
    return localGet(key).then(function (cached) {
        if (cached && DB.cachedPartRevisions[key] === DB.remotePartRevisions[key] && DB.remotePartRevisions[key] && !validatePartitionPayload(cached, key)) return { data: cached, revision: DB.remotePartRevisions[key] };
        return readRemotePartition(key);
    }).then(function (value) {
        var error = validatePartitionPayload(value.data, key);
        if (error) throw new Error(error);
        DB.libraryActiveIds[key] = (value.data.activeIds || []).slice();
        DB.remotePartRevisions[key] = value.revision;
        DB.cachedPartRevisions[key] = value.revision;
        var stored = JSON.parse(JSON.stringify(value.data));
        DB.queuedPartitionJSON[key] = JSON.stringify(stored);
        DB.partCache[key] = applyChatPartition(key, ensurePartDefaults(value.data));
        delete DB.partLoadErrors[key];
        return localPut(key, stored).then(function () { persistCacheRevisions(); return DB.partCache[key]; });
    });
}
