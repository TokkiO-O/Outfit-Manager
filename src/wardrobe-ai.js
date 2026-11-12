// Outfit Manager · 二改版 | 同次聊天生成中的候选选衣与结果校验
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { rankWardrobe, wardrobeTags } from './wardrobe-match.js';
import { sceneText } from './chat-state.js';
import { getChatState, getChatIdentity, saveChatState, notifyChat, applyChatContext } from './chat-state.js';
import { getSession } from './chat-session.js';
import { DB } from './db/state.js';

var tickets = new Map(), installed = false;
var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
function stamp(chat, key) { return JSON.stringify([chat.presetId,chat.active[key], chat.current[key], chat.modes[key], chat.switchMode]); }
export function prepareWardrobeControl(owners, meta, preview) {
    var chat = getChatState(), identity = getChatIdentity();
    if (!chat || !identity) return null;
    var limit = Math.max(1, Math.min(20, Number((meta.injectionBudget || {}).maxCandidates) || 3));
    var entries = [];
    owners.forEach(function (owner) {
        var current = chat.current[owner.partKey];
        if (chat.modes[owner.partKey] !== 'wardrobe' || (current && current.locked)) return;
        var chosen = owner.outfits || [], worn = current && chosen.find(function (item) { return item.id === current.outfitId; });
        var pool = (worn ? [worn] : []).concat(rankWardrobe(chosen.filter(function(item){return !worn||item.id!==worn.id;}),sceneText()).slice(0,limit).map(function(item){return item.outfit;}));
        if (!pool.length) return;
        entries.push({ owner: owner.partKey, name: owner.name, current: worn ? worn.id : null, before: stamp(chat, owner.partKey),
            outfits: pool.map(function (item) { return { id: item.id, name: item.name || '穿搭', scene: wardrobeTags(item).tags.join('、'), category:[item.category,item.subCategory].filter(Boolean).join(' · '), description: String(item.description || '').slice(0, 200) }; }) });
    });
    if (!entries.length) return null;
    var nonce = preview ? '预览' : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    var text = '[本次聊天的候选衣柜]\n' + JSON.stringify(entries.map(function (entry) { return { owner: entry.owner, name: entry.name, current: entry.current, outfits: entry.outfits }; })) +
        '\n平常延续 current；只有明确换衣或当前剧情场景确实改变时，才从对应 outfits 中选一套。回忆、否定、假设不算换衣。不要混穿多套，不要自行编造候选外的衣服。';
    if (chat.switchMode === 'confirm') {
        text += '\n现在需要用户确认换装，只能建议，叙述继续保持 current。';
        return { text: text, entries: entries, preview: true };
    }
    text += '\n若确定本次叙述换上新穿搭，在回复末尾添加一条不可见 HTML 注释：<!--OM_WEAR:' + JSON.stringify({ nonce: nonce, wear: [{ owner: entries[0].owner, outfitId: entries[0].current || entries[0].outfits[0].id }] }) +
        '-->。仅列实际换上的 owner/outfitId；未换则不输出标记，标记不要放进代码块。\n';
    var control = { text: text, nonce: nonce, identity: identity, entries: entries, at: Date.now(), preview: !!preview };
    return control;
}
export function activateWardrobeControl(control) {
    if (!control || control.preview || !control.nonce) return;
    tickets.set(control.nonce, control);
    tickets.forEach(function (ticket, key) { if (Date.now() - ticket.at > 600000) tickets.delete(key); });
    if (tickets.size > 30) tickets.delete(tickets.keys().next().value);
}
export function consumeWardrobeReply(text) {
    var changes = [], clean = String(text || '').replace(/<!--\s*OM_WEAR:([\s\S]*?)-->/g, function (full, json) {
        try {
            var value = JSON.parse(json), ticket = tickets.get(value.nonce);
            if (!ticket || Date.now() - ticket.at > 600000 || !Array.isArray(value.wear)) return '';
            var chat = getSession(ticket.identity), seen = new Set();
            if (!chat) return '';
            var accepted = [];
            value.wear.forEach(function (wear) {
                if (!wear || seen.has(wear.owner)) return;
                seen.add(wear.owner);
                var entry = ticket.entries.find(function (item) { return item.owner === wear.owner; });
                var current = chat.current[wear.owner];
                if (!entry || chat.switchMode !== 'auto' || chat.modes[wear.owner] !== 'wardrobe' ||
                    (current && current.locked) || stamp(chat, wear.owner) !== entry.before ||
                    !entry.outfits.some(function (item) { return item.id === wear.outfitId; }) ||
                    !(chat.active[wear.owner] || []).includes(wear.outfitId) || (current && current.outfitId === wear.outfitId)) return;
                var part = DB.partCache[wear.owner];
                if (part && !(part.outfits || []).some(function (item) { return item.id === wear.outfitId; })) return;
                accepted.push(wear);
            });
            tickets.delete(value.nonce);
            if (accepted.length) {
                chat.timeline.unshift({ id: 'ai_' + Date.now().toString(36), at: Date.now(), label: 'AI 场景换装之前',
                    snapshot: clone({ view:chat.view,presetBindingVersion:1,presetId: chat.presetId, active: chat.active, current: chat.current, modes: chat.modes, scene: chat.scene, switchMode: chat.switchMode }) });
                chat.timeline = chat.timeline.slice(0, 100);
                accepted.forEach(function (wear) { var p=DB.partCache[wear.owner],o=p&&(p.outfits||[]).find(function(item){return item.id===wear.outfitId;});chat.wearLog=chat.wearLog||[];chat.wearLog.unshift({id:'ai_'+Date.now().toString(36)+'_'+wear.outfitId,at:Date.now(),partKey:wear.owner,presetId:chat.presetId||null,outfitId:wear.outfitId,kitId:null,name:o&&o.name||'穿搭',reason:'AI 场景换装'});chat.wearLog=chat.wearLog.slice(0,120);chat.current[wear.owner] = { outfitId: wear.outfitId, locked: false, hiddenAccIds: [], extraAccIds: [] }; delete chat.recommendations[wear.owner]; });
                saveChatState(ticket.identity); changes = changes.concat(accepted);
                if (getChatIdentity() === ticket.identity) { applyChatContext(); notifyChat({ grid: true }); }
            }
        } catch (error) {}
        return '';
    });
    return { text: clean.trimEnd(), changes: changes };
}
export function installWardrobeAI() {
    if (installed) return;
    var context; try { context = SillyTavern.getContext(); } catch (error) { return; }
    var events = context.eventSource, types = context.eventTypes || context.event_types || {};
    if (!events || !events.on) return;
    installed = true;
    function received(index) {
        var current; try { current = SillyTavern.getContext(); } catch (error) { return; }
        var message = current.chat && current.chat[Number.isInteger(index) ? index : current.chat.length - 1];
        if (!message || message.is_user || typeof message.mes !== 'string' || !message.mes.includes('OM_WEAR:')) return;
        var result = consumeWardrobeReply(message.mes); message.mes = result.text;
        if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = result.text;
        try { if (typeof current.updateMessageBlock === 'function') { var redraw = current.updateMessageBlock(Number.isInteger(index) ? index : current.chat.length - 1, message); if (redraw && redraw.catch) redraw.catch(function () {}); } } catch (error) {}
        try { if (typeof current.saveMetadata === 'function') { var saved = current.saveMetadata(); if (saved && saved.catch) saved.catch(function () {}); } } catch (error) {}
    }
    events.on(types.MESSAGE_RECEIVED || 'message_received', received);
    // Completed responses only; partial stream tokens never change clothing.
    if (types.GENERATION_STOPPED) events.on(types.GENERATION_STOPPED, function () { tickets.clear(); });
}
