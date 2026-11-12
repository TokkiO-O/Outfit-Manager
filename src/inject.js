// Outfit Manager · 二改版 | 正常聊天请求的穿搭资料注入
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { prepareWardrobeControl, activateWardrobeControl, installWardrobeAI } from './wardrobe-ai.js';
// fetch/XHR 拦截 + 穿搭信息注入到 AI 请求
// v2: 使用 loadMeta() + loadActivePartitions() 代替旧 load() 全量读取

import { loadMeta, loadActivePartitions, currentUserPartKey, charNameById } from './db/index.js';
import { SHARED_CHAR_KEY, partGetById, getActiveKit, getKitAccessories } from './data.js';
import { toast } from './utils.js';
import { state, fn } from './bridge.js';
import { getChatState, sceneText, getChatIdentity } from './chat-state.js';
import { buildInjectionPlan } from './injection-plan.js';

var BAIBAOKU_SAVE_GENERATE_PATH = '/api/plugins/baibaoku/v1/chats/save-generate';
var RECENT_INJECTED_BODY_TTL = 2 * 60 * 1000;
var recentInjectedBodies = [];

// 获取注入用的图片URL（server模式下优先用预解析的base64）
function getInjectImageUrl(outfit) {
    if (!outfit || !outfit.imageData) return null;
    // 检查预解析缓存
    if (state.resolvedImages && state.resolvedImages[outfit.id]) {
        var cached = state.resolvedImages[outfit.id];
        if (cached.dataUrl && cached.url === outfit.imageData) {
            return cached.dataUrl;
        }
    }
    return /^(data:image\/|https?:\/\/)/.test(outfit.imageData) ? outfit.imageData : null;
}

// ── 文本注入 ─────────────────────────────────────────────
// position: 'system' | 'context' | 'user'
function injectText(p, text, position) {
    if (!p.messages || !Array.isArray(p.messages)) {
        if (typeof p.prompt === 'string') p.prompt = text + '\n\n' + p.prompt;
        return;
    }

    if (position === 'user') {
        for (var j = p.messages.length - 1; j >= 0; j--) {
            if (p.messages[j].role === 'user') {
                var c = p.messages[j].content;
                if (typeof c === 'string') p.messages[j].content = c + '\n\n' + text;
                else if (Array.isArray(c)) c.push({ type: 'text', text: '\n\n' + text });
                break;
            }
        }
    } else if (position === 'context') {
        var lastUserIdx = -1;
        for (var k = p.messages.length - 1; k >= 0; k--) {
            if (p.messages[k].role === 'user') { lastUserIdx = k; break; }
        }
        var sysMsg = { role: 'system', content: text };
        if (lastUserIdx > 0) p.messages.splice(lastUserIdx, 0, sysMsg);
        else if (lastUserIdx === 0) p.messages.unshift(sysMsg);
        else p.messages.push(sysMsg);
    } else {
        var si = -1; for (var i = 0; i < p.messages.length; i++) { if (p.messages[i].role === 'system') { si = i; break; } }
        if (si !== -1) {
            var sm = p.messages[si];
            if (typeof sm.content === 'string') sm.content += '\n\n' + text;
            else if (Array.isArray(sm.content)) sm.content.push({ type: 'text', text: '\n\n' + text });
        } else { p.messages.unshift({ role: 'system', content: text }); }
    }
}

// ── 图片注入（旧接口，保留兼容）─────────────────────────
function injectImages(p, imgs) {
    if (!p.messages || !Array.isArray(p.messages)) return;
    for (var j = p.messages.length - 1; j >= 0; j--) {
        if (p.messages[j].role === 'user') {
            var c = p.messages[j].content;
            var blocks = imgs.map(function (img) { return { type: 'image_url', image_url: { url: img } }; });
            if (typeof c === 'string') p.messages[j].content = [{ type: 'text', text: c }].concat(blocks);
            else if (Array.isArray(c)) blocks.forEach(function (b) { c.push(b); });
            break;
        }
    }
}

// ── 按owner交错注入 文字标签+图片 ────────────────────────
function injectImageBlocks(p, ownerImageGroups, imgPrompt, multiImgPrompt) {
    if (!p.messages || !Array.isArray(p.messages)) return;
    for (var j = p.messages.length - 1; j >= 0; j--) {
        if (p.messages[j].role === 'user') {
            var c = p.messages[j].content;
            if (typeof c === 'string') {
                c = [{ type: 'text', text: c }];
                p.messages[j].content = c;
            }

            if (ownerImageGroups.length > 1) {
                c.push({ type: 'text', text: '\n\n=== 穿搭图片参考 ===' });
            }

            var hasMulti = false;
            ownerImageGroups.forEach(function (grp) {
                if (grp.isMulti) {
                    hasMulti = true;
                    c.push({ type: 'text', text: '\n[' + grp.name + '的可选穿搭 - 共' + grp.outfits.length + '套]' });
                    grp.outfits.forEach(function (o, i) {
                        c.push({ type: 'text', text: '\n(穿搭' + (i + 1) + ')' + (o.sceneTag ? ' [场景：' + o.sceneTag + ']' : '') + '：' });
                        c.push({ type: 'image_url', image_url: { url: getInjectImageUrl(o) } });
                    });
                } else {
                    var o = grp.outfits[0];
                    c.push({ type: 'text', text: '\n[' + grp.name + '当前穿着]' });
                    c.push({ type: 'image_url', image_url: { url: getInjectImageUrl(o) } });
                }
            });

            var prompt = hasMulti ? multiImgPrompt : imgPrompt;
            if (prompt) {
                c.push({ type: 'text', text: '\n' + prompt });
            }

            if (ownerImageGroups.length > 1) {
                c.push({ type: 'text', text: '\n=== 穿搭图片结束 ===' });
            }
            break;
        }
    }
}

// ── 请求体注入逻辑（v2：基于 meta + activePartitions）──
function markPayloadInjected(p) {
    try {
        Object.defineProperty(p, '__omInjected', { value: true, configurable: true });
    } catch (e) {}
}

function cleanupRecentInjectedBodies(now) {
    var t = now || Date.now();
    recentInjectedBodies = recentInjectedBodies.filter(function (item) {
        return item && (t - item.at) < RECENT_INJECTED_BODY_TTL;
    });
}

// 性能：只保存「长度 + 首/中/尾片段」的指纹，不再把整包 JSON（含 base64 图片，
// 单包可能好几 MB）常驻内存做全串比对。以前最多缓存 20 份完整包体，
// 长时间聊天会吃掉几百 MB 内存，并让每次请求都做一次超长字符串比较。
function bodySignature(s) {
    var n = s.length;
    var mid = n > 2048 ? s.slice((n >> 1) - 256, (n >> 1) + 256) : '';
    var probe = s.slice(0, 512) + '\u0001' + mid + '\u0001' + (n > 1024 ? s.slice(n - 512) : '');
    var h = 2166136261 >>> 0;
    for (var i = 0; i < probe.length; i++) {
        h ^= probe.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return n + ':' + h;
}

function rememberInjectedBody(p) {
    try {
        cleanupRecentInjectedBodies();
        recentInjectedBodies.push({ sig: bodySignature(JSON.stringify(p)), at: Date.now() });
        if (recentInjectedBodies.length > 20) recentInjectedBodies.shift();
    } catch (e) {}
}

function wasRecentlyInjectedBody(bodyStr) {
    cleanupRecentInjectedBodies();
    if (recentInjectedBodies.length === 0) return false;
    var sig = bodySignature(bodyStr);
    for (var i = 0; i < recentInjectedBodies.length; i++) {
        if (recentInjectedBodies[i].sig === sig) return true;
    }
    return false;
}

function getFetchUrl(input) {
    try {
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.href;
        if (input && typeof input.url === 'string') return input.url;
    } catch (e) {}
    return '';
}

function isBaibaokuSaveGenerateRequest(input) {
    try {
        var rawUrl = getFetchUrl(input);
        if (!rawUrl) return false;
        var url = new URL(rawUrl, location.href);
        return url.origin === location.origin && url.pathname === BAIBAOKU_SAVE_GENERATE_PATH;
    } catch (e) {
        return false;
    }
}

function tryInjectPayload(p, options) {
    options = options || {};
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    if (p.__omInjected || p.__omInternal) return false;
    if (!p.messages && p.prompt === undefined) return false;

    var meta = loadMeta();
    var pos = meta.injectPosition || 'user';
    var useImg = (meta.mode === 'image' || meta.mode === 'both');
    var useText = (meta.mode === 'text' || meta.mode === 'both');

    // 获取所有有激活穿搭的 partition（已预加载，同步读取）
    var activeParts = loadActivePartitions();
    // activeParts = { 'user:p_xxx': {outfits,categories,activeIds}, 'char:c_xxx': {...}, ... }

    if (Object.keys(activeParts).length === 0) return null;

    // 收集所有 owner 及其激活穿搭
    var owners = [];

    // ── User 穿搭 ──
    var curUserPK = currentUserPartKey();
    if (activeParts[curUserPK]) {
        var userPart = activeParts[curUserPK];
        var userOutfits = [];
        (userPart.activeIds || []).forEach(function (id) {
            var o = partGetById(userPart, id);
            if (o) userOutfits.push(o);
        });
        if (userOutfits.length > 0) {
            owners.push({
                name: 'User',
                partKey: curUserPK,
                outfits: userOutfits,
                partition: userPart,
                tplSingle: meta.singleTemplate,
                tplMulti: meta.multiTemplate
            });
        }
    }

    // ── 角色衣柜：通用 vs 单人互斥 ──
    var sharedOutfits = [];
    var sharedPartKey = 'char:' + SHARED_CHAR_KEY;
    if (activeParts[sharedPartKey]) {
        var sharedPart = activeParts[sharedPartKey];
        (sharedPart.activeIds || []).forEach(function (id) {
            var o = partGetById(sharedPart, id);
            if (o) sharedOutfits.push(o);
        });
    }

    if (sharedOutfits.length > 0) {
        // 通用衣柜有激活 → 用当前角色卡名字注入，忽略所有单人衣柜
        var charName2 = '';
        try { charName2 = SillyTavern.getContext().name2 || ''; } catch (e) {}
        if (charName2) {
            owners.push({
                name: charName2,
                partKey: sharedPartKey,
                outfits: sharedOutfits,
                partition: activeParts[sharedPartKey],
                tplSingle: meta.charSingleTemplate,
                tplMulti: meta.charMultiTemplate
            });
        }
    } else {
        // 通用衣柜无激活 → 遍历各角色 partition
        for (var pk in activeParts) {
            // 跳过 user:* 和 shared
            if (pk.indexOf('char:') !== 0) continue;
            if (pk === sharedPartKey) continue;

            var charPart = activeParts[pk];
            var charOutfits = [];
            (charPart.activeIds || []).forEach(function (id) {
                var o = partGetById(charPart, id);
                if (o) charOutfits.push(o);
            });
            if (charOutfits.length > 0) {
                // 从 partKey 提取 charId，查角色名
                var charId = pk.substring(5); // 'char:'.length = 5
                var ownerName = charNameById(charId) || charId;
                owners.push({
                    name: ownerName,
                    partKey: pk,
                    outfits: charOutfits,
                    partition: charPart,
                    tplSingle: meta.charSingleTemplate,
                    tplMulti: meta.charMultiTemplate
                });
            }
        }
    }

    if (owners.length === 0) return null;

    var control = prepareWardrobeControl(owners, meta, !!options.preview);
    var plan = buildInjectionPlan(owners, meta, { chat: getChatState(), scene: sceneText(), resolveImage: getInjectImageUrl, wardrobeControl: control });
    if (!options.preview && plan.wardrobeControl) activateWardrobeControl(plan.wardrobeControl);
    if (options.onPlan) options.onPlan(plan);
    if (!options.preview) state.lastInjectionPlan = plan;
    var injected = false;
    if (plan.text) { injectText(p, plan.text, pos); injected = true; }
    if (plan.imageGroups.length) {
        injectPlannedImages(p, plan.imageBlocks); injected = true;
    }

    if (meta.debug && !options.preview) {
        var summary = owners.map(function (ow) { return ow.name + ':' + ow.outfits.length + '套'; }).join(' + ');
        toast('👗 ' + summary + ' [' + meta.mode + '|' + pos + ']');
    }

    if (injected && !options.preview) markPayloadInjected(p);
    return injected;
}

function tryInjectBody(bodyStr, options) {
    // 性能：酒馆的 fetch/XHR 调用非常频繁（保存设置、拉角色列表、轮询等），
    // 而这些请求里根本没有 prompt/messages。先做一次廉价子串检查，
    // 避免对每个请求都 JSON.parse 一遍可能上 MB 的包体。
    if (bodyStr.indexOf('"messages"') === -1 && bodyStr.indexOf('"prompt"') === -1) return null;
    if (wasRecentlyInjectedBody(bodyStr)) return null;

    var p; try { p = JSON.parse(bodyStr); } catch (e) { return null; }
    if (tryInjectPayload(p)) return JSON.stringify(p);

    if (options && options.baibaokuSaveGenerate && p && p.generate && typeof p.generate === 'object') {
        var nestedBody = '';
        try { nestedBody = JSON.stringify(p.generate); } catch (e) {}
        if (nestedBody && wasRecentlyInjectedBody(nestedBody)) return null;
        if (tryInjectPayload(p.generate)) return JSON.stringify(p);
    }

    return null;
}

function registerCompletionEventInjection() {
    if (window.__omCompletionEventInjectionInstalled) return;
    window.__omCompletionEventInjectionInstalled = true;

    var context; try { context = SillyTavern.getContext(); } catch (e) {}
    var source = context && context.eventSource ? Promise.resolve({ eventSource: context.eventSource, event_types: context.eventTypes || context.event_types }) : import('/script.js');
    source.then(function (mod) {
        var eventSource = mod && mod.eventSource;
        var eventTypes = mod && mod.event_types;
        var eventName = eventTypes && eventTypes.CHAT_COMPLETION_SETTINGS_READY;
        if (!eventSource || !eventName || typeof eventSource.on !== 'function') { window.__omCompletionEventInjectionInstalled = false; return; }

        var handler = async function (payload) {
            try {
                var chatBefore = getChatIdentity();
                if (fn.ensureChatPartitions) await fn.ensureChatPartitions();
                if (chatBefore !== getChatIdentity()) { markPayloadInjected(payload); rememberInjectedBody(payload); return; }
                if (tryInjectPayload(payload)) rememberInjectedBody(payload);
            } catch (e) {}
        };

        eventSource.on(eventName, handler);
        if (typeof eventSource.makeFirst === 'function') {
            eventSource.makeFirst(eventName, handler);
        }
    }).catch(function () {
        window.__omCompletionEventInjectionInstalled = false;
    });
}

function injectPlannedImages(payload, blocks) {
    if (!Array.isArray(payload.messages)) return;
    for (var i = payload.messages.length - 1; i >= 0; i--) {
        if (payload.messages[i].role !== 'user') continue;
        var content = payload.messages[i].content;
        if (!Array.isArray(content)) content = [{ type: 'text', text: typeof content === 'string' ? content : '' }];
        payload.messages[i].content = content.concat(blocks);
        return;
    }
}

// ── 安装拦截器 ─────────────────────────────────────────
export function setupInjection() {
    // 防止重复安装（热重载等场景）
    if (window.__omInjectionInstalled) return;
    window.__omInjectionInstalled = true;

    registerCompletionEventInjection();
    installWardrobeAI();

    var origFetch = window.fetch;
    window.fetch = function (input, init) {
        try {
            // 跳过插件内部的 API 调用
            if (init && (init.__omInternal || (init.headers && (init.headers['X-OM-Internal'] || (typeof init.headers.get === 'function' && init.headers.get('X-OM-Internal')))))) {
                var internal = Object.assign({}, init); delete internal.__omInternal;
                return origFetch.call(this, input, internal);
            }
            if (!isChatGenerationRequest(input)) return origFetch.apply(this, arguments);
            if (init && init.body && typeof init.body === 'string') {
                var nb = tryInjectBody(init.body, { baibaokuSaveGenerate: isBaibaokuSaveGenerateRequest(input) });
                if (nb) { init = Object.assign({}, init, { body: nb }); return origFetch.call(this, input, init); }
            }
        } catch (e) {}
        return origFetch.apply(this, arguments);
    };
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) { this.__omUrl = url; return origOpen.apply(this, arguments); };
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
        try { if (isChatGenerationRequest(this.__omUrl) && body && typeof body === 'string') { var nb = tryInjectBody(body); if (nb) return origSend.call(this, nb); } } catch (e) {}
        return origSend.apply(this, arguments);
    };
}

export function isChatGenerationRequest(input) {
    try {
        var url = new URL(getFetchUrl(input), location.href);
        return url.origin === location.origin && [
            '/api/backends/chat-completions/generate', '/api/backends/text-completions/generate',
            '/api/backends/kobold/generate', '/api/novelai/generate', BAIBAOKU_SAVE_GENERATE_PATH
        ].indexOf(url.pathname) !== -1;
    } catch (e) { return false; }
}

export function getInjectionPreview() {
    var plan = { text: '', rows: [], imageGroups: [], warnings: [], imageCount: 0, estimatedTextTokens: 0, budget: loadMeta().injectionBudget || {} };
    tryInjectPayload({ messages: [{ role: 'user', content: '' }] }, { preview: true, onPlan: function (value) { plan = value; } });
    return plan;
}
