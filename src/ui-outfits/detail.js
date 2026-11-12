// Outfit Manager · 二改版 | 当前穿搭、套装与临时单品详情
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getChatState, getWardrobeMode, getWornKit, setCurrentOutfit } from '../chat-state.js';

import { fn, state } from '../bridge.js';
import { SHARED_CHAR_KEY, ensureOutfitKits, getActiveKit, getKitAccessories, partGetAccById, partGetById } from '../data.js';
import { charNameById, currentPartKey, currentUserPartKey, loadActivePartitions, loadMeta, loadPartition, savePartition, syncActivePartitions } from '../db/index.js';
import { esc, toast } from '../utils.js';
import { SH, clearKitDraft, isCurrentKitFocus, preResolveActiveImages, setKitFocus } from './core.js';
import { autoTagUntagged, openActionUndoSheet, pushActionUndo } from './classify.js';

// ── 底栏状态（使用 loadActivePartitions 跨分包显示）────────
export function renderBottomStatus() {
    var el = document.getElementById('om-bottom-status'); if (!el) return;
    var meta = loadMeta();
    var activeParts = loadActivePartitions();

    var allActive = [];
    var curUserPK = currentUserPartKey();

    for (var pk in activeParts) {
        var ap = activeParts[pk];
        var ownerName;
        if (pk.indexOf('user:') === 0) {
            ownerName = 'User';
        } else if (pk === 'char:' + SHARED_CHAR_KEY) {
            ownerName = SHARED_CHAR_KEY;
        } else {
            var cid = pk.substring(5);
            ownerName = charNameById(cid) || cid;
        }
        (ap.activeIds || []).forEach(function (id) {
            var o = partGetById(ap, id);
            if (o) allActive.push({ owner: ownerName, name: o.name, id: id, partKey: pk });
        });
    }

    var dotClass, text;
    if (allActive.length === 0) { dotClass = 'gray'; text = '未选择穿搭'; }
    else {
        dotClass = 'green';
        var chat = getChatState(), labels = [];
        Object.keys(activeParts).forEach(function (key) {
            var part = activeParts[key], current = chat && chat.current[key];
            var worn = current && partGetById(part, current.outfitId);
            var count = (part.activeIds || []).filter(function (id) { return !current || id !== current.outfitId; }).length;
            var owner = key.indexOf('user:') === 0 ? 'User' : key === 'char:__shared__' ? '通用' : charNameById(key.slice(5));
            labels.push(owner + ' 当前：' + (worn ? worn.name : '未指定当前') + (count ? '｜备用 ' + count + ' 套' : ''));
        });
        text = labels.join(' · ');
        if (allActive.length > 1) dotClass = 'orange';
    }

    var clearBtn = allActive.length > 0 ? '<button class="om-status-clear" id="om-status-clearall">全部取消</button>' : '';
    var wardrobe = getWardrobeMode(currentPartKey()) === 'wardrobe';
    var modeBtn = '<button type="button" class="om-status-mode" aria-pressed="' + wardrobe + '" title="' +
        (wardrobe ? '衣柜模式：点图增减备选；点击切换固定穿搭' : '固定模式：点图换穿，再点取消；点击开启衣柜模式') + '">' +
        '<i class="fa-solid ' + (wardrobe ? 'fa-layer-group' : 'fa-shirt') + '"></i><span>' + (wardrobe ? '衣柜' : '固定') + '</span></button>';
    el.innerHTML = modeBtn + '<div class="om-status-dot ' + dotClass + '"></div><span class="om-status-text">' + esc(text) + '</span>' + clearBtn;

    var clr = el.querySelector('#om-status-clearall');
    if (clr) clr.addEventListener('click', function (e) {
        e.stopPropagation();
        // 清空所有 partition 的 activeIds
        var ap2 = loadActivePartitions();
        for (var pk2 in ap2) {
            ap2[pk2].activeIds = [];
            savePartition(pk2, ap2[pk2]);
            syncActivePartitions(pk2, []);
        }
        clearKitDraft();
        fn.updateBtn(); renderBottomStatus(); fn.renderGrid(); closeDetailPanel();
        toast('已取消全部选择');
    });
}

// ── 选择详情面板 ─────────────────────────────────────────
export function buildDetailGroups() {
    var activeParts = loadActivePartitions();
    var groups = [];
    for (var pk in activeParts) {
        var ap = activeParts[pk];
        var ownerName;
        if (pk.indexOf('user:') === 0) ownerName = 'User';
        else if (pk === 'char:' + SHARED_CHAR_KEY) ownerName = '通用';
        else { var cid = pk.substring(5); ownerName = charNameById(cid) || cid; }

        var items = [];
        (ap.activeIds || []).forEach(function (id) {
            var o = partGetById(ap, id);
            if (o) items.push({ id: id, name: o.name, partKey: pk, outfit: o });
        });
        if (items.length > 0) groups.push({ owner: ownerName, partKey: pk, part: ap, items: items });
    }
    return groups;
}

export function refreshDetailPanel() {
    if (!SH.detailPanelOpen) return;
    var groups = buildDetailGroups();
    if (groups.length === 0) { closeDetailPanel(); return; }
    openDetailPanel(groups);
}

export function toggleDetailPanel() {
    if (SH.detailPanelOpen) { closeDetailPanel(); return; }
    var groups = buildDetailGroups();
    if (groups.length === 0) return;
    openDetailPanel(groups);
}

export function buildDetailSubjectTagHtml(w, focused) {
    var hasImg = !!(w.outfit && w.outfit.imageData);
    return '<span class="om-detail-tag om-subject-tag' + (focused ? ' focus' : '') + (hasImg ? ' has-img' : '') +
        '" data-focus-id="' + esc(w.id) + '" data-pk="' + esc(w.partKey) + '" data-id="' + esc(w.id) + '"' +
        (hasImg ? ' title="点击查看图片"' : '') + '>' +
        esc(w.name) +
        '<button type="button" class="om-detail-tag-x" data-id="' + esc(w.id) + '" data-pk="' + esc(w.partKey) + '" title="取消选择">&#x2715;</button>' +
        '</span>';
}

export function collectActiveImgOutfits(groups) {
    var list = [];
    var seen = {};
    (groups || []).forEach(function (g) {
        (g.items || []).forEach(function (w) {
            if (!w || !w.outfit || !w.outfit.imageData || seen[w.id]) return;
            seen[w.id] = true;
            list.push(w.outfit);
        });
    });
    return list;
}

export function openDetailPanel(groups) {
    closeDetailPanel();
    var bottombar = document.getElementById('om-bottombar');
    var box = document.querySelector('.om-box');
    if (!bottombar || !box) return;
    SH.detailPanelOpen = true;
    var panel = document.createElement('div');
    panel.id = 'om-detail-panel';
    panel.className = 'om-detail-panel';
    var bbH = bottombar.offsetHeight || 100;
    panel.style.cssText = 'position:absolute;left:0;right:0;bottom:' + bbH + 'px;z-index:36;max-height:min(52vh,460px);overflow-y:auto;';

    var html = '<div class="om-detail-handle"></div>';
    html += '<div class="om-detail-head-row"><span class="om-detail-head-title">已选穿搭</span>';
    html += '<span class="om-detail-head-hint">点名称看图 · 点套装可切换</span></div>';
    var curPK = currentPartKey();
    var allImgOutfits = collectActiveImgOutfits(groups);

    groups.forEach(function (g) {
        html += '<div class="om-detail-title" style="margin-top:6px">' + esc(g.owner) + '</div>';
        g.items.forEach(function (w) {
            ensureOutfitKits(w.outfit);
            var focused = isCurrentKitFocus(w.partKey, w.id);
            var useDraft = state.accMode && focused && w.partKey === curPK;
            var kits = (w.outfit.kits || []).slice();
            var kit = getWornKit(w.partKey,w.outfit);
            var accs = [];
            if (useDraft) {
                (state.kitDraftAccIds || []).forEach(function (aid) {
                    var draftAcc = partGetAccById(g.part, aid);
                    if (draftAcc) accs.push(draftAcc);
                });
            } else if (kit) {
                accs = getKitAccessories(g.part, kit);
            }

            var subjectTag = buildDetailSubjectTagHtml(w, focused);
            html += '<div class="om-detail-item' + (focused ? ' focus' : '') + '">';
            html += '<div class="om-detail-item-main">' + subjectTag + '</div>';

            // 已保存套装列表
            if (kits.length > 0) {
                html += '<div class="om-detail-kits">';
                kits.forEach(function (k) {
                    var isOn = kit && kit.id === k.id;
                    html += '<button type="button" class="om-detail-kit-chip' + (isOn ? ' on' : '') + '" data-kit-switch="1" data-pk="' + esc(w.partKey) + '" data-outfit-id="' + esc(w.id) + '" data-kit-id="' + esc(k.id) + '">' +
                        esc(k.name || '未命名套装') + (isOn ? ' · 当前' : '') + '</button>';
                });
                html += '</div>';
            }

            if (useDraft || accs.length > 0) {
                html += '<div class="om-kit-accs-scroll">';
                accs.forEach(function (acc) {
                    var chat=getChatState(),current=chat&&chat.current[w.partKey];var disabled=!useDraft&&((kit&&(kit.disabledAccIds||[]).includes(acc.id))||(current&&current.outfitId===w.id&&(current.hiddenAccIds||[]).includes(acc.id)));
                    html += '<button class="om-kit-acc-tag' + (disabled ? ' disabled' : '') + '" data-pk="' + esc(w.partKey) + '" data-outfit-id="' + esc(w.id) + '" data-acc-id="' + esc(acc.id) + '" data-draft="' + (useDraft ? '1' : '0') + '">' + esc(acc.name) + '</button>';
                });
                html += '</div>';
                if (useDraft) html += '<button class="om-kit-save" data-save-kit="1">保存套装</button>';
            } else if (kits.length === 0) {
                html += '<div class="om-detail-no-kit">暂无套装</div>';
            }
            html += '</div>';
        });
    });
    panel.innerHTML = html;
    box.appendChild(panel);

    // 取消选择
    panel.querySelectorAll('.om-detail-tag-x').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var id = btn.dataset.id;
            var pk = btn.dataset.pk;
            var targetPart = loadPartition(pk);
            var ai = (targetPart.activeIds || []).indexOf(id);
            if (ai !== -1) targetPart.activeIds.splice(ai, 1);
            if (isCurrentKitFocus(pk, id)) clearKitDraft();
            savePartition(pk, targetPart);
            syncActivePartitions(pk, targetPart.activeIds);
            fn.updateBtn(); renderBottomStatus(); fn.renderGrid();
            preResolveActiveImages();
            // 还有剩余则刷新面板，否则关闭
            var remaining = buildDetailGroups();
            if (remaining.length === 0) closeDetailPanel();
            else openDetailPanel(remaining);
        });
    });

    // 点击文字标签：有图则查看大图；单品模式下切套装焦点
    panel.querySelectorAll('.om-subject-tag').forEach(function (tag) {
        tag.addEventListener('click', function (e) {
            if (e.target.closest('.om-detail-tag-x')) return;
            var pk = tag.dataset.pk;
            var id = tag.dataset.focusId || tag.dataset.id;

            if (state.accMode) {
                if (pk !== currentPartKey()) { toast('只能为当前衣柜搭配单品', true); return; }
                if (setKitFocus(pk, id)) {
                    fn.renderGrid();
                    refreshDetailPanel();
                }
                return;
            }

            // 非单品模式：点击查看图片
            var outfit = null;
            for (var gi = 0; gi < groups.length; gi++) {
                for (var ii = 0; ii < groups[gi].items.length; ii++) {
                    if (groups[gi].items[ii].id === id) {
                        outfit = groups[gi].items[ii].outfit;
                        break;
                    }
                }
                if (outfit) break;
            }
            if (!outfit || !outfit.imageData) {
                toast('该穿搭没有图片', true);
                return;
            }
            if (typeof fn.openLightbox === 'function') {
                fn.openLightbox(allImgOutfits.length ? allImgOutfits : [outfit], outfit.id, { showSelect: true });
            }
        });
    });

    panel.querySelectorAll('.om-kit-acc-tag').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var accId = btn.dataset.accId;
            if (btn.dataset.draft === '1') fn.toggleDraftAcc(accId);
            else fn.outfitsInternalToggleDisabledAcc(btn.dataset.pk, btn.dataset.outfitId, accId);
        });
    });
    panel.querySelectorAll('[data-save-kit]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            fn.outfitsInternalSaveFocusedKitDraft();
        });
    });
    // 切换已保存套装
    panel.querySelectorAll('[data-kit-switch]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var pk = btn.dataset.pk;
            var oid = btn.dataset.outfitId;
            var kid = btn.dataset.kitId;
            var part = loadPartition(pk);
            var outfit = partGetById(part, oid);
            if (!outfit) return;
            ensureOutfitKits(outfit);
            if(getChatState())setCurrentOutfit(pk,oid,{kitId:kid,reason:'切换套装'});else{outfit.activeKitId = kid;savePartition(pk, part);}
            if (isCurrentKitFocus(pk, oid)) {
                // 同步草稿为该套装单品
                var kit = null;
                (outfit.kits || []).forEach(function (k) { if (k.id === kid) kit = k; });
                state.kitDraftAccIds = kit && Array.isArray(kit.accIds) ? kit.accIds.slice() : [];
            }
            toast('已切换套装');
            refreshDetailPanel();
            fn.renderGrid();
        });
    });
    setTimeout(function () {
        document.addEventListener('click', outsideDetailClick, true);
    }, 30);
}

export function outsideDetailClick(e) {
    var panel = document.getElementById('om-detail-panel');
    var statusEl = document.getElementById('om-bottom-status');
    var bottombar = document.getElementById('om-bottombar');
    if (!panel) return;
    // 点在 lightbox / 弹层 / 底栏 内时不关闭详情
    if (e.target.closest('#om-lightbox') || e.target.closest('#om-popup-slot')) return;
    if (panel.contains(e.target)) return;
    if (statusEl && statusEl.contains(e.target)) return;
    if (bottombar && bottombar.contains(e.target)) return;
    closeDetailPanel();
}

export function closeDetailPanel() {
    SH.detailPanelOpen = false;
    var p = document.getElementById('om-detail-panel'); if (p && p.parentNode) p.parentNode.removeChild(p);
    document.removeEventListener('click', outsideDetailClick, true);
}

fn.autoTagUntagged = autoTagUntagged;
fn.pushActionUndo = pushActionUndo;
fn.openActionUndoSheet = openActionUndoSheet;

// ── 重置界面状态 ─────────────────────────────
export function resetOutfitsUiState() {
    SH.detailPanelOpen = false;
}
