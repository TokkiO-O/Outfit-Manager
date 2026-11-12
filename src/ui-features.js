// Outfit Manager · 二改版 | 聊天穿搭、注入预览与保存状态面板
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { openChatWardrobe } from './ui-sheets/chat-wardrobe.js';
import { fn, state } from './bridge.js';
import { DB } from './db/state.js';
import { loadMeta, currentPartKey, ensurePartitionLoaded } from './db/index.js';
import { getActiveKit, getKitAccessories } from './data.js';
import { getChatState, saveChatState, notifyChat, setCurrentOutfit, updateChatCurrent, restoreChatHistory,
    processSceneChange, subscribeChat, installChatState, applyChatPartition, metaForStorage, partitionForStorage, getChatIdentity, getWardrobeMode, setWardrobeMode, inheritLibraryChoices, reconcileChatContext, getBoundPresetId, getWornKit } from './chat-state.js';
import { getInjectionPreview } from './inject.js';
import { describeBackend, recheckBackend } from './db/capabilities.js';
import { subscribeSync, retrySync, resolveSyncConflicts, readRemotePartition } from './db/incremental.js';
import { accessorySlot, SLOT_LABELS, resolveAccessorySlots } from './slots.js';
import { createSheet, closeSheet } from './ui-sheets/sheet-base.js';
import { esc, toast } from './utils.js';

var installed = false;
var STATUS = { idle: '无待保存修改', pending: '等待同步', saving: '正在保存', saved: '已保存', error: '保存失败', conflict: '需处理冲突' };
function button(text, action, extra) { return '<button type="button" class="om-btn om-btn-outline" data-action="' + action + '" ' + (extra || '') + '>' + text + '</button>'; }
function title(text) { return '<div class="om-sheet-title">' + text + '</div>'; }
function closeButton() { return button('关闭', 'close'); }
function loadPart(key) { return new Promise(function (resolve, reject) { ensurePartitionLoaded(key, function (part) { if (part) resolve(part); else reject(new Error('衣柜未能载入，请在设置 → 调试 → 保存状态中重试')); }); }); }
function ownerName(key) {
    if (key === 'char:__shared__') return '通用衣柜';
    if (key.indexOf('user:') === 0) return 'User';
    var entry = (loadMeta().charIndex || []).find(function (item) { return item.partKey === key; });
    return entry ? entry.name : key;
}

function wrapPanel(render, subscribe) {
    var unsubscribe = function () {}, previous = null, ownerChat = getChatIdentity();
    var sheet = createSheet('<div class="om-feature-content"></div>', { modal: true, medium: true, onClose: function () { unsubscribe(); } });
    var target = sheet.querySelector('.om-feature-content');
    function update() {
        if (!sheet.isConnected) { unsubscribe(); return; }
        var switched = ownerChat !== getChatIdentity(); ownerChat = getChatIdentity();
        var next = document.createElement('div'); render(next);
        var markup = next.innerHTML;
        if (markup === previous) return;
        previous = markup;
        var scroll = sheet.querySelector('.om-sheet-content'), top = scroll && scroll.scrollTop;
        var opened = Array.from(target.querySelectorAll('details[data-detail]')).filter(function (el) { return el.open; }).map(function (el) { return el.dataset.detail; });
        var drafts = {}, focused = null;
        if (!switched) target.querySelectorAll('[data-draft]').forEach(function (el) {
            drafts[el.dataset.draft] = el.value;
            if (el === document.activeElement) focused = { key: el.dataset.draft, start: el.selectionStart, end: el.selectionEnd };
        });
        target.replaceChildren.apply(target, Array.from(next.childNodes));
        target.querySelectorAll('details[data-detail]').forEach(function (el) { if (opened.indexOf(el.dataset.detail) !== -1) el.open = true; });
        target.querySelectorAll('[data-draft]').forEach(function (el) {
            if (Object.prototype.hasOwnProperty.call(drafts, el.dataset.draft)) el.value = drafts[el.dataset.draft];
            if (el.matches('[data-extra-search]') && el.value) el.dispatchEvent(new Event('input', { bubbles: true }));
            if (focused && focused.key === el.dataset.draft) {
                el.focus({ preventScroll: true });
                try { el.setSelectionRange(focused.start, focused.end); } catch (e) {}
            }
        });
        if (scroll) scroll.scrollTop = top;
    }
    if (subscribe) unsubscribe = subscribe(update);
    sheet.addEventListener('click', function (event) { if (event.target.closest('[data-action="close"]')) closeSheet(sheet); });
    update(); return { sheet: sheet, update: update };
}

export async function ensureChatPartitions() {
    var contextChanged=await reconcileChatContext();
    var identity=getChatIdentity();
    var chat = getChatState();
    var userKey=getBoundPresetId()?'user:'+getBoundPresetId():'user:__default__';
    var keys = Array.from(new Set([currentPartKey()].concat(chat ? Object.keys(chat.active).filter(function(key){return !key.startsWith('user:')||key===userKey;}) : [])));
    await Promise.all(keys.filter(function (key) { return DB.knownPartKeys[key] || DB.partCache[key]; }).map(loadPart));
    if(getChatIdentity()!==identity)return ensureChatPartitions();
    if (chat) Object.keys(DB.partCache).forEach(function (key) { applyChatPartition(key, DB.partCache[key]); });
    if (fn.preResolveActiveImages) fn.preResolveActiveImages();
    if(contextChanged){if(fn.renderCatbar)fn.renderCatbar();if(fn.renderAccCatbar)fn.renderAccCatbar();notifyChat({grid:true});}
}

export { openChatWardrobe };

export function openInjectionPreview() {
    ensureChatPartitions().then(function () {
        var showingLast = false;
        var panel = wrapPanel(function (target) {
            var plan = showingLast && state.lastInjectionPlan ? state.lastInjectionPlan : getInjectionPreview();
            target.innerHTML = title('注入预览') + '<p>' + (showingLast ? '上次实际注入' : '下次注入预览') + ' · 文字约 ' + plan.estimatedTextTokens + ' token · ' + plan.imageCount + ' 张图片</p>' +
                '<p class="om-hint">内容预算在设置 → 调试中调整。文字 token 为估算，图片消耗由模型决定。</p>' +
                (plan.warnings.length ? '<div class="om-feature-notice">' + plan.warnings.map(esc).join('<br>') + '</div>' : '') +
                '<ul>' + plan.rows.map(function (row) { return '<li>' + esc(row.owner) + '：' + esc(row.name) + (row.locked ? ' · 已锁定' : '') + (row.accessories.length ? ' · ' + esc(row.accessories.join('、')) : '') + '</li>'; }).join('') + '</ul>' +
                '<label class="om-field">文字内容<textarea readonly rows="10">' + esc(plan.previewText || plan.text || '当前没有可注入的穿搭') + '</textarea></label>' +
                '<div class="om-feature-images">' + plan.imageGroups.map(function (group) { return group.outfits.map(function (item) { return '<img src="' + esc(item.imageData) + '" alt="' + esc(item.name) + '">'; }).join(''); }).join('') + '</div>' +
                '<div class="om-edit-foot">' + button('刷新预览', 'refresh-preview') + button(showingLast ? '查看下次注入' : '上次实际注入', 'toggle-last', state.lastInjectionPlan ? '' : 'disabled') + closeButton() + '</div>';
        });
        panel.sheet.addEventListener('click', function (event) {
            if (event.target.closest('[data-action="toggle-last"]')) { showingLast = !showingLast; panel.update(); }
            if (event.target.closest('[data-action="refresh-preview"]')) { showingLast = false; panel.update(); }
        });
    }).catch(function (error) { toast(error.message, true); });
}
function readableData(value) {
    return JSON.stringify(value, function (key, item) {
        if (key === 'key' && typeof item === 'string' && item) return '[已隐藏密钥]';
        if (key === 'imageData' || key === 'fabImage') return item ? '[图片引用]' : '';
        return item;
    }, 2);
}
export function openSyncCenter() {
    var latest = {}, choices = {}, checking = false;
    var panel = wrapPanel(function (target) {
        var conflict = DB.syncConflict, conflicts = conflict ? conflict.conflicts || [] : [];
        target.innerHTML = title('保存状态与后端') + '<p><strong>' + (STATUS[DB.syncState] || '保存状态') + '</strong> · ' + (DB.serverMode ? '服务器衣柜' : '浏览器本地衣柜') + '</p>' +
            '<p class="om-hint">' + esc(describeBackend(DB.backendInfo)) + '</p>' +
            (DB.serverMode ? button(checking ? '正在检测…' : '重新检测后端', 'recheck-backend', checking ? 'disabled' : '') : '') +
            (DB.syncError ? '<p class="om-feature-error">' + esc(DB.syncError) + '</p>' : '') +
            (conflict ? '<p class="om-feature-notice">其他页面或设备修改了衣柜。请选择每个冲突保留的内容；处理前会在本机保留副本。</p>' + conflicts.map(function (item) {
                var local = item.key === 'meta' ? metaForStorage(DB.metaCache) : DB.partCache[item.key] && partitionForStorage(item.key, DB.partCache[item.key]);
                return '<section class="om-feature-card"><strong>' + esc(item.key) + '</strong><div class="om-feature-diff"><label>本地待保存<textarea readonly rows="8">' + esc(readableData(local)) + '</textarea></label><label>服务器当前内容<textarea readonly rows="8">' + esc(latest[item.key] === undefined ? '点击读取服务器内容' : readableData(latest[item.key])) + '</textarea></label></div>' +
                    '<select data-choice="' + esc(item.key) + '"><option value="">请选择保留内容</option><option value="local"' + (choices[item.key] === 'local' ? ' selected' : '') + '>保留本地</option><option value="remote"' + (choices[item.key] === 'remote' ? ' selected' : '') + '>使用服务器</option></select></section>';
            }).join('') + (conflict.code === 'STALE_CLIENT_REVISION' ? '<p>服务器已执行恢复。请先导出本地完整备份，再重新检测存储。</p>' : button('读取服务器内容', 'read-latest') + button('应用选择并继续同步', 'resolve')) : button('立即重试保存', 'retry-sync')) +
            Object.keys(DB.partLoadErrors).map(function (key) { return '<p class="om-feature-error">' + esc(key) + '：' + esc(DB.partLoadErrors[key].message) + button('重新载入', 'reload-part', 'data-key="' + esc(key) + '"') + '</p>'; }).join('') +
            '<p class="om-hint">待保存衣柜：' + Object.keys(DB.dirtyPartKeys).length + '</p><div class="om-edit-foot">' + closeButton() + '</div>';
    }, subscribeSync);
    panel.sheet.addEventListener('change', function (event) { if (event.target.matches('[data-choice]')) choices[event.target.dataset.choice] = event.target.value; });
    panel.sheet.addEventListener('click', function (event) {
        var control = event.target.closest('[data-action]'); if (!control) return;
        if (control.dataset.action === 'recheck-backend' && !checking) { checking = true; panel.update(); recheckBackend().then(function () { checking = false; refreshSyncBadge(); panel.update(); }); }
        if (control.dataset.action === 'retry-sync') retrySync();
        if (control.dataset.action === 'read-latest') Promise.all((DB.syncConflict.conflicts || []).map(function (item) { return readRemotePartition(item.key).then(function (value) { latest[item.key] = value.data; }); })).then(panel.update).catch(function (error) { toast(error.message, true); });
        if (control.dataset.action === 'resolve') resolveSyncConflicts(choices).then(function () { panel.update(); if (fn.requestWardrobeRefresh) fn.requestWardrobeRefresh(); }).catch(function (error) { toast(error.message, true); });
        if (control.dataset.action === 'reload-part') {
            delete DB.partLoadErrors[control.dataset.key];
            loadPart(control.dataset.key).then(panel.update).catch(function (error) { toast(error.message, true); });
        }
    });
}
export function refreshSyncBadge() {
    document.querySelectorAll('[data-om-sync-label]').forEach(function (element) { element.textContent = STATUS[DB.syncState] || '保存状态'; element.dataset.status = DB.syncState; });
    document.querySelectorAll('[data-om-backend-info]').forEach(function (element) { element.textContent = describeBackend(DB.backendInfo); });
}
export function installFeatures() {
    fn.openChatWardrobe = openChatWardrobe; fn.openInjectionPreview = openInjectionPreview;
    fn.openSyncCenter = openSyncCenter; fn.ensureChatPartitions = ensureChatPartitions; fn.refreshSyncBadge = refreshSyncBadge;
    if (!installed) {
        var noticed = null;
        subscribeSync(function () {
            refreshSyncBadge();
            if (DB.syncState !== noticed && (DB.syncState === 'error' || DB.syncState === 'conflict')) {
                toast(DB.syncState === 'conflict' ? '衣柜有同步冲突，请到设置 → 调试 → 保存状态处理。' : '衣柜保存失败，请到设置 → 调试 → 保存状态查看详情。', true);
            }
            noticed = DB.syncState;
        });
        installed = true;
    }
    installChatState();
    ensureChatPartitions().catch(function (error) { toast(error.message, true); });
}
