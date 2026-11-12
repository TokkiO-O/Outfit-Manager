// Outfit Manager · 二改版 | 通用设置与衣柜目录
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { SHARED_CHAR_KEY, defMeta } from '../data.js';
import { idbPut } from './idb.js';
import { save } from './legacy.js';
import { deletePartition, loadPartition, savePartition } from './partitions.js';
import { commitPendingPartitionDeletes, scheduleServerPutKey } from './server-partitions.js';
import { DB } from './state.js';
import { syncActivePartitions } from './view.js';
import { metaForStorage } from '../chat-state.js';
import { setSyncState } from './incremental.js';

// ══════════════════════════════════════════════════════════
//  Meta 读写
// ══════════════════════════════════════════════════════════

export function normalizeSharedCharState(meta) {
    var changed = false;
    if (!Array.isArray(meta.charIndex)) { meta.charIndex = []; changed = true; }

    var cleaned = [];
    var sharedEntry = null;
    var sharedPartKey = 'char:__shared__';
    var sharedPart = DB.partCache[sharedPartKey] || null;
    var removedPartKeys = [];
    var removedCharIds = [];
    var hasCurrent = false;
    meta.charIndex.forEach(function (ci) {
        if (!ci) return;
        if (ci.id === SHARED_CHAR_KEY) {
            if (!sharedEntry) {
                sharedEntry = ci;
                if (ci.name !== SHARED_CHAR_KEY) { ci.name = SHARED_CHAR_KEY; changed = true; }
                if (ci.partKey !== sharedPartKey) { ci.partKey = sharedPartKey; changed = true; }
                cleaned.push(ci);
            } else {
                changed = true;
            }
            if (ci.id === meta.currentChar) hasCurrent = true;
            return;
        }
        if (ci.name === SHARED_CHAR_KEY) {
            if (ci.partKey && DB.partCache[ci.partKey]) {
                if (!sharedPart) sharedPart = loadPartition(sharedPartKey);
                mergePartitionInto(sharedPart, DB.partCache[ci.partKey]);
                removedPartKeys.push(ci.partKey);
            }
            if (ci.id === meta.currentChar) meta.currentChar = SHARED_CHAR_KEY;
            if (ci.id) removedCharIds.push(ci.id);
            changed = true;
            return;
        }
        if (ci.id === meta.currentChar) hasCurrent = true;
        cleaned.push(ci);
    });
    if (!sharedEntry) {
        cleaned.unshift({ id: SHARED_CHAR_KEY, name: SHARED_CHAR_KEY, partKey: sharedPartKey });
        changed = true;
    }
    if (cleaned.length !== meta.charIndex.length) changed = true;
    meta.charIndex = cleaned;
    removedPartKeys.forEach(function (partKey) {
        deletePartition(partKey);
        if (meta.activePartitions) delete meta.activePartitions[partKey];
    });
    if (removedCharIds.length > 0) {
        if (Array.isArray(meta.charFavorites)) {
            meta.charFavorites = meta.charFavorites.filter(function (id) { return removedCharIds.indexOf(id) === -1; });
        }
        if (meta.charGroups) {
            for (var gn in meta.charGroups) {
                meta.charGroups[gn] = (meta.charGroups[gn] || []).filter(function (id) { return removedCharIds.indexOf(id) === -1; });
            }
        }
    }
    if (meta.currentView === 'char' && (!meta.currentChar || !hasCurrent)) {
        meta.currentChar = SHARED_CHAR_KEY;
        changed = true;
    }
    return changed;
}

export function mergePartitionInto(target, source) {
    if (!target || !source) return;
    if (!Array.isArray(target.outfits)) target.outfits = [];
    if (!Array.isArray(target.categories)) target.categories = [];
    if (!Array.isArray(target.activeIds)) target.activeIds = [];
    if (!Array.isArray(target.accessories)) target.accessories = [];
    if (!Array.isArray(target.accCategories)) target.accCategories = [];

    function hasItem(list, item) {
        for (var i = 0; i < list.length; i++) {
            if (item.id && list[i].id === item.id) return true;
            if (item.name && list[i].name === item.name) return true;
        }
        return false;
    }
    function catName(c) { return c && typeof c === 'object' ? c.name : c; }
    function mergeCats(list, incoming) {
        (incoming || []).forEach(function (c) {
            var name = catName(c);
            var exists = false;
            for (var i = 0; i < list.length; i++) {
                if (catName(list[i]) === name) { exists = true; break; }
            }
            if (!exists) list.push(c);
        });
    }
    (source.outfits || []).forEach(function (o) { if (o && !hasItem(target.outfits, o)) target.outfits.push(o); });
    (source.accessories || []).forEach(function (a) { if (a && !hasItem(target.accessories, a)) target.accessories.push(a); });
    mergeCats(target.categories, source.categories);
    mergeCats(target.accCategories, source.accCategories);
    (source.activeIds || []).forEach(function (id) {
        if (target.activeIds.indexOf(id) === -1) target.activeIds.push(id);
    });
    savePartition('char:__shared__', target);
    syncActivePartitions('char:__shared__', target.activeIds);
}

export function loadMeta() {
    if (DB.serverInitFailed) {
        throw new Error('Outfit Manager server initialization failed');
    }
    if (!DB.metaCache) DB.metaCache = defMeta();
    // v2 hydrate 期间禁止 normalize 触发 save/delete；成功打开写门后再做兼容规范化。
    if (DB.serverMode && DB.serverSupportsPartitions && !DB.serverHydrated) return DB.metaCache;
    if (normalizeSharedCharState(DB.metaCache)) saveMeta(DB.metaCache);
    return DB.metaCache;
}

export function saveMeta(meta) {
    if (DB.serverInitFailed) return false;
    DB.metaCache = meta;
    idbPut('meta', metaForStorage(meta), function (ok) {
        if (ok) commitPendingPartitionDeletes(false);
        else setSyncState('error', '本地设置保存失败，请检查浏览器存储空间。');
    });
    scheduleServerPutKey('meta');
    return true;
}

// ══════════════════════════════════════════════════════════
