// Outfit Manager · 二改版 | 衣柜分区读写与内存管理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { defPartition, ensurePartDefaults } from '../data.js';
import { captureRuntimeError } from '../runtime-errors.js';
import { idbGet, idbPut } from './idb.js';
import { save } from './legacy.js';
import { scheduleServerPutKey } from './server-partitions.js';
import { DB } from './state.js';
import { currentPartKey } from './view.js';
import { applyChatPartition, captureChatSelection, partitionForStorage, getChatState } from '../chat-state.js';
import { loadIncrementalPartition } from './lazy-init.js';
import { setSyncState } from './incremental.js';
import { readLocalPartition } from './local-partitions.js';

//  Partition 读写
// ══════════════════════════════════════════════════════════

// 衣柜按需载入，当前衣柜与正在穿着的分区保持驻留。
// 本地和支持增量事务的服务端可释放闲置缓存，兼容模式保留所需数据。

export function setPartitionLoadedHandler(handler) {
    DB.onPartitionLoaded = handler;
}

// 必须驻留的分包：当前视角 + meta.activePartitions 里在穿的
export function pinnedPartKeys() {
    var pins = {};
    try {
        var cur = currentPartKey();
        if (cur) pins[cur] = true;
    } catch (e) {}
    var meta = DB.metaCache;
    if (meta) {
        var chat = getChatState();
        var ap = chat ? chat.active : (meta.activePartitions || {});
        for (var k in ap) {
            if (ap[k] && ap[k].length > 0) pins[k] = true;
        }
        if (meta.activePresetId) pins['user:' + meta.activePresetId] = true;
    }
    return pins;
}

// 后端事务模式要求全量驻留；其余情况都可以驱逐。
//
// 为什么事务模式下必须全量：提交走 serverPutPartitionDataset()，它把
// meta + 所有分包拼成一个 JSON 一次性 PUT，少一个分包就直接 cb(false)。
// 所以「冷包」在这种模式下根本没东西可提交 —— 这是设计上的硬约束，
// 不是开关写错了。诊断面板会把具体原因说出来，免得看着像 bug。
export function lazyCacheReason() {
    if (DB.bulkLoadDepth) return 'bulkOperation';
    if (DB.exportInProgress) return 'export';
    if (DB.initialUpload) return 'initialUpload';
    if (DB.serverInitFailed) return 'serverInitFailed';
    if (DB.serverMode && DB.serverSupportsPartitions && DB.serverSupportsPartitionTransactions && !DB.serverSupportsIncremental) return 'serverTransactions';
    if (DB.metaCache && DB.metaCache.lazyPartitions === false) return 'userOff';
    return 'on';
}

export function lazyCacheAllowed() {
    return lazyCacheReason() === 'on';
}

// 冷分包的稳定占位对象。同一个 key 永远返回同一个引用，
// 这样旧 save(d) 里「靠 outfits 引用相等识别角色改名」的逻辑才不会误判成删除+新建。
export function coldStubFor(partKey) {
    if (!DB.partColdStub[partKey]) {
        var stub = defPartition();
        stub.__omCold = true;
        DB.partColdStub[partKey] = stub;
    }
    return DB.partColdStub[partKey];
}

// ── 分包 LRU ──────────────────────────────────────────────
// 目的：A 衣柜 → B 衣柜 → 回 A，不要让 A 重新从 IndexedDB 读一遍。
// 带图的分包读一次要 50~150ms，来回切两下就是肉眼可见的顿。
//
// 代价是内存里多留一个分包，所以只在「这个分包不重」时才多留：
// 服务端模式下 imageData 是同源 URL（几十字节），留一份几乎不花钱；
// 本地模式下 imageData 是 base64（每张几百 KB），多留一份就是几百 MB，不做。
export var PART_LRU_MAX = 24;

export function touchPartitionLru(partKey) {
    if (!partKey) return;
    if (!DB.partLru) DB.partLru = [];
    var i = DB.partLru.indexOf(partKey);
    if (i !== -1) DB.partLru.splice(i, 1);
    DB.partLru.push(partKey);
    if (DB.partLru.length > PART_LRU_MAX) DB.partLru = DB.partLru.slice(-PART_LRU_MAX);
}

// 抽样判断这个分包重不重：只要头几套是 base64 图，就当成重分包
export function isHeavyPartition(data) {
    if (!data || !data.outfits || !data.outfits.length) return false;
    var n = Math.min(data.outfits.length, 3);
    for (var i = 0; i < n; i++) {
        var img = data.outfits[i] && data.outfits[i].imageData;
        if (typeof img === 'string' && img.indexOf('data:image/') === 0) return true;
    }
    return false;
}

export function isColdPartition(partKey) {
    return !DB.partCache[partKey] && !!DB.knownPartKeys[partKey];
}

// 从 IndexedDB 把一个冷分包读回内存
export function startPartitionLoad(partKey, firstCallback) {
    if (DB.partLoadCbs[partKey]) { if (firstCallback) DB.partLoadCbs[partKey].push(firstCallback); return; }
    DB.partLoadCbs[partKey] = firstCallback ? [firstCallback] : [];
    function loaded(raw, error) {
        if (error || !raw) {
            captureRuntimeError(error || new Error('衣柜读取失败'), { operation: 'load', source: 'src/db/partitions.js' });
            DB.partLoadErrors[partKey] = { at: Date.now(), message: error ? error.message : '本地衣柜未能读取，已停止写入' };
            var failedCallbacks = DB.partLoadCbs[partKey] || [];
            delete DB.partLoadCbs[partKey];
            failedCallbacks.forEach(function (cb) { try { cb(null, error || new Error('衣柜读取失败')); } catch (failure) {} });
            return;
        }
        var data = ensurePartDefaults(raw);
        delete DB.partLoadErrors[partKey];
        delete DB.partColdStub[partKey];
        DB.partCache[partKey] = applyChatPartition(partKey, data);
        touchPartitionLru(partKey);
        var cbs = DB.partLoadCbs[partKey] || [];
        delete DB.partLoadCbs[partKey];
        for (var i = 0; i < cbs.length; i++) {
            try { cbs[i](data); } catch (eCb) {}
        }
        if (DB.onPartitionLoaded) {
            try { DB.onPartitionLoaded(partKey); } catch (eHook) {}
        }
    }
    if (DB.serverMode && DB.serverSupportsIncremental) loadIncrementalPartition(partKey).then(function (data) { loaded(data); }, function (error) { loaded(null, error); });
    else readLocalPartition(partKey, loaded);
}

// 确保某个分包已驻留；已驻留则同步回调
export function ensurePartitionLoaded(partKey, cb) {
    if (DB.serverInitFailed) { if (cb) cb(null); return; }
    if (DB.partCache[partKey]) { touchPartitionLru(partKey); if (cb) cb(DB.partCache[partKey]); return; }
    if (!DB.knownPartKeys[partKey]) {
        // 真正不存在的分包（新建）才允许直接创建
        DB.partCache[partKey] = defPartition();
        touchPartitionLru(partKey);
        if (cb) cb(DB.partCache[partKey]);
        return;
    }
    startPartitionLoad(partKey, cb);
}

export function isPartitionLoaded(partKey) {
    return !!DB.partCache[partKey];
}

// 驱逐不再需要的分包。调用时机：切换视角 / 关闭界面 / 保存 meta 之后。
//
// 保留策略：
//   · pinned（当前视角 + 在穿的）全部留下
//   · 另外多留一个「上一次正在看的衣柜」，这样 A→B→A 来回切不用重读 IndexedDB
//     （带图分包读一次 50~150ms，来回切两下就是肉眼可见的顿）
//   · 多留的那一个只在「轻分包」时才留：服务端模式下 imageData 是同源 URL，
//     留一份几乎不花钱；本地模式下是 base64，多留一份就是几百 MB，不做。
export function maintainPartitionCache() {
    if (!lazyCacheAllowed()) return 0;
    var pins = pinnedPartKeys();
    var prev = DB.prevPinned || {};

    // 额外保留：上一次在看、这次不在看、还活着、且不重的那个
    var keepExtra = {};
    for (var pkPrev in prev) {
        if (pins[pkPrev]) continue;
        if (!DB.partCache[pkPrev]) continue;
        if (isHeavyPartition(DB.partCache[pkPrev])) continue;
        keepExtra[pkPrev] = true;
        break;   // 只留一个
    }

    var evicted = 0;
    for (var pk in DB.partCache) {
        if (pins[pk] || keepExtra[pk]) continue;
        if (DB.dirtyPartKeys[pk] || DB.pendingPartitionDeletes[pk] || DB.deletedPartKeys[pk]) continue;
        if (DB.partLoadCbs[pk]) continue;
        delete DB.partCache[pk];
        delete DB.queuedPartitionJSON[pk];
        evicted++;
    }

    DB.prevPinned = pins;

    // 仅保留仍驻留内存的 LRU 诊断记录。
    if (DB.partLru && DB.partLru.length) {
        DB.partLru = DB.partLru.filter(function (k) { return !!DB.partCache[k] || pins[k]; });
    }
    return evicted;
}

// 同步读（从缓存，必须已 ensure 过）
export function loadPartition(partKey) {
    if (DB.serverInitFailed) {
        throw new Error('Outfit Manager server initialization failed');
    }
    if (DB.partCache[partKey]) { touchPartitionLru(partKey); return DB.partCache[partKey]; }
    if (isColdPartition(partKey)) {
        // 还没载入：先给占位，同时后台读回来；写入会被 savePartition 拒绝
        if (!DB.partLoadErrors[partKey] || Date.now() - DB.partLoadErrors[partKey].at > 5000) startPartitionLoad(partKey);
        return coldStubFor(partKey);
    }
    DB.partCache[partKey] = defPartition();
    DB.knownPartKeys[partKey] = true;
    touchPartitionLru(partKey);
    return DB.partCache[partKey];
}

// 写 partition（本地 IDB + server 防抖）
export function savePartition(partKey, data, callback) {
    if (DB.serverInitFailed) return false;
    if (isColdPartition(partKey) || DB.partColdStub[partKey] === data) {
        // 分包还没从 IDB 载入完，此刻写入会把空壳覆盖到真数据上 —— 直接拒绝。
        try { console.warn('[outfit-manager] 拒绝写入尚未载入的衣柜分包：' + partKey); } catch (e) {}
        ensurePartitionLoaded(partKey, null);
        return false;
    }
    DB.partCache[partKey] = data;
    DB.knownPartKeys[partKey] = true;
    touchPartitionLru(partKey);
    delete DB.deletedPartKeys[partKey];
    delete DB.pendingPartitionDeletes[partKey];
    // Asset saves do not change the current chat selection. Selection actions call syncActivePartitions explicitly.
    var stored = partitionForStorage(partKey, data);
    if (getChatState() && JSON.stringify(DB.libraryActiveIds[partKey] || []) !== JSON.stringify(stored.activeIds || [])) {
        DB.libraryActiveIds[partKey] = (stored.activeIds || []).slice();
        if (stored.activeIds.length) DB.metaCache.activePartitions[partKey] = stored.activeIds.slice();
        else delete DB.metaCache.activePartitions[partKey];
        scheduleServerPutKey('meta');
    }
    idbPut(partKey, stored, function (ok) {
        if (!ok) setSyncState('error', '本地保存失败，请检查浏览器存储空间并导出备份。');
        else if (!DB.serverMode) setSyncState('saved');
        if (callback) callback(ok);
    });
    scheduleServerPutKey(partKey);
    return true;
}

// 异步确保 partition 在缓存里（切视角时用）
export function ensurePartition(partKey, cb) {
    ensurePartitionLoaded(partKey, cb);
}

// Bulk import/preset operations explicitly pin their inputs while reading them.
export async function withLoadedPartitions(keys, action) {
    DB.bulkLoadDepth = (DB.bulkLoadDepth || 0) + 1;
    try {
        var unique = Array.from(new Set(keys));
        for (var i = 0; i < unique.length; i++) {
            await new Promise(function (resolve, reject) {
                ensurePartitionLoaded(unique[i], function (part, error) { if (part) resolve(part); else reject(new Error('衣柜未能载入：' + unique[i] + (error ? '；' + error.message : ''))); });
            });
        }
        return await action();
    } finally { DB.bulkLoadDepth--; }
}

// 删除 partition（角色删除时用）
export function deletePartition(partKey) {
    if (DB.serverInitFailed) return false;
    delete DB.partCache[partKey];
    if (DB.partLru) {
        var li = DB.partLru.indexOf(partKey);
        if (li !== -1) DB.partLru.splice(li, 1);
    }
    delete DB.knownPartKeys[partKey];
    delete DB.partColdStub[partKey];
    DB.deletedPartKeys[partKey] = true;
    delete DB.dirtyPartKeys[partKey];
    DB.pendingPartitionDeletes[partKey] = DB.pendingPartitionDeletes[partKey] || {
        localCommitted: false,
        localInFlight: false,
        serverCommitted: false,
        serverInFlight: false
    };
    return true;
}
