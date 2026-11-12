// Outfit Manager · 二改版 | 服务端分区读写与保存调度
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { SHARED_CHAR_KEY, defMeta, defPartition } from '../data.js';
import { idbDelete } from './idb.js';
import { collectRequiredPartKeys } from './init.js';
import { getWriteHeaders, scheduleServerCheckpoint, scheduleServerPut } from './server.js';
import { DB, SERVER_BASE, SERVER_DEBOUNCE_MS, SERVER_READ_MAX_ATTEMPTS, SERVER_READ_RETRY_MS } from './state.js';
import { currentUserPartKey } from './view.js';
import { sendIncremental, persistPending, setSyncState } from './incremental.js';
import { metaForStorage, partitionForStorage } from '../chat-state.js';
import { prepareOutgoingImages } from './images.js';

// ── v2 分包模式 server 通信 ─────────────────────────────

// 统一调度：根据后端版本选择全量或分包
export function scheduleServerPutKey(key) {
    if (!DB.serverMode) return;
    if (DB.suppressServerWrites) return;
    if (!DB.serverSupportsPartitions) {
        scheduleServerPut(); // v1 后端走全量
        return;
    }
    if (!DB.serverHydrated || DB.serverInitFailed) return;
    if (DB.serverSupportsIncremental) {
        var value = key === 'meta' ? metaForStorage(DB.metaCache) : DB.partCache[key] && partitionForStorage(key, DB.partCache[key]);
        var json;
        try { json = JSON.stringify(value); } catch (error) { setSyncState('error', '衣柜内容无法序列化'); return; }
        if (json === DB.queuedPartitionJSON[key]) return;
        DB.queuedPartitionJSON[key] = json;
    }
    var revision = (DB.partRevisions[key] || 0) + 1;
    DB.partRevisions[key] = revision;
    DB.dirtyPartKeys[key] = revision;
    setSyncState(DB.syncConflict ? 'conflict' : 'pending');
    if (DB.serverSupportsIncremental) persistPending();
    schedulePartitionFlush();
}

export function schedulePartitionFlush(delay) {
    if (DB.partFlushTimer) clearTimeout(DB.partFlushTimer);
    DB.partFlushTimer = setTimeout(function () {
        DB.partFlushTimer = null;
        flushDirtyPartitions();
    }, delay === undefined ? SERVER_DEBOUNCE_MS : delay);
}

// 批量 flush 所有 dirty key
export function flushDirtyPartitions() {
    if (DB.serverSupportsPartitions && (!DB.serverHydrated || DB.serverInitFailed)) {
        DB.dirtyPartKeys = {};
        return;
    }
    if (DB.partFlushInFlight) return;
    if (DB.serverSupportsIncremental && DB.syncConflict) return;
    var keys = Object.keys(DB.dirtyPartKeys).sort(function (a, b) {
        if (a === 'meta') return 1;
        if (b === 'meta') return -1;
        return a.localeCompare(b);
    });
    if (keys.length === 0) return;
    var batch = keys.map(function (key) { return { key: key, revision: DB.dirtyPartKeys[key] }; });
    DB.dirtyPartKeys = {};
    DB.partFlushInFlight = true;
    if (DB.serverSupportsIncremental) {
        DB.sendingPartKeys = {};
        batch.forEach(function (entry) { DB.sendingPartKeys[entry.key] = entry.revision; });
        persistPending().then(function (saved) { return saved === false ? false : sendIncremental(batch); }).then(function (ok) {
            if (!ok) batch.forEach(function (entry) {
                if (!DB.deletedPartKeys[entry.key]) DB.dirtyPartKeys[entry.key] = DB.partRevisions[entry.key] || entry.revision;
            });
            else commitPendingPartitionDeletes(false);
            DB.partFlushInFlight = false; DB.sendingPartKeys = {};
            persistPending();
            if (Object.keys(DB.dirtyPartKeys).length && !DB.syncConflict) {
                DB.syncRetryCount = ok ? 0 : (DB.syncRetryCount || 0) + 1;
                schedulePartitionFlush(ok ? 0 : Math.min(30000, 1000 * Math.pow(2, DB.syncRetryCount)));
            }
        });
        return;
    }
    var allSucceeded = true;
    setSyncState('saving');
    var index = 0;

    function finish() {
        DB.partFlushInFlight = false;
        setSyncState(!allSucceeded ? 'error' : Object.keys(DB.dirtyPartKeys).length ? 'pending' : 'saved', !allSucceeded ? '后端保存失败，待保存修改仍在本机。' : null);
        if (allSucceeded) scheduleServerCheckpoint();
        if (Object.keys(DB.dirtyPartKeys).length > 0) schedulePartitionFlush(allSucceeded ? 0 : SERVER_DEBOUNCE_MS);
    }

    function next() {
        if (index >= batch.length) { finish(); return; }
        var entry = batch[index++];
        var key = entry.key;
        // 跳过已被删除的 key（tombstone 防复活）
        if (DB.deletedPartKeys[key]) { next(); return; }
        var data = (key === 'meta') ? DB.metaCache : DB.partCache[key];
        if (!data) { next(); return; }
        serverPutPartition(key, data, function (ok) {
            if (!ok) {
                allSucceeded = false;
                var latest = DB.partRevisions[key] || entry.revision;
                if (!DB.deletedPartKeys[key]) DB.dirtyPartKeys[key] = latest;
            } else if (key === 'meta' && DB.partRevisions[key] === entry.revision) {
                // 只有当前最新 meta revision 成功后，才能提交此前登记的分包删除。
                commitPendingPartitionDeletes(true);
            }
            next();
        });
    }
    var metaEntry = batch.find(function (entry) { return entry.key === 'meta'; });
    if (metaEntry && DB.serverSupportsPartitionTransactions) {
        serverPutPartitionDataset(function (ok) {
            if (!ok) {
                allSucceeded = false;
                batch.forEach(function (entry) {
                    if (!DB.deletedPartKeys[entry.key]) DB.dirtyPartKeys[entry.key] = DB.partRevisions[entry.key] || entry.revision;
                });
            } else if (DB.partRevisions.meta === metaEntry.revision) {
                markDatasetDeletesCommitted();
            }
            finish();
        });
        return;
    }
    next();
}

export async function serverPutPartitionDataset(cb) {
    if (DB.serverSupportsIncremental) {
        var entries = ['meta'].concat(Object.keys(DB.partCache)).map(function (key) { return { key: key, revision: DB.partRevisions[key] || 0 }; });
        sendIncremental(entries, { full: true }).then(cb); return;
    }
    var meta = DB.metaCache || defMeta();
    var partitions = {};
    var keys = collectRequiredPartKeys(meta);
    for (var i = 0; i < keys.length; i++) {
        if (!DB.partCache[keys[i]]) { cb(false); return; }
        partitions[keys[i]] = DB.partCache[keys[i]];
    }
    var raw;
    try { raw = JSON.stringify(await prepareOutgoingImages({ meta: meta, partitions: partitions })); }
    catch (err) { cb(false); return; }
    getWriteHeaders().then(function (headers) {
        return fetch(SERVER_BASE + '/partitions/batch', {
            method: 'PUT', credentials: 'same-origin', headers: headers, body: raw
        });
    }).then(function (res) {
        if (res && res.status === 403) DB.csrfToken = null;
        cb(!!(res && res.ok));
    }).catch(function () { cb(false); });
}

// PUT 单个 partition 到 v2 后端
export async function serverPutPartition(key, data, cb) {
    if (!DB.serverHydrated || DB.serverInitFailed) { if (cb) cb(false); return; }
    var raw;
    try { raw = JSON.stringify(await prepareOutgoingImages(key === 'meta' ? metaForStorage(data) : partitionForStorage(key, data))); }
    catch (err) { if (cb) cb(false); return; }
    var succeeded = false;
    getWriteHeaders().then(function (headers) {
        return fetch(SERVER_BASE + '/partitions/' + encodeURIComponent(key), {
            method: 'PUT',
            credentials: 'same-origin',
            headers: headers,
            body: raw
        });
    }).then(function (r) {
        if (r && r.status === 403) { DB.csrfToken = null; }
        succeeded = !!(r && r.ok);
    }).catch(function () { succeeded = false; }).then(function () {
        if (cb) cb(succeeded);
    });
}

export function metaReferencesPartition(key) {
    if (key === 'user:__default__') return true;
    var meta = DB.metaCache || {};
    var referenced = false;
    (meta.presets || []).forEach(function (item) { if (item && item.partKey === key) referenced = true; });
    (meta.charIndex || []).forEach(function (item) { if (item && item.partKey === key) referenced = true; });
    return referenced;
}

export function commitPendingPartitionDeletes(serverSide) {
    function retry() {
        if (DB.partitionDeleteRetryTimer) return;
        DB.partitionDeleteRetryTimer = setTimeout(function () {
            DB.partitionDeleteRetryTimer = null;
            commitPendingPartitionDeletes(DB.serverMode && DB.serverSupportsPartitions);
        }, SERVER_DEBOUNCE_MS);
    }
    function finishIfDone(key, pending) {
        var serverDone = !DB.serverMode || !DB.serverSupportsPartitions || pending.serverCommitted;
        if (pending.localCommitted && serverDone) delete DB.pendingPartitionDeletes[key];
    }
    Object.keys(DB.pendingPartitionDeletes).forEach(function (key) {
        var pending = DB.pendingPartitionDeletes[key];
        if (!pending || metaReferencesPartition(key)) return;
        if (!pending.localCommitted && !pending.localInFlight) {
            pending.localInFlight = true;
            idbDelete(key, function (ok) {
                pending.localInFlight = false;
                pending.localCommitted = !!ok;
                if (!ok) retry();
                finishIfDone(key, pending);
            });
        }
        if (serverSide && DB.serverMode && DB.serverSupportsPartitions && !pending.serverCommitted && !pending.serverInFlight) {
            pending.serverInFlight = true;
            sendDeletePartition(key, function (ok) {
                pending.serverInFlight = false;
                pending.serverCommitted = !!ok;
                if (!ok) {
                    retry();
                    return;
                }
                finishIfDone(key, pending);
            });
        }
        finishIfDone(key, pending);
    });
}

export function markDatasetDeletesCommitted() {
    Object.keys(DB.pendingPartitionDeletes).forEach(function (key) {
        var pending = DB.pendingPartitionDeletes[key];
        if (pending && !metaReferencesPartition(key)) pending.serverCommitted = true;
    });
    commitPendingPartitionDeletes(false);
}

// 旧 v2 后端没有 batch 事务时，meta 成功后才会走这个兼容 DELETE。
export function sendDeletePartition(key, cb) {
    if (!DB.serverHydrated || DB.serverInitFailed) { if (cb) cb(false); return; }
    var succeeded = false;
    getWriteHeaders().then(function (headers) {
        return fetch(SERVER_BASE + '/partitions/' + encodeURIComponent(key), {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: headers
        });
    }).then(function (r) {
        if (r && r.status === 403) { DB.csrfToken = null; }
        succeeded = !!(r && r.ok);
    }).catch(function () { succeeded = false; }).then(function () {
        if (succeeded) scheduleServerCheckpoint();
        if (cb) cb(succeeded);
    });
}

export function serverReadFailure(kind, status, error, retryable) {
    return {
        ok: false,
        status: status || 0,
        found: false,
        data: null,
        error: error || kind,
        kind: kind,
        retryable: !!retryable
    };
}

// 读取响应必须保留 404、500、网络错误、解析错误等语义；一个 null 无法安全表示这些状态。
export function fetchServerJson(url) {
    return fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        if (!r || typeof r.status !== 'number') {
            return serverReadFailure('unexpected_response', 0, 'Missing HTTP response', false);
        }
        if (r.status === 404) {
            return { ok: true, status: 404, found: false, data: null, error: null, kind: 'not_found', retryable: false };
        }
        if (!r.ok) {
            return serverReadFailure('http_error', r.status, 'HTTP ' + r.status, r.status >= 500);
        }
        return r.json().then(function (body) {
            return { ok: true, status: r.status, found: true, data: body, error: null, kind: null, retryable: false };
        }, function (err) {
            return serverReadFailure('parse_error', r.status, err && err.message ? err.message : 'Invalid JSON', true);
        });
    }, function (err) {
        return serverReadFailure('network_error', 0, err && err.message ? err.message : 'Network error', true);
    });
}

export function retryServerRead(label, readFn, cb, attempt) {
    var n = attempt || 1;
    function handleResult(result) {
        if (!result.ok && result.retryable && n < SERVER_READ_MAX_ATTEMPTS) {
            try { console.warn('[outfit-manager] ' + label + ' 读取失败，准备重试 (' + n + '/' + SERVER_READ_MAX_ATTEMPTS + '):', result.error); } catch (e) {}
            setTimeout(function () { retryServerRead(label, readFn, cb, n + 1); }, SERVER_READ_RETRY_MS * n);
            return;
        }
        result.attempts = n;
        cb(result);
    }
    var request;
    try { request = readFn(); }
    catch (err) { handleResult(serverReadFailure('network_error', 0, err && err.message, true)); return; }
    Promise.resolve(request).then(handleResult, function (err) {
        handleResult(serverReadFailure('network_error', 0, err && err.message, true));
    });
}

// GET 单个 partition（v2 启动加载用）
export function serverGetPartition(key, cb) {
    var label = 'partition ' + key;
    retryServerRead(label, function () {
        return fetchServerJson(SERVER_BASE + '/partitions/' + encodeURIComponent(key)).then(function (result) {
            if (!result.ok || !result.found) return result;
            var body = result.data;
            if (!body || typeof body !== 'object' || body.ok !== true || !Object.prototype.hasOwnProperty.call(body, 'data')) {
                return serverReadFailure('unexpected_response', result.status, 'Unexpected partition response', false);
            }
            // 旧 v2 后端以 200 + data:null 表示文件不存在；保留 found=false，由初始化上下文决定是否安全。
            if (body.data === null || body.data === undefined) {
                return { ok: true, status: result.status, found: false, data: null, error: null, kind: 'legacy_null', retryable: false, legacyNull: true };
            }
            if (body.revision) DB.remotePartRevisions[key] = body.revision;
            return { ok: true, status: result.status, found: true, data: body.data, revision: body.revision || null, error: null, kind: null, retryable: false };
        });
    }, cb);
}

DB.flushIncremental = flushDirtyPartitions;

// GET /partitions/keys（v2 启动用）
export function serverGetPartitionKeys(cb) {
    retryServerRead('partition keys', function () {
        return fetchServerJson(SERVER_BASE + '/partitions/keys').then(function (result) {
            if (!result.ok) return result;
            if (!result.found) return serverReadFailure('not_found', result.status, 'Partition keys endpoint not found', false);
            var body = result.data;
            if (!body || typeof body !== 'object' || body.ok !== true || !Array.isArray(body.keys)) {
                return serverReadFailure('unexpected_response', result.status, 'Unexpected partition keys response', false);
            }
            return { ok: true, status: result.status, found: true, data: body.keys, error: null, kind: null, retryable: false };
        });
    }, cb);
}

// 从内存重组 v1 格式的完整数据（server 兼容用）
export function reassembleFullData() {
    var meta = DB.metaCache || defMeta();
    var d = {};

    // 设置字段
    var settingsKeys = [
        'mode', 'injectPosition', 'singleTemplate', 'multiTemplate',
        'charSingleTemplate', 'charMultiTemplate', 'imagePrompt', 'multiImagePrompt',
        'debug', 'injectionBudget', 'slotRules', 'apiVision', 'showBall', 'fabImage', 'fabSize', 'fabPos', 'tagOrder', 'wearHistory', 'uiTheme', 'gridCols', 'customAccent', 'dupIgnore',
        'currentView', 'currentChar'
    ];
    settingsKeys.forEach(function (k) { if (meta[k] !== undefined) d[k] = meta[k]; });

    // currentChar: 还原为角色名
    if (meta.currentChar && meta.charIndex) {
        var found = null;
        for (var i = 0; i < meta.charIndex.length; i++) {
            if (meta.charIndex[i].id === meta.currentChar) { found = meta.charIndex[i].name; break; }
        }
        d.currentChar = found || '';
    }

    // User 默认预设
    var activePartKey = currentUserPartKey();
    var userPart = DB.partCache[activePartKey] || defPartition();
    d.outfits = userPart.outfits || [];
    d.categories = userPart.categories || [];
    d.activeIds = userPart.activeIds || [];
    d.accessories = userPart.accessories || [];
    d.accCategories = userPart.accCategories || [];

    // 预设：重组为旧格式（presets 数组内嵌 outfits）
    d.presets = [];
    d.activePresetId = meta.activePresetId || null;
    (meta.presets || []).forEach(function (pi) {
        var pp = DB.partCache[pi.partKey] || null;
        if (pp) {
            d.presets.push({
                id: pi.id,
                name: pi.name,
                outfits: pp.outfits || [],
                categories: pp.categories || [],
                activeIds: pp.activeIds || [],
                accessories: pp.accessories || [],
                accCategories: pp.accCategories || []
            });
        } else {
            // partition 未加载时写索引占位
            d.presets.push({ id: pi.id, name: pi.name, outfits: [], categories: [], activeIds: [], accessories: [], accCategories: [] });
        }
    });

    // Char 数据
    d.chars = {};
    d.charNames = [];
    d.charFavorites = [];
    d.charGroups = {};

    if (meta.charIndex) {
        meta.charIndex.forEach(function (ci) {
            var name = ci.name;
            var partKey = ci.partKey;
            if (ci.id === SHARED_CHAR_KEY) {
                // 通用衣柜
                var sp = DB.partCache[partKey] || defPartition();
                d.chars[SHARED_CHAR_KEY] = { outfits: sp.outfits || [], categories: sp.categories || [], activeIds: sp.activeIds || [], accessories: sp.accessories || [], accCategories: sp.accCategories || [] };
            } else {
                d.charNames.push(name);
                var cp = DB.partCache[partKey] || defPartition();
                d.chars[name] = { outfits: cp.outfits || [], categories: cp.categories || [], activeIds: cp.activeIds || [], accessories: cp.accessories || [], accCategories: cp.accCategories || [] };
            }
        });
    }

    // charFavorites: id → name
    if (meta.charFavorites && meta.charIndex) {
        meta.charFavorites.forEach(function (cid) {
            for (var j = 0; j < meta.charIndex.length; j++) {
                if (meta.charIndex[j].id === cid) { d.charFavorites.push(meta.charIndex[j].name); break; }
            }
        });
    }

    // charGroups: id → name
    if (meta.charGroups && meta.charIndex) {
        for (var gn in meta.charGroups) {
            d.charGroups[gn] = [];
            (meta.charGroups[gn] || []).forEach(function (cid) {
                for (var j = 0; j < meta.charIndex.length; j++) {
                    if (meta.charIndex[j].id === cid) { d.charGroups[gn].push(meta.charIndex[j].name); break; }
                }
            });
        }
    }

    return d;
}
