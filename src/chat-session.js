// Outfit Manager · 二改版 | 聊天归属、独立会话与本机恢复记录
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { idbGet, idbPut } from './db/idb.js';

export var CHAT_STATE_KEY = 'outfitManagerChatV3';
var sessions = new Map(), metadataOwners = new WeakMap(), hydrated = new Set(), pendingHost = new Set();
var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
var storagePrefix = 'om_chat_state_v4:';
export function getChatContext() {
    try {
        var context = SillyTavern.getContext();
        return context && context.chatMetadata && typeof context.chatMetadata === 'object' && getChatIdentity(context) ? context : null;
    } catch (error) { return null; }
}
export function getChatIdentity(context) {
    try {
        context = context || SillyTavern.getContext();
        var id = typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : context.chatId;
        if (id == null || id === '') return '';
        var group = context.groupId !== null && context.groupId !== undefined && context.groupId !== '' && context.groupId !== false;
        var character = context.characters && context.characters[context.characterId];
        var owner = group ? 'group:' + context.groupId : 'character:' + ((character && character.avatar) || (context.characterId != null ? context.characterId : context.name2 || 'user'));
        return JSON.stringify([owner, String(id)]);
    } catch (error) { return ''; }
}
function blank(identity) {
    return { version: 3, presetBindingVersion:1, view:{kind:'user',characterId:''}, chatKey: identity, updatedAt: 0, presetId: null, active: {}, current: {}, modes: {}, scene: '', switchMode: 'auto', timeline: [], recommendations: {}, wearLog:[] };
}
function normalize(value, identity) {
    var result = clone(value);
    result.version = 3; result.chatKey = identity;
    ['active','current','modes','recommendations'].forEach(function (field) { if (!result[field] || typeof result[field] !== 'object' || Array.isArray(result[field])) result[field] = {}; });
    if (!Array.isArray(result.timeline)) result.timeline = [];
    result.timeline = result.timeline.slice(0, 100);
    Object.keys(result.active).forEach(function (key) {
        result.active[key] = Array.from(new Set(Array.isArray(result.active[key]) ? result.active[key].filter(function (id) { return typeof id === 'string'; }) : []));
        if (!result.modes[key]) result.modes[key] = result.active[key].length > 1 ? 'wardrobe' : 'fixed';
        if (!result.current[key] && result.active[key].length) result.current[key] = { outfitId: result.active[key][0], locked: false, hiddenAccIds: [], extraAccIds: [] };
    });
    if(!result.presetBindingVersion){
        var owners=Array.from(new Set(Object.keys(result.active).filter(function(key){return key.startsWith('user:')&&result.active[key].length;}).concat(Object.keys(result.current).filter(function(key){return key.startsWith('user:')&&result.current[key]&&result.current[key].outfitId;}))));
        if(owners.length===1)result.presetId=owners[0]==='user:__default__'?null:owners[0].slice(5);
        result.presetBindingVersion=1;
    }
    if(!result.view||!['user','char'].includes(result.view.kind))result.view={kind:'user',characterId:''};
    if(!Array.isArray(result.wearLog))result.wearLog=[];result.wearLog=result.wearLog.slice(0,120);
    return result;
}
function localRead(identity) {
    try { var value = JSON.parse(localStorage.getItem(storagePrefix + identity)); return value && value.chatKey === identity ? value : null; } catch (error) { return null; }
}
export function getSession(identity) { return sessions.get(identity); }
export function currentSession() {
    var context = getChatContext(); if (!context) return null;
    var identity = getChatIdentity(context), value = context.chatMetadata[CHAT_STATE_KEY], session = sessions.get(identity);
    var claimed = value && typeof value === 'object' && metadataOwners.get(value);
    var valid = value && [1,2,3].includes(value.version) && (!value.chatKey || value.chatKey === identity) && (!claimed || claimed === identity);
    if (!session) {
        var backup = localRead(identity);
        session = valid ? normalize(value, identity) : blank(identity);
        if (backup && (!valid || Number(backup.updatedAt) > Number(session.updatedAt || 0))) { session = normalize(backup, identity); pendingHost.add(identity); }
        sessions.set(identity, session);
    } else if (valid && Number(value.updatedAt) > Number(session.updatedAt || 0)) {
        session = normalize(value, identity); sessions.set(identity, session);
    }
    // Never let a shared metadata object become the authoritative state of two chats.
    if (value && typeof value === 'object') metadataOwners.set(value, value.chatKey || identity);
    attachSession(context, session);
    return session;
}
export function attachSession(context, value) {
    if (!context || getChatIdentity(context) !== value.chatKey) return;
    var snapshot = clone(value); context.chatMetadata[CHAT_STATE_KEY] = snapshot; metadataOwners.set(snapshot, value.chatKey);
}
export function persistSession(value) {
    value.updatedAt = Math.max(Date.now(), Number(value.updatedAt || 0) + 1);
    var snapshot = clone(value), localOK = false;
    pendingHost.add(value.chatKey);
    try { localStorage.setItem(storagePrefix + value.chatKey, JSON.stringify(snapshot)); localOK = true; } catch (error) {}
    return new Promise(function (resolve) { try { idbPut(storagePrefix + value.chatKey, snapshot, function (ok) { resolve(!!ok || localOK); }); } catch (error) { resolve(localOK); } });
}
export function hydrateSession(identity) {
    if (hydrated.has(identity)) return Promise.resolve(false);
    hydrated.add(identity);
    return new Promise(function (resolve) {
        try { idbGet(storagePrefix + identity, function (stored) {
            var session = sessions.get(identity);
            if (stored && stored.chatKey === identity && session && Number(stored.updatedAt) > Number(session.updatedAt || 0)) {
                sessions.set(identity, normalize(stored, identity)); pendingHost.add(identity); resolve(true);
            } else resolve(false);
        }); } catch (error) { resolve(false); }
    });
}
export function clearSessionChoices(identity) {
    var value = sessions.get(identity); if (!value) return;
    value.active = {}; value.current = {}; value.modes = {}; value.recommendations = {};
}

export function needsHostSave(identity) { return pendingHost.has(identity); }
export function markHostSaved(identity) { pendingHost.delete(identity); }
