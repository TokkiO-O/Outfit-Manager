// Outfit Manager · 二改版 | 历史数据接口适配
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { SHARED_CHAR_KEY, defPartition } from '../data.js';
import { loadMeta, saveMeta } from './meta.js';
import { coldStubFor, deletePartition, loadPartition, savePartition } from './partitions.js';
import { preloadAllPartitions } from './preload.js';
import { DB, genId8 } from './state.js';
import { setChatPreset, setChatView, getChatState, getBoundPresetId, getWardrobeView } from '../chat-state.js';
import { charIdByName, charNameById, cleanUserActivePartitions, currentPartKey, currentUserPartKey, loadCurrent, saveCurrent, syncActivePartitions } from './view.js';

//  兼容旧接口（过渡期，逐步废弃）
//  旧 UI 模块大量使用 d.chars / d.charNames / d.charFavorites /
//  d.charGroups / d.presets / d.currentChar（角色名），
//  必须在 load() 里完整组装这些字段，在 save() 里把修改反写回
//  meta + partitions，包括角色名 ↔ charId 的双向翻译。
// ══════════════════════════════════════════════════════════

// charId ↔ name 翻译辅助（仅兼容层内部使用）
export function _nameToIdMap() {
    var meta = loadMeta();
    var map = {};
    (meta.charIndex || []).forEach(function (ci) { if (ci.id !== SHARED_CHAR_KEY) map[ci.name] = ci.id; });
    return map;
}
export function _idToNameMap() {
    var meta = loadMeta();
    var map = {};
    (meta.charIndex || []).forEach(function (ci) { if (ci.id !== SHARED_CHAR_KEY) map[ci.id] = ci.name; });
    return map;
}

// load() — 旧代码的读取入口（deprecated，适配完成后删除）
// 返回完整旧格式对象，chars 按角色名索引，currentChar 是角色名
export function load() {
    var meta = loadMeta();
    var part = loadCurrent();

    var d = {};
    // meta 设置字段
    var metaKeys = [
        'mode', 'injectPosition', 'singleTemplate', 'multiTemplate',
        'charSingleTemplate', 'charMultiTemplate', 'imagePrompt', 'multiImagePrompt',
        'debug', 'injectionBudget', 'slotRules', 'apiVision', 'showBall', 'fabImage', 'fabSize', 'fabPos', 'tagOrder', 'wearHistory', 'uiTheme', 'gridCols', 'customAccent', 'dupIgnore',
        'currentView', 'activePresetId'
    ];
    metaKeys.forEach(function (k) { d[k] = meta[k]; });
    var chat=getChatState(),view=getWardrobeView();if(chat){d.activePresetId=getBoundPresetId();d.currentView=view.kind;}

    // currentChar: charId → 角色名（旧 UI 使用角色名）
    var currentChar = chat ? view.characterId : meta.currentChar;
    if (currentChar === SHARED_CHAR_KEY) {
        d.currentChar = SHARED_CHAR_KEY;
    } else if (currentChar) {
        d.currentChar = charNameById(currentChar) || '';
    } else {
        d.currentChar = '';
    }

    // 当前视角 partition
    d.outfits = part.outfits;
    d.categories = part.categories;
    d.activeIds = part.activeIds;
    d.accessories = part.accessories;
    d.accCategories = part.accCategories;

    // 组装 chars：{ 角色名: { outfits, categories, activeIds, accessories, accCategories } }
    d.chars = {};
    d.charNames = [];
    (meta.charIndex || []).forEach(function (ci) {
        // 冷分包返回稳定占位对象：save(d) 靠 outfits 引用相等识别「角色改名」，
        // 这里如果每次 new 一个空数组，改名会被误判成「删除旧角色 + 新建空角色」。
        var cp = DB.partCache[ci.partKey] || coldStubFor(ci.partKey);
        if (ci.id === SHARED_CHAR_KEY) {
            d.chars[SHARED_CHAR_KEY] = { outfits: cp.outfits, categories: cp.categories, activeIds: cp.activeIds, accessories: cp.accessories, accCategories: cp.accCategories };
        } else {
            d.charNames.push(ci.name);
            d.chars[ci.name] = { outfits: cp.outfits, categories: cp.categories, activeIds: cp.activeIds, accessories: cp.accessories, accCategories: cp.accCategories };
        }
    });

    // charFavorites: charId[] → name[]
    d.charFavorites = [];
    var idToName = _idToNameMap();
    (meta.charFavorites || []).forEach(function (cid) {
        if (idToName[cid]) d.charFavorites.push(idToName[cid]);
    });

    // charGroups: { groupName: charId[] } → { groupName: name[] }
    d.charGroups = {};
    for (var gn in (meta.charGroups || {})) {
        d.charGroups[gn] = [];
        (meta.charGroups[gn] || []).forEach(function (cid) {
            if (idToName[cid]) d.charGroups[gn].push(idToName[cid]);
        });
    }

    // presets（旧格式包含内嵌 outfits，但兼容层只做索引展示）
    d.presets = [];
    (meta.presets || []).forEach(function (pi) {
        var pp = DB.partCache[pi.partKey] || null;
        d.presets.push({
            id: pi.id,
            name: pi.name,
            outfits: pp ? pp.outfits : [],
            categories: pp ? pp.categories : [],
            activeIds: pp ? pp.activeIds : [],
            accessories: pp ? pp.accessories : [],
            accCategories: pp ? pp.accCategories : []
        });
    });

    return d;
}

// save(d) — 旧代码的保存入口（deprecated，适配完成后删除）
// 把旧格式对象拆回 meta + partitions
// 处理：角色增删改名、currentChar 名→id、收藏/分组名→id、
//       chars 数据回写到各 partition、activePartitions 同步
export function save(d) {
    var meta = loadMeta();

    // ── 1. meta 设置字段 ──
    var settingsKeys = [
        'mode', 'injectPosition', 'singleTemplate', 'multiTemplate',
        'charSingleTemplate', 'charMultiTemplate', 'imagePrompt', 'multiImagePrompt',
        'debug', 'injectionBudget', 'slotRules', 'apiVision', 'showBall', 'fabImage', 'fabSize', 'fabPos', 'tagOrder', 'wearHistory', 'uiTheme', 'gridCols', 'customAccent', 'dupIgnore',
        'currentView', 'activePresetId'
    ];
    settingsKeys.forEach(function (k) { if (d[k] !== undefined) meta[k] = d[k]; });

    // ── 2. 当前视角 partition ──
    var part = loadCurrent();
    part.outfits = d.outfits || part.outfits;
    part.categories = d.categories || part.categories;
    part.activeIds = d.activeIds || part.activeIds;
    if (d.accessories) part.accessories = d.accessories;
    if (d.accCategories) part.accCategories = d.accCategories;
    saveCurrent(part);
    syncActivePartitions(currentPartKey(), part.activeIds);

    // ── 3. currentChar: 延迟到 charIndex 重建之后处理 ──
    // （旧 UI 的 d.currentChar 是角色名，可能是刚改过的新名）
    // （必须等第4步 charIndex 更新完才能正确翻译 name → id）
    var pendingCurrentChar = d.currentChar; // 暂存，后面处理

    // ── 4. 角色增删改名同步 ──
    // 对比 d.charNames 和 meta.charIndex 来检测变化
    var dNames = [];
    (d.charNames || []).forEach(function (name) {
        if (!name || name === SHARED_CHAR_KEY || dNames.indexOf(name) !== -1) return;
        dNames.push(name);
    });
    var oldIndex = meta.charIndex || [];
    var oldNameSet = {};
    oldIndex.forEach(function (ci) { if (ci.id !== SHARED_CHAR_KEY) oldNameSet[ci.name] = ci; });

    var newIndex = [];
    // 保留通用衣柜
    oldIndex.forEach(function (ci) { if (ci.id === SHARED_CHAR_KEY) newIndex.push(ci); });
    if (newIndex.length === 0) {
        var sharedPartKey = 'char:__shared__';
        if (!DB.partCache[sharedPartKey]) savePartition(sharedPartKey, defPartition());
        newIndex.push({ id: SHARED_CHAR_KEY, name: SHARED_CHAR_KEY, partKey: sharedPartKey });
    }

    dNames.forEach(function (name) {
        if (oldNameSet[name]) {
            // 已存在，保留
            newIndex.push(oldNameSet[name]);
            delete oldNameSet[name];
        } else {
            // 新角色：检查是否是改名（旧名消失+新名出现+chars有数据）
            // 改名在旧 UI 里是直接 dd.chars[newName] = dd.chars[oldName]; delete dd.chars[oldName];
            // 然后 dd.charNames[idx] = newName; 所以 oldNameSet 里会剩下旧名
            // 我们检查 d.chars[name] 是否有引用到某个旧 partition 的数据
            var foundRename = null;
            var foundOldName = '';
            for (var oldName in oldNameSet) {
                var oldCi = oldNameSet[oldName];
                var oldPart = DB.partCache[oldCi.partKey] || coldStubFor(oldCi.partKey);
                if (oldPart && d.chars && d.chars[name] && d.chars[name].outfits === oldPart.outfits) {
                    // 浅引用相同，说明是改名
                    foundRename = oldCi;
                    foundOldName = oldName;
                    break;
                }
            }
            if (foundRename) {
                // 改名：更新 charIndex 里的 name，partition key 不变
                foundRename.name = name;
                newIndex.push(foundRename);
                delete oldNameSet[foundOldName];
            } else {
                // 全新角色
                var newCid = 'c_' + genId8();
                var newPartKey = 'char:' + newCid;
                newIndex.push({ id: newCid, name: name, partKey: newPartKey });
                // 如果 d.chars[name] 有数据，写入新 partition
                // （冷分包的占位对象不能当数据源，否则会把空数组写成新角色的衣柜）
                if (d.chars && d.chars[name] && !d.chars[name].__omCold) {
                    var newPart = {
                        outfits: d.chars[name].outfits || [],
                        categories: d.chars[name].categories || [],
                        activeIds: d.chars[name].activeIds || [],
                        accessories: d.chars[name].accessories || [],
                        accCategories: d.chars[name].accCategories || []
                    };
                    savePartition(newPartKey, newPart);
                    if (newPart.activeIds.length > 0) {
                        syncActivePartitions(newPartKey, newPart.activeIds);
                    }
                } else {
                    savePartition(newPartKey, defPartition());
                }
                // 如果是新增角色且设为当前角色，更新 meta.currentChar
                if (d.currentChar === name) meta.currentChar = newCid;
            }
        }
    });

    // oldNameSet 里剩下的 = 被删除的角色
    for (var deletedName in oldNameSet) {
        var deletedCi = oldNameSet[deletedName];
        deletePartition(deletedCi.partKey);
        // 清理 activePartitions
        if (meta.activePartitions) delete meta.activePartitions[deletedCi.partKey];
        // 清理 favorites
        if (meta.charFavorites) {
            var fi = meta.charFavorites.indexOf(deletedCi.id);
            if (fi !== -1) meta.charFavorites.splice(fi, 1);
        }
        // 清理 groups
        if (meta.charGroups) {
            for (var gg in meta.charGroups) {
                var gi = meta.charGroups[gg].indexOf(deletedCi.id);
                if (gi !== -1) meta.charGroups[gg].splice(gi, 1);
            }
        }
    }

    meta.charIndex = newIndex;

    // ── 4b. currentChar: 现在 charIndex 已重建，可以安全翻译 name → id ──
    if (pendingCurrentChar === SHARED_CHAR_KEY) {
        meta.currentChar = SHARED_CHAR_KEY;
    } else if (pendingCurrentChar) {
        // charIdByName 读的是 meta.charIndex（刚更新过），包含改名后的记录
        var resolvedCid = charIdByName(pendingCurrentChar);
        meta.currentChar = resolvedCid || (meta.currentView === 'char' ? SHARED_CHAR_KEY : '');
    } else {
        meta.currentChar = meta.currentView === 'char' ? SHARED_CHAR_KEY : '';
    }

    // ── 5. chars 数据回写到各 partition ──
    // 安全守卫：只回写 load() 组装时有对应缓存的 partition
    // 如果某个 partition 没在 DB.partCache 里（理论上兼容期不会发生，
    // 因为 preloadAllPartitions 会加载全部），跳过而不是写空
    if (d.chars) {
        var nameToId = _nameToIdMap();
        for (var cn in d.chars) {
            var cid2, pk;
            if (cn === SHARED_CHAR_KEY) {
                pk = 'char:__shared__';
            } else {
                cid2 = nameToId[cn];
                if (!cid2) {
                    // 可能是上面刚新增的，重建映射
                    cid2 = charIdByName(cn);
                }
                if (!cid2) continue; // 安全跳过
                pk = 'char:' + cid2;
            }
            // 守卫：如果 partition 从未加载过，不要写入空数据
            if (!DB.partCache[pk] && (!d.chars[cn].outfits || d.chars[cn].outfits.length === 0)) {
                continue; // 跳过，保护磁盘上的数据
            }
            var charPart = loadPartition(pk);
            charPart.outfits = d.chars[cn].outfits || charPart.outfits;
            charPart.categories = d.chars[cn].categories || charPart.categories;
            charPart.activeIds = d.chars[cn].activeIds || charPart.activeIds;
            if (d.chars[cn].accessories) charPart.accessories = d.chars[cn].accessories;
            if (d.chars[cn].accCategories) charPart.accCategories = d.chars[cn].accCategories;
            savePartition(pk, charPart);
            syncActivePartitions(pk, charPart.activeIds);
        }
    }

    // ── 6. charFavorites: name[] → charId[] ──
    if (d.charFavorites) {
        var nameToId2 = _nameToIdMap();
        meta.charFavorites = [];
        d.charFavorites.forEach(function (name) {
            if (nameToId2[name]) meta.charFavorites.push(nameToId2[name]);
        });
    }

    // ── 7. charGroups: { groupName: name[] } → { groupName: charId[] } ──
    if (d.charGroups) {
        var nameToId3 = _nameToIdMap();
        meta.charGroups = {};
        for (var gn2 in d.charGroups) {
            meta.charGroups[gn2] = [];
            (d.charGroups[gn2] || []).forEach(function (name) {
                if (nameToId3[name]) meta.charGroups[gn2].push(nameToId3[name]);
            });
        }
    }

    // ── 8. presets 同步：d.presets → meta.presets + user:{id} partition ──
    // 旧 UI 里 d.presets 是 [{id, name, outfits, categories, activeIds}, ...]
    if (d.presets) {
        var oldPresets = meta.presets || [];
        var oldPresetMap = {};
        oldPresets.forEach(function (p) { oldPresetMap[p.id] = p; });

        var newPresets = [];
        d.presets.forEach(function (dp) {
            if (!dp || !dp.id) return;
            var existing = oldPresetMap[dp.id];
            if (existing) {
                // 已有预设：可能改名或数据更新
                existing.name = dp.name || existing.name;
                newPresets.push(existing);
                // 写 partition 数据
                var pp = {
                    outfits: dp.outfits || [],
                    categories: dp.categories || [],
                    activeIds: dp.activeIds || [],
                    accessories: dp.accessories || [],
                    accCategories: dp.accCategories || []
                };
                savePartition(existing.partKey, pp);
                delete oldPresetMap[dp.id];
            } else {
                // 新预设
                var pid = dp.id;
                var partKey = 'user:' + pid;
                newPresets.push({ id: pid, name: dp.name || '未命名', partKey: partKey });
                var newPP = {
                    outfits: dp.outfits || [],
                    categories: dp.categories || [],
                    activeIds: dp.activeIds || [],
                    accessories: dp.accessories || [],
                    accCategories: dp.accCategories || []
                };
                savePartition(partKey, newPP);
            }
        });

        // oldPresetMap 里剩下的 = 被删除的预设
        for (var dpid in oldPresetMap) {
            var deletedPreset = oldPresetMap[dpid];
            deletePartition(deletedPreset.partKey);
            if (meta.activePartitions) delete meta.activePartitions[deletedPreset.partKey];
            // 如果删的是当前活跃预设，回退到默认
            if (meta.activePresetId === dpid) meta.activePresetId = null;
        }

        meta.presets = newPresets;

        // activePresetId 同步
        if (d.activePresetId !== undefined) meta.activePresetId = d.activePresetId;

        // 清理 User activePartitions：只保留当前活跃的 user:*
        var curUPK = currentUserPartKey();
        cleanUserActivePartitions(meta, curUPK);
        var curUPart = loadPartition(curUPK);
        if (curUPart.activeIds && curUPart.activeIds.length > 0) {
            meta.activePartitions[curUPK] = curUPart.activeIds.slice();
        }
    }

    // ── 9. 保存 meta ──
    var wantedView=meta.currentView,wantedChar=meta.currentChar,chat=getChatState();
    if(chat&&chat.presetId!==meta.activePresetId)setChatPreset(meta.activePresetId);
    if(chat&&(!chat.view||chat.view.kind!==wantedView||chat.view.characterId!==(wantedChar||'')))setChatView(wantedView,wantedChar);
    saveMeta(meta);
}
