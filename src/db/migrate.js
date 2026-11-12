// Outfit Manager · 二改版 | 历史衣柜数据迁移
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { SHARED_CHAR_KEY, defMeta, migrateCategories } from '../data.js';
import { idbDelete, idbPutBatch } from './idb.js';
import { DB, LEGACY_DATA_KEY, genId8 } from './state.js';

//  v1 → v2 数据迁移
// ══════════════════════════════════════════════════════════

// v17 兼容（从旧版 data.js 移过来，迁移时一次性执行）
export function migrateV17(d) {
    if (!d || !d.outfits) return;
    var userOutfits = [];
    var moved = {};
    d.outfits.forEach(function (o) {
        if (o.owner && o.owner !== 'user') {
            var cn = o.owner;
            if (!moved[cn]) moved[cn] = [];
            delete o.owner;
            moved[cn].push(o);
        } else {
            delete o.owner;
            userOutfits.push(o);
        }
    });
    d.outfits = userOutfits;
    if (!d.chars) d.chars = {};
    if (!d.charNames) d.charNames = [];
    for (var cn in moved) {
        if (!d.chars[cn]) d.chars[cn] = { outfits: [], categories: [], activeIds: [] };
        d.chars[cn].outfits = d.chars[cn].outfits.concat(moved[cn]);
        if (d.charNames.indexOf(cn) === -1) d.charNames.push(cn);
    }
    if (d.charActiveIds) {
        for (var cn2 in d.charActiveIds) {
            if (!d.chars[cn2]) d.chars[cn2] = { outfits: [], categories: [], activeIds: [] };
            d.chars[cn2].activeIds = d.charActiveIds[cn2];
        }
        delete d.charActiveIds;
    }
}

export function migrateFromV1(oldData, cb) {
    // 先跑 v17 迁移确保 chars 结构正确
    migrateV17(oldData);

    var meta = defMeta();
    var entries = []; // { key, value } 批量写入

    // ── 提取设置到 meta ──
    var settingsKeys = [
        'mode', 'injectPosition', 'singleTemplate', 'multiTemplate',
        'charSingleTemplate', 'charMultiTemplate', 'imagePrompt', 'multiImagePrompt',
        'debug', 'injectionBudget', 'slotRules', 'apiVision', 'showBall', 'fabImage', 'fabSize', 'fabPos', 'tagOrder', 'wearHistory', 'uiTheme', 'gridCols', 'customAccent', 'dupIgnore',
        'currentView'
    ];
    settingsKeys.forEach(function (k) {
        if (oldData[k] !== undefined) meta[k] = oldData[k];
    });

    // ── apiVision 规范化 ──
    if (meta.apiVision) {
        var dv = defMeta().apiVision;
        for (var vk in dv) { if (meta.apiVision[vk] === undefined) meta.apiVision[vk] = dv[vk]; }
        if (meta.apiVision.batchSize && !meta.apiVision.concurrency) {
            meta.apiVision.concurrency = Math.min(meta.apiVision.batchSize, 5);
        }
        delete meta.apiVision.batchSize;
    }

    // ── User 默认预设 ──
    var userDefault = {
        outfits: oldData.outfits || [],
        categories: migrateCategories(oldData.categories || []),
        activeIds: Array.isArray(oldData.activeIds) ? oldData.activeIds : (oldData.activeId ? [oldData.activeId] : []),
        accessories: oldData.accessories || [],
        accCategories: migrateCategories(oldData.accCategories || [])
    };
    entries.push({ key: 'user:__default__', value: userDefault });
    DB.partCache['user:__default__'] = userDefault;

    // ── User 预设 ──
    meta.presets = [];
    meta.activePresetId = oldData.activePresetId || null;
    if (Array.isArray(oldData.presets)) {
        oldData.presets.forEach(function (p) {
            if (!p) return;
            var pid = p.id || ('p_' + genId8());
            var partKey = 'user:' + pid;
            meta.presets.push({ id: pid, name: p.name || '未命名', partKey: partKey });
            var pPart = {
                outfits: p.outfits || [],
                categories: migrateCategories(p.categories || []),
                activeIds: p.activeIds || [],
                accessories: p.accessories || [],
                accCategories: migrateCategories(p.accCategories || [])
            };
            entries.push({ key: partKey, value: pPart });
            DB.partCache[partKey] = pPart;
        });
    }

    // User 激活：旧版的顶层 outfits/categories/activeIds 是当前实际使用的数据
    // 如果有 activePresetId，说明这些顶层数据其实是该预设的当前工作状态
    // 所以要把顶层数据写入该预设的 partition（覆盖预设快照），而不是 __default__
    var activeUserPK = 'user:__default__';
    if (meta.activePresetId) {
        for (var pi2 = 0; pi2 < meta.presets.length; pi2++) {
            if (meta.presets[pi2].id === meta.activePresetId) {
                activeUserPK = meta.presets[pi2].partKey;
                // 用当前顶层数据覆盖预设 partition（顶层才是最新状态）
                var activePPart = {
                    outfits: userDefault.outfits,
                    categories: userDefault.categories,
                    activeIds: userDefault.activeIds,
                    accessories: userDefault.accessories,
                    accCategories: userDefault.accCategories
                };
                // 更新 entries 和 DB.partCache 里对应的 partition
                for (var ei = 0; ei < entries.length; ei++) {
                    if (entries[ei].key === activeUserPK) {
                        entries[ei].value = activePPart;
                        break;
                    }
                }
                DB.partCache[activeUserPK] = activePPart;
                break;
            }
        }
    }
    if (userDefault.activeIds.length > 0) {
        meta.activePartitions[activeUserPK] = userDefault.activeIds.slice();
    }

    // ── 角色 ──
    meta.charIndex = [];
    var charFavNames = oldData.charFavorites || [];
    var charGroupsOld = oldData.charGroups || {};
    meta.charFavorites = [];
    meta.charGroups = {};

    // 通用衣柜
    if (oldData.chars && oldData.chars[SHARED_CHAR_KEY]) {
        var scd = oldData.chars[SHARED_CHAR_KEY];
        var sharedPart = {
            outfits: scd.outfits || [],
            categories: migrateCategories(scd.categories || []),
            activeIds: scd.activeIds || [],
            accessories: scd.accessories || [],
            accCategories: migrateCategories(scd.accCategories || [])
        };
        meta.charIndex.push({ id: SHARED_CHAR_KEY, name: SHARED_CHAR_KEY, partKey: 'char:__shared__' });
        entries.push({ key: 'char:__shared__', value: sharedPart });
        DB.partCache['char:__shared__'] = sharedPart;
        if (sharedPart.activeIds.length > 0) {
            meta.activePartitions['char:__shared__'] = sharedPart.activeIds.slice();
        }
    }

    // 普通角色
    var charNames = (oldData.charNames || []).filter(function (name) { return name && name !== SHARED_CHAR_KEY; });
    // 也收集 chars 里有但 charNames 没列出的
    if (oldData.chars) {
        for (var cn in oldData.chars) {
            if (cn !== SHARED_CHAR_KEY && charNames.indexOf(cn) === -1) {
                charNames.push(cn);
            }
        }
    }

    // name → id 映射（迁移用）
    var nameToId = {};
    charNames.forEach(function (name) {
        var cid = 'c_' + genId8();
        // 防碰撞
        while (nameToId[cid]) { cid = 'c_' + genId8(); }
        nameToId[name] = cid;
        var partKey = 'char:' + cid;
        var cd = (oldData.chars && oldData.chars[name]) ? oldData.chars[name] : { outfits: [], categories: [], activeIds: [] };
        var charPart = {
            outfits: cd.outfits || [],
            categories: migrateCategories(cd.categories || []),
            activeIds: cd.activeIds || [],
            accessories: cd.accessories || [],
            accCategories: migrateCategories(cd.accCategories || [])
        };
        meta.charIndex.push({ id: cid, name: name, partKey: partKey });
        entries.push({ key: partKey, value: charPart });
        DB.partCache[partKey] = charPart;
        if (charPart.activeIds.length > 0) {
            meta.activePartitions[partKey] = charPart.activeIds.slice();
        }
    });

    // 迁移 charFavorites: name → id
    charFavNames.forEach(function (name) {
        if (nameToId[name]) meta.charFavorites.push(nameToId[name]);
    });

    // 迁移 charGroups: name → id
    for (var gn in charGroupsOld) {
        meta.charGroups[gn] = [];
        (charGroupsOld[gn] || []).forEach(function (name) {
            if (nameToId[name]) meta.charGroups[gn].push(nameToId[name]);
        });
    }

    // currentChar: name → id
    if (oldData.currentChar) {
        if (oldData.currentChar === SHARED_CHAR_KEY) {
            meta.currentChar = SHARED_CHAR_KEY;
        } else {
            meta.currentChar = nameToId[oldData.currentChar] || '';
        }
    }

    // ── 写入所有 partitions + meta + 备份旧 key ──
    entries.push({ key: 'meta', value: meta });
    // 备份旧数据
    entries.push({ key: 'backup:main:v1:' + Date.now(), value: oldData });

    DB.metaCache = meta;

    idbPutBatch(entries, function () {
        // 删除旧 key
        idbDelete(LEGACY_DATA_KEY, function () {
            try { console.log('[outfit-manager] v1→v2 迁移完成，已创建 ' + entries.length + ' 个分包 key'); } catch (e) {}
            cb();
        });
    });
}

// ══════════════════════════════════════════════════════════
//  Server 数据 → 分包拆解（server 模式启动用）
// ══════════════════════════════════════════════════════════

export function splitServerDataToPartitions(serverData, cb) {
    // 和 migrateFromV1 基本一样，但不备份
    migrateV17(serverData);

    var meta = defMeta();
    var entries = [];

    var settingsKeys = [
        'mode', 'injectPosition', 'singleTemplate', 'multiTemplate',
        'charSingleTemplate', 'charMultiTemplate', 'imagePrompt', 'multiImagePrompt',
        'debug', 'injectionBudget', 'slotRules', 'apiVision', 'showBall', 'fabImage', 'fabSize', 'fabPos', 'tagOrder', 'wearHistory', 'uiTheme', 'gridCols', 'customAccent', 'dupIgnore',
        'currentView'
    ];
    settingsKeys.forEach(function (k) {
        if (serverData[k] !== undefined) meta[k] = serverData[k];
    });

    if (meta.apiVision) {
        var dv = defMeta().apiVision;
        for (var vk in dv) { if (meta.apiVision[vk] === undefined) meta.apiVision[vk] = dv[vk]; }
        if (meta.apiVision.batchSize) { delete meta.apiVision.batchSize; }
    }

    // User
    var userDefault = {
        outfits: serverData.outfits || [],
        categories: migrateCategories(serverData.categories || []),
        activeIds: Array.isArray(serverData.activeIds) ? serverData.activeIds : [],
        accessories: serverData.accessories || [],
        accCategories: migrateCategories(serverData.accCategories || [])
    };
    entries.push({ key: 'user:__default__', value: userDefault });
    DB.partCache['user:__default__'] = userDefault;

    // 预设
    meta.presets = [];
    meta.activePresetId = serverData.activePresetId || null;
    if (Array.isArray(serverData.presets)) {
        serverData.presets.forEach(function (p) {
            if (!p) return;
            var pid = p.id || ('p_' + genId8());
            var partKey = 'user:' + pid;
            meta.presets.push({ id: pid, name: p.name || '未命名', partKey: partKey });
            var pPart = {
                outfits: p.outfits || [],
                categories: migrateCategories(p.categories || []),
                activeIds: p.activeIds || [],
                accessories: p.accessories || [],
                accCategories: migrateCategories(p.accCategories || [])
            };
            entries.push({ key: partKey, value: pPart });
            DB.partCache[partKey] = pPart;
        });
    }

    // User 激活：同 migrateFromV1 逻辑
    var activeUserPK = 'user:__default__';
    if (meta.activePresetId) {
        for (var pi2 = 0; pi2 < meta.presets.length; pi2++) {
            if (meta.presets[pi2].id === meta.activePresetId) {
                activeUserPK = meta.presets[pi2].partKey;
                var activePPart = {
                    outfits: userDefault.outfits,
                    categories: userDefault.categories,
                    activeIds: userDefault.activeIds,
                    accessories: userDefault.accessories,
                    accCategories: userDefault.accCategories
                };
                for (var ei = 0; ei < entries.length; ei++) {
                    if (entries[ei].key === activeUserPK) {
                        entries[ei].value = activePPart;
                        break;
                    }
                }
                DB.partCache[activeUserPK] = activePPart;
                break;
            }
        }
    }
    if (userDefault.activeIds.length > 0) {
        meta.activePartitions[activeUserPK] = userDefault.activeIds.slice();
    }

    // 角色
    meta.charIndex = [];
    meta.charFavorites = [];
    meta.charGroups = {};
    var nameToId = {};
    var charNames = (serverData.charNames || []).filter(function (name) { return name && name !== SHARED_CHAR_KEY; });
    if (serverData.chars) {
        for (var cn in serverData.chars) {
            if (cn !== SHARED_CHAR_KEY && charNames.indexOf(cn) === -1) charNames.push(cn);
        }
    }

    // 通用衣柜
    if (serverData.chars && serverData.chars[SHARED_CHAR_KEY]) {
        var scd = serverData.chars[SHARED_CHAR_KEY];
        var sharedPart = {
            outfits: scd.outfits || [],
            categories: migrateCategories(scd.categories || []),
            activeIds: scd.activeIds || [],
            accessories: scd.accessories || [],
            accCategories: migrateCategories(scd.accCategories || [])
        };
        meta.charIndex.push({ id: SHARED_CHAR_KEY, name: SHARED_CHAR_KEY, partKey: 'char:__shared__' });
        entries.push({ key: 'char:__shared__', value: sharedPart });
        DB.partCache['char:__shared__'] = sharedPart;
        if (sharedPart.activeIds.length > 0) meta.activePartitions['char:__shared__'] = sharedPart.activeIds.slice();
    }

    charNames.forEach(function (name) {
        var cid = 'c_' + genId8();
        nameToId[name] = cid;
        var partKey = 'char:' + cid;
        var cd = (serverData.chars && serverData.chars[name]) || { outfits: [], categories: [], activeIds: [] };
        var charPart = {
            outfits: cd.outfits || [],
            categories: migrateCategories(cd.categories || []),
            activeIds: cd.activeIds || [],
            accessories: cd.accessories || [],
            accCategories: migrateCategories(cd.accCategories || [])
        };
        meta.charIndex.push({ id: cid, name: name, partKey: partKey });
        entries.push({ key: partKey, value: charPart });
        DB.partCache[partKey] = charPart;
        if (charPart.activeIds.length > 0) meta.activePartitions[partKey] = charPart.activeIds.slice();
    });

    // favorites / groups
    (serverData.charFavorites || []).forEach(function (name) {
        if (nameToId[name]) meta.charFavorites.push(nameToId[name]);
    });
    for (var gn in (serverData.charGroups || {})) {
        meta.charGroups[gn] = [];
        (serverData.charGroups[gn] || []).forEach(function (name) {
            if (nameToId[name]) meta.charGroups[gn].push(nameToId[name]);
        });
    }

    if (serverData.currentChar) {
        if (serverData.currentChar === SHARED_CHAR_KEY) meta.currentChar = SHARED_CHAR_KEY;
        else meta.currentChar = nameToId[serverData.currentChar] || '';
    }

    entries.push({ key: 'meta', value: meta });
    DB.metaCache = meta;

    idbPutBatch(entries, function () {
        if (cb) cb();
    });
}

// ══════════════════════════════════════════════════════════
