// Outfit Manager · 二改版 | 聊天预设、候选衣柜与当前穿着状态
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { rankWardrobe } from './wardrobe-match.js';
// Chat state lives in SillyTavern chat metadata; wardrobe assets remain shared.
import { DB } from './db/state.js';
import { state, fn } from './bridge.js';
import { getActiveKit, getKitForCurrent } from './data.js';

import { CHAT_STATE_KEY, getChatContext, getChatIdentity, currentSession, getSession, attachSession, persistSession, hydrateSession, needsHostSave, markHostSaved } from './chat-session.js';
export { CHAT_STATE_KEY, getChatContext, getChatIdentity } from './chat-session.js';
var installed = false, lastChatIdentity = null, lastAppliedState = null, lastBrowseContext=null, listeners = [];
var saveStates = new Map();
var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
export function getChatState() {
    if (!DB.libraryDefaultsInitialized && DB.metaCache) {
        DB.libraryPresetId = DB.metaCache.activePresetId || null;
        Object.keys(DB.metaCache.activePartitions || {}).forEach(function (key) { DB.libraryActiveIds[key] = DB.metaCache.activePartitions[key].slice(); });
        DB.libraryDefaultsInitialized = true;
    }
    return currentSession();
}

export function subscribeChat(listener) {
    listeners.push(listener);
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
}

export function notifyChat(options) {
    options = options || {};
    listeners.slice().forEach(function (listener) { try { listener(); } catch (e) {} });
    if (options.grid) { try { if (fn.requestWardrobeRefresh) fn.requestWardrobeRefresh(); else if (fn.renderGrid) fn.renderGrid(); } catch (e) {} }
    if (options.bottom !== false) { try { if (fn.renderBottomStatus) fn.renderBottomStatus(); } catch (e) {} }
}

export function saveChatState(identity) {
    identity = identity || getChatIdentity();
    var value = getSession(identity) || (identity === getChatIdentity() && getChatState());
    if (!value) return Promise.resolve(false);
    var signature = JSON.stringify(Object.assign({}, value, { updatedAt: 0 }));
    var old = saveStates.get(identity);
    if (old && old.signature === signature && !(identity === getChatIdentity() && needsHostSave(identity))) return old.promise;
    var entry = { signature: signature }; saveStates.set(identity, entry);
    var localSave = persistSession(value);
    var context = getChatContext();
    if (context && getChatIdentity(context) === identity) attachSession(context, value);
    lastChatIdentity = getChatIdentity();
    lastAppliedState = JSON.stringify(getChatState());
    var hostAttempted = !!(context && getChatIdentity(context) === identity && typeof context.saveMetadata === 'function');
    var savedAt = value.updatedAt;
    var hostSave = Promise.resolve(true);
    if (context && getChatIdentity(context) === identity && typeof context.saveMetadata === 'function') {
        try { hostSave = Promise.resolve(context.saveMetadata()).then(function () { return true; }, function () { return false; }); } catch (error) { hostSave = Promise.resolve(false); }
    }
    entry.promise = Promise.all([localSave, hostSave]).then(function (results) {
        if (hostAttempted && results[1] && getChatIdentity() === identity && value.updatedAt === savedAt) markHostSaved(identity);
        var ok = results[0] || (hostAttempted && results[1]);
        if (getChatIdentity() === identity) {
            state.chatSaveError = !ok ? '聊天穿搭未能保存，请重试并导出备份。' : !results[1] ? '穿搭已保存在本机，酒馆聊天保存暂未完成。' : null;
        }
        if (!ok) saveStates.delete(identity);
        return ok;
    });
    return entry.promise;
}

export function snapshotChat(value) {
    return clone({ presetId: value.presetId, presetBindingVersion:1, view:value.view||{kind:'user',characterId:''}, active: value.active, current: value.current, scene: value.scene, switchMode: value.switchMode, modes: value.modes });
}

function record(value, label) {
    var context = getChatContext();
    value.timeline.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        at: Date.now(), message: context && context.chat ? Math.max(0, context.chat.length - 1) : null,
        label: label, snapshot: snapshotChat(value) });
    value.timeline = value.timeline.slice(0, 100);
}

export function applyChatPartition(key, part) {
    if (!part || part.__omCold) return part;
    if (!DB.libraryActiveIds[key]) DB.libraryActiveIds[key] = (part.activeIds || []).slice();
    var chat = getChatState();
    if (chat) part.activeIds = (chat.active[key] || []).filter(function (id) {
        return (part.outfits || []).some(function (item) { return item.id === id; });
    });
    return part;
}

// Persist library defaults, not whichever chat happens to be visible.
export function partitionForStorage(key, part) {
    var result = Object.assign({}, part);
    if (getChatState() && DB.libraryActiveIds[key]) result.activeIds = DB.libraryActiveIds[key].filter(function (id) {
        return (part.outfits || []).some(function (item) { return item.id === id; });
    });
    return result;
}

export function metaForStorage(meta) {
    var result = Object.assign({}, meta);
    if (!getChatState()) return result;
    result.activePresetId = DB.libraryPresetId || null;
    if (result.activePresetId && !(meta.presets || []).some(function (item) { return item.id === result.activePresetId; })) result.activePresetId = null;
    result.activePartitions = Object.assign({}, meta.activePartitions || {});
    Object.keys(DB.libraryActiveIds).forEach(function (key) {
        var ids = DB.partCache[key] ? partitionForStorage(key, DB.partCache[key]).activeIds : DB.libraryActiveIds[key];
        if (ids && ids.length) result.activePartitions[key] = ids.slice();
        else delete result.activePartitions[key];
    });
    var keepUser = result.activePresetId ? 'user:' + result.activePresetId : 'user:__default__';
    Object.keys(result.activePartitions).forEach(function (key) {
        if (key.indexOf('user:') === 0 && key !== keepUser) delete result.activePartitions[key];
        if (key.indexOf('char:') === 0 && !(meta.charIndex || []).some(function (item) { return item.partKey === key; })) delete result.activePartitions[key];
    });
    return result;
}

function enforceOwnerChoices(chat, key) {
    Object.keys(chat.active).forEach(function (other) {
        var clear = key === 'char:__shared__' ? other.startsWith('char:') && other !== key
            : key.startsWith('char:') ? other === 'char:__shared__'
            : false;
        if (clear) { delete chat.active[other]; delete chat.current[other]; delete chat.recommendations[other]; }
    });
}
export function captureChatSelection(key, ids) {
    var chat = getChatState();
    if (!chat) return false;
    var next = Array.from(new Set(ids || []));
    if (getWardrobeMode(key) === 'fixed' && next.length > 1) next = next.slice(-1);
    if (JSON.stringify(chat.active[key] || []) === JSON.stringify(next)) return true;
    record(chat, '选择穿搭之前');
    if(key.startsWith('user:')){chat.presetId=key==='user:__default__'?null:key.slice(5);chat.presetBindingVersion=1;}
    if (next.length) enforceOwnerChoices(chat, key);
    chat.active[key] = next;
    var current = chat.current[key],previousId=current&&current.outfitId;
    if (!current || next.indexOf(current.outfitId) === -1) {
        if (next.length) chat.current[key] = { outfitId: next[0], locked: false, hiddenAccIds: [], extraAccIds: [] };
        else delete chat.current[key];
    }
    if(chat.current[key]&&chat.current[key].outfitId!==previousId){var p=DB.partCache[key],o=p&&(p.outfits||[]).find(function(item){return item.id===chat.current[key].outfitId;});if(o)logWear(chat,key,o,'选择穿搭');}
    if (DB.partCache[key]) applyChatPartition(key, DB.partCache[key]);
    saveChatState();
    return true;
}

export function setChatPreset(id) {
    var chat = getChatState();
    if (!chat) return;
    if (chat.presetId !== id) record(chat, '切换衣柜预设之前');
    chat.presetId = id || null;
    chat.presetBindingVersion=1;chat.view={kind:'user',characterId:''};
    if(DB.metaCache){DB.metaCache.activePresetId=id||null;DB.metaCache.currentView='user';DB.metaCache.currentChar='';}
    saveChatState();
}

export function getBoundPresetId() {
    var chat=getChatState(),id=chat?chat.presetId:DB.metaCache&&DB.metaCache.activePresetId;
    if(!id&&(DB.metaCache&&DB.metaCache.presets||[]).some(function(item){return item.id==='__default__'&&item.partKey==='user:__default__';}))id='__default__';
    return id&&(DB.metaCache&&DB.metaCache.presets||[]).some(function(item){return item.id===id;})?id:null;
}
export function getWardrobeView() {
    var chat = getChatState(), meta = DB.metaCache || {};
    var view = chat ? chat.view || { kind: 'user', characterId: '' } : { kind: meta.currentView, characterId: meta.currentChar };
    if (view.kind !== 'char') return { kind: 'user', characterId: '' };
    var id = view.characterId;
    if (id !== '__shared__' && !(meta.charIndex || []).some(function (item) { return item.id === id; })) id = '__shared__';
    return { kind: 'char', characterId: id || '__shared__' };
}
export function setChatView(kind,characterId) {
    var chat=getChatState();if(!chat)return;
    var previous=chat.view||{},lastCharacterId=previous.lastCharacterId||previous.characterId||'';
    if(kind==='char'){
        characterId=characterId||lastCharacterId||'__shared__';
        if(characterId!=='__shared__'&&!(DB.metaCache&&DB.metaCache.charIndex||[]).some(function(item){return item.id===characterId;}))characterId='__shared__';
        lastCharacterId=characterId;
    }
    chat.view={kind:kind==='char'?'char':'user',characterId:kind==='char'?characterId:''};
    if(lastCharacterId)chat.view.lastCharacterId=lastCharacterId;
    if(DB.metaCache){DB.metaCache.currentView=chat.view.kind;DB.metaCache.currentChar=chat.view.characterId;}
    saveChatState();
}
export function getWornKit(key,outfit) {
    if(!outfit)return null;
    var chat=getChatState(),current=chat&&chat.current[key];
    return getKitForCurrent(outfit,current);
}
function logWear(chat,key,outfit,reason) {
    chat.wearLog=chat.wearLog||[];
    var top=chat.wearLog[0];if(top&&top.partKey===key&&top.outfitId===outfit.id&&top.kitId===(chat.current[key]&&chat.current[key].kitId||null)&&Date.now()-top.at<1000)return;
    chat.wearLog.unshift({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),at:Date.now(),partKey:key,presetId:chat.presetId||null,outfitId:outfit.id,kitId:chat.current[key]&&chat.current[key].kitId||null,name:outfit.name||'穿搭',reason:reason||'手动换装'});chat.wearLog=chat.wearLog.slice(0,120);
}

export function setCurrentOutfit(key, id, options) {
    var chat = getChatState();
    if (!chat) return false;
    var part = DB.partCache[key];
    if (!part || !(part.outfits || []).some(function (item) { return item.id === id; })) return false;
    var sharedConflict = key.startsWith('char:') && key !== 'char:__shared__' && (chat.active['char:__shared__'] || []).length;
    if (chat.current[key] && chat.current[key].outfitId === id && (chat.active[key] || []).includes(id) && !sharedConflict && !options) return true;
    var activeChanged = (chat.active[key] || []).indexOf(id) === -1;
    record(chat, (options && options.reason) || '换装之前');
    enforceOwnerChoices(chat, key);
    var previous = chat.current[key] || {};
    if (getWardrobeMode(key) === 'fixed') chat.active[key] = [id];
    else if ((chat.active[key] || []).indexOf(id) === -1) (chat.active[key] = chat.active[key] || []).push(id);
    chat.current[key] = { outfitId: id, locked: !!(options && options.locked), hiddenAccIds: [], extraAccIds: [] };
    if(options&&options.kitId&&(part.outfits.find(function(item){return item.id===id;}).kits||[]).some(function(kit){return kit.id===options.kitId;}))chat.current[key].kitId=options.kitId;
    if(key.startsWith('user:')){chat.presetId=key==='user:__default__'?null:key.slice(5);chat.presetBindingVersion=1;}
    if (options && options.preserveLock) chat.current[key].locked = !!previous.locked;
    delete chat.recommendations[key];
    applyChatPartition(key, part);
    logWear(chat,key,part.outfits.find(function(item){return item.id===id;}),options&&options.reason);
    saveChatState(); notifyChat({ grid: true });
    if (fn.preResolveActiveImages) fn.preResolveActiveImages();
    return true;
}

export function updateChatCurrent(key, patch) {
    var chat = getChatState();
    if (!chat || !chat.current[key]) return;
    if (Object.keys(patch).every(function (field) { return JSON.stringify(chat.current[key][field]) === JSON.stringify(patch[field]); })) return;
    record(chat, '调整单品或锁定之前');
    Object.assign(chat.current[key], patch);
    saveChatState(); notifyChat();
}

export function restoreChatHistory(id) {
    var chat = getChatState();
    var entry = chat && chat.timeline.find(function (item) { return item.id === id; });
    if (!entry) return false;
    var target = clone(entry.snapshot);
    record(chat, '回退穿搭之前');
    Object.assign(chat, target);
    applyChatContext(); saveChatState(); notifyChat({ grid: true }); return true;
}

export function sceneText() {
    var chat = getChatState();
    var context = getChatContext();
    if (chat && chat.scene) return chat.scene;
    return ((context && context.chat) || []).slice(-3).map(function (message) {
        return String(message.mes || message.content || '').slice(-1500);
    }).join('\n');
}

export function rankSceneOutfits(outfits,text){return rankWardrobe(outfits,text);}

export function processSceneChange() {
    var chat = getChatState();
    if (!chat) return;
    var before = JSON.stringify({ current: chat.current, recommendations: chat.recommendations });
    var text = sceneText();
    Object.keys(chat.active).forEach(function (key) {
        if(key.startsWith('user:')&&key!==(getBoundPresetId()?'user:'+getBoundPresetId():'user:__default__'))return;
        var part = DB.partCache[key], current = chat.current[key];
        if (!part || !current || current.locked) return;
        if (chat.modes[key] !== 'wardrobe' || chat.switchMode === 'auto') { delete chat.recommendations[key]; return; }
        var ranked = rankSceneOutfits((part.outfits || []).filter(function (item) { return chat.active[key].indexOf(item.id) !== -1; }), text);
        if (!ranked.length || ranked[0].score <= 0 || ranked[0].outfit.id === current.outfitId) { delete chat.recommendations[key]; return; }
        chat.recommendations[key] = { outfitId: ranked[0].outfit.id, reason: '匹配场景：' + ranked[0].tags.join('、') };

    });
    if (before !== JSON.stringify({ current: chat.current, recommendations: chat.recommendations })) { saveChatState(); notifyChat(); }
}

export function applyChatContext() {
    var chat = getChatState();
    if (!chat) return;
    var browse=JSON.stringify([chat.chatKey,getBoundPresetId(),chat.view]);
    if(browse!==lastBrowseContext){
        state.curCat='__all__';state.catDrillParent=null;state.curSubCat=null;state.accCat='__all__';state.accDrillParent=null;state.accSubCat=null;
        state.searchQuery='';state.filterNoCat=false;state.filterNoTag=false;state.filterNoDesc=false;state.filterFavorite=false;state.filterThinTag=false;state.filterNoImg=false;
        if(typeof document!=='undefined'){var grid=document.getElementById('om-grid-area');if(grid)grid.scrollTop=0;var search=document.getElementById('om-search-inp');if(search)search.value='';}
        lastBrowseContext=browse;
    }
    if (DB.metaCache) {
        DB.metaCache.activePresetId = getBoundPresetId();
        var view=getWardrobeView();
        DB.metaCache.currentView=view.kind;
        DB.metaCache.currentChar=view.characterId;
    }
    Object.keys(DB.partCache).forEach(function (key) { applyChatPartition(key, DB.partCache[key]); });
    state.resolvedImages = {};
    state.lastInjectionPlan = null;
    state.kitFocusPartKey = null; state.kitFocusOutfitId = null;
    state.kitDraftAccIds = []; state.kitDraftDirty = false;
    state.batchSelected = []; state.batchMode = false;
    lastChatIdentity = getChatIdentity();
    lastAppliedState = JSON.stringify(chat);
}

export async function reconcileChatContext() {
    var identity=getChatIdentity();if(!identity)return false;
    var chat=getChatState();await hydrateSession(identity);
    if(getChatIdentity()!==identity)return false;
    chat=getChatState();
    if(identity===lastChatIdentity&&JSON.stringify(chat)===lastAppliedState)return false;
    applyChatContext();
    if(fn.renderViewbar)fn.renderViewbar();
    if(needsHostSave(identity))saveChatState(identity);
    return true;
}

export function installChatState() {
    applyChatContext();
    if (installed) return;
    var context = getChatContext();
    if(!context){try{context=SillyTavern.getContext();}catch(error){}}
    var events = context && context.eventSource, types = context && (context.eventTypes || context.event_types);
    if (!events || !types || typeof events.on !== 'function') return;
    installed = true;
    async function restore(){
        if (await reconcileChatContext()) {
            if (fn.ensureChatPartitions) {
                try { await fn.ensureChatPartitions(); } catch (error) { state.chatSaveError = error.message; }
            }
            if(fn.renderCatbar)fn.renderCatbar();if(fn.renderAccCatbar)fn.renderAccCatbar();
            notifyChat({ grid: true });
        }
    }
    var restoreTimers=[];
    events.on(types.CHAT_CHANGED || 'chat_id_changed', async function () {
        restoreTimers.forEach(clearTimeout);restoreTimers=[];
        await new Promise(function(resolve){setTimeout(resolve,0);});await restore();
        [120,350,800,1600].forEach(function(delay){restoreTimers.push(setTimeout(function(){restore().catch(function(error){state.chatSaveError=error.message;});},delay));});
    });
    if (types.MESSAGE_RECEIVED) events.on(types.MESSAGE_RECEIVED, processSceneChange);
    var initialIdentity = getChatIdentity();
    if (initialIdentity) hydrateSession(initialIdentity).then(function (changed) { if (getChatIdentity() === initialIdentity) { if (changed) { applyChatContext(); notifyChat({ grid: true }); } if (needsHostSave(initialIdentity)) saveChatState(initialIdentity); } });
    if (types.MESSAGE_SENT) events.on(types.MESSAGE_SENT, processSceneChange);
}

export function getWardrobeMode(key) { var chat = getChatState(); return chat && chat.modes[key] === 'wardrobe' ? 'wardrobe' : 'fixed'; }
export function setWardrobeMode(key, mode) {
    var chat = getChatState(); if (!chat) return;
    var wasFixed = getWardrobeMode(key) !== 'wardrobe';
    record(chat, '切换穿搭模式之前'); chat.modes[key] = mode === 'wardrobe' ? 'wardrobe' : 'fixed';
    if (wasFixed && mode === 'wardrobe') chat.switchMode = 'auto';
    if (mode !== 'wardrobe') { var current = chat.current[key]; chat.active[key] = current ? [current.outfitId] : []; }
    if (DB.partCache[key]) applyChatPartition(key, DB.partCache[key]);
    saveChatState(); notifyChat({ grid: true });
}
export function selectChatOutfit(key, id) {
    var chat = getChatState(); if (!chat) return false;
    var part = DB.partCache[key];
    if (!part || !(part.outfits || []).some(function (item) { return item.id === id; })) return false;
    if (getWardrobeMode(key) === 'fixed') {
        if (!(chat.active[key] || []).includes(id)) return setCurrentOutfit(key, id);
        captureChatSelection(key, []); notifyChat({ grid: true }); return true;
    }
    var ids = (chat.active[key] || []).slice(), at = ids.indexOf(id);
    if (at === -1) ids.push(id); else ids.splice(at, 1);
    captureChatSelection(key, ids); notifyChat({ grid: true }); return true;
}
export function addWardrobeCandidate(key, id) {
    var chat = getChatState(); if (!chat) return false;
    if (getWardrobeMode(key) !== 'wardrobe') chat.switchMode = 'auto';
    chat.modes[key] = 'wardrobe';
    var ids = Array.from(new Set((chat.active[key] || []).concat(id)));
    captureChatSelection(key, ids); notifyChat({ grid: true }); return true;
}
export function inheritLibraryChoices() {
    var chat = getChatState(); if (!chat) return;
    record(chat, '载入默认穿搭之前');
    chat.active = clone(DB.libraryActiveIds || {}); chat.current = {}; chat.modes = {};
    Object.keys(chat.active).forEach(function (key) { var ids = chat.active[key]; if (ids.length) { chat.modes[key] = ids.length > 1 ? 'wardrobe' : 'fixed'; chat.current[key] = { outfitId: ids[0], locked: false, hiddenAccIds: [], extraAccIds: [] }; } });
    applyChatContext(); saveChatState(); notifyChat({ grid: true });
}
