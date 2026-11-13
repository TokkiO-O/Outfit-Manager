// Outfit Manager · 二改版 | 当前衣柜、查看对象与聊天选择
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { applyChatPartition } from '../chat-state.js';
import { SHARED_CHAR_KEY } from '../data.js';
import { loadMeta, saveMeta } from './meta.js';
import { loadPartition, savePartition, startPartitionLoad } from './partitions.js';
import { DB } from './state.js';
import { getChatState, captureChatSelection, setChatPreset, getBoundPresetId, getWardrobeView, setChatView } from '../chat-state.js';

// ══════════════════════════════════════════════════════════
//  便捷：当前视角
// ══════════════════════════════════════════════════════════

// 当前 User partition key
export function currentUserPartKey() {
    var meta = loadMeta();
    var selected=getChatState()?getBoundPresetId():meta.activePresetId;
    if (selected) {
        // 找到预设索引
        for (var i = 0; i < (meta.presets || []).length; i++) {
            if (meta.presets[i].id === selected) return meta.presets[i].partKey;
        }
    }
    return 'user:__default__';
}

// 当前视角的 partition key
export function currentPartKey() {
    loadMeta();
    var view = getWardrobeView();
    return view.kind === 'char' ? 'char:' + view.characterId : currentUserPartKey();
}

// 浏览对象只更新归属，不经过旧版整柜保存，也不更换聊天绑定的 User 预设。
export function switchWardrobeView(kind, characterId) {
    var meta = loadMeta(), chat = getChatState();
    kind = kind === 'char' ? 'char' : 'user';
    characterId = characterId || (chat && chat.view && (chat.view.lastCharacterId || chat.view.characterId)) || meta.currentChar || SHARED_CHAR_KEY;
    if (characterId !== SHARED_CHAR_KEY && !(meta.charIndex || []).some(function (item) { return item.id === characterId; })) characterId = SHARED_CHAR_KEY;
    if (chat) setChatView(kind, characterId);
    else {
        meta.currentView = kind;
        meta.currentChar = characterId;
        saveMeta(meta);
    }
    return currentPartKey();
}

// 当前视角的 partition（同步读）
export function loadCurrent() {
    var key = currentPartKey();
    return applyChatPartition(key, loadPartition(key));
}

// 保存当前视角的 partition
export function saveCurrent(data) {
    savePartition(currentPartKey(), data);
}

// ══════════════════════════════════════════════════════════
//  activePartitions 管理
// ══════════════════════════════════════════════════════════

// 更新 meta.activePartitions（选择/取消穿搭时调用）
export function syncActivePartitions(partKey, activeIds) {
    if (captureChatSelection(partKey, activeIds)) return;
    var meta = loadMeta();
    if (!meta.activePartitions) meta.activePartitions = {};
    if (activeIds && activeIds.length > 0) {
        meta.activePartitions[partKey] = activeIds.slice();
    } else {
        delete meta.activePartitions[partKey];
    }
    // 如果是 user:* 的 key，清掉其他 user:* 的记录（同一时刻只有一个 User 预设有效）
    if (partKey.indexOf('user:') === 0) {
        cleanUserActivePartitions(meta, partKey);
    }
    saveMeta(meta);
}

// 清掉除 keepKey 之外的所有 user:* activePartitions
// User 同一时刻只能有一个活跃预设/默认衣柜
export function cleanUserActivePartitions(meta, keepKey) {
    if (!meta.activePartitions) return;
    var toDelete = [];
    for (var pk in meta.activePartitions) {
        if (pk.indexOf('user:') === 0 && pk !== keepKey) toDelete.push(pk);
    }
    toDelete.forEach(function (pk) { delete meta.activePartitions[pk]; });
}

// 切预设后调用：确保 activePartitions 只保留当前 User partKey
export function syncCurrentUserActivePartition() {
    var meta = loadMeta();
    setChatPreset(meta.activePresetId);
    var curPK = currentUserPartKey();
    var curPart = loadPartition(curPK);
    if (!meta.activePartitions) meta.activePartitions = {};
    // 设置当前
    if (curPart.activeIds && curPart.activeIds.length > 0) {
        meta.activePartitions[curPK] = curPart.activeIds.slice();
    } else {
        delete meta.activePartitions[curPK];
    }
    // 清掉其他 user:*
    cleanUserActivePartitions(meta, curPK);
    saveMeta(meta);
}

// 注入用：返回所有有激活穿搭的 partition（同步，已预加载）
// 对 user:* 只返回当前活跃预设，忽略其他 user:* 残留
export function loadActivePartitions() {
    var meta = loadMeta();
    var result = {};
    var chat = getChatState();
    var ap = chat ? chat.active : (meta.activePartitions || {});
    var curUserPK = currentUserPartKey();
    for (var pk in ap) {
        if (pk.indexOf('user:') === 0 && pk !== curUserPK) continue;
        if (ap[pk].length > 0 && DB.partCache[pk]) {
            // user:* 只保留当前活跃的那个
            if (pk.indexOf('user:') === 0 && pk !== curUserPK) continue;
            result[pk] = applyChatPartition(pk, DB.partCache[pk]);
        } else if (ap[pk].length > 0 && DB.knownPartKeys[pk]) {
            // 在穿但被驱逐了：读回来，保证注入时一定拿得到这套穿搭
            startPartitionLoad(pk);
        }
    }
    return result;
}

// ══════════════════════════════════════════════════════════
//  charIndex 辅助
// ══════════════════════════════════════════════════════════

export function charNameById(charId) {
    var meta = loadMeta();
    if (charId === SHARED_CHAR_KEY) return SHARED_CHAR_KEY;
    for (var i = 0; i < (meta.charIndex || []).length; i++) {
        if (meta.charIndex[i].id === charId) return meta.charIndex[i].name;
    }
    return '';
}

export function charIdByName(name) {
    var meta = loadMeta();
    for (var i = 0; i < (meta.charIndex || []).length; i++) {
        if (meta.charIndex[i].name === name) return meta.charIndex[i].id;
    }
    return '';
}

export function charPartKey(charId) {
    if (charId === SHARED_CHAR_KEY) return 'char:__shared__';
    return 'char:' + charId;
}

// ══════════════════════════════════════════════════════════
