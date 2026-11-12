// Outfit Manager · 二改版 | 使用中衣柜的预加载
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { ensurePartDefaults } from '../data.js';
import { idbGet } from './idb.js';
import { load, save } from './legacy.js';
import { loadMeta } from './meta.js';
import { maintainPartitionCache } from './partitions.js';
import { DB } from './state.js';
import { currentUserPartKey } from './view.js';
import { readLocalPartition } from './local-partitions.js';

//  预加载所有 partition（兼容期必须全部加载）
// ══════════════════════════════════════════════════════════
// 兼容期间旧 UI 通过 load() 拿到所有 chars 的浅引用，
// save(d) 会遍历 d.chars 写回各 partition。
// 如果某个 partition 没加载，load() 会给空数组，
// save(d) 就会把空数组写回去 → 数据丢失。
// 所以兼容期启动时必须加载所有 partition，不能只加载 active/current。
// 等所有 UI 模块改用新 API 后，可以改回 preloadActivePartitions。

export function preloadAllPartitions(cb) {
    var meta = loadMeta();
    var keys = [];

    // user:__default__
    if (keys.indexOf('user:__default__') === -1) keys.push('user:__default__');

    // 当前活跃 User 预设
    var curUPK = currentUserPartKey();
    if (keys.indexOf(curUPK) === -1) keys.push(curUPK);

    // 所有 User 预设
    (meta.presets || []).forEach(function (pi) {
        if (keys.indexOf(pi.partKey) === -1) keys.push(pi.partKey);
    });

    // 所有角色
    (meta.charIndex || []).forEach(function (ci) {
        if (keys.indexOf(ci.partKey) === -1) keys.push(ci.partKey);
    });

    // activePartitions 里可能有的
    var ap = meta.activePartitions || {};
    for (var pk in ap) {
        if (keys.indexOf(pk) === -1) keys.push(pk);
    }

    var pending = keys.length;
    function done() {
        // 本地模式下也把非当前衣柜释放掉：数据已经在 IndexedDB 里，切过去再读
        maintainPartitionCache();
        cb();
    }
    if (pending === 0) { done(); return; }

    keys.forEach(function (pk) {
        DB.knownPartKeys[pk] = true;
        if (DB.partCache[pk]) { pending--; if (pending === 0) done(); return; }
        readLocalPartition(pk, function (raw, error) {
            if (error || !raw) {
                DB.partLoadErrors[pk] = { at: Date.now(), message: error ? error.message : '衣柜记录缺失：' + pk };
            } else {
                delete DB.partLoadErrors[pk];
                DB.partCache[pk] = ensurePartDefaults(raw);
            }
            pending--;
            if (pending === 0) done();
        });
    });
}

// ══════════════════════════════════════════════════════════
