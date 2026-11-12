// Outfit Manager · 二改版 | 图片查看与穿搭选用
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getChatIdentity } from '../chat-state.js';
import { hydrateLocalImages } from '../db/local-images.js';

import { fn } from '../bridge.js';
import { SHARED_CHAR_KEY, partIsActive } from '../data.js';
import { currentPartKey, loadCurrent, loadMeta, loadPartition, saveCurrent, savePartition, syncActivePartitions } from '../db/index.js';
import { esc, getPopupLayer, toast } from '../utils.js';

export function openLightbox(outfits, startId, options) {
    if (!outfits || outfits.length === 0) return;
    options = options || {};
    var sourceChat = getChatIdentity();
    var showSelect = !!options.showSelect;
    var idx = 0;
    for (var i = 0; i < outfits.length; i++) { if (outfits[i].id === startId) { idx = i; break; } }

    var existing = document.getElementById('om-lightbox');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var lb = document.createElement('div');
    lb.id = 'om-lightbox';
    lb.className = 'om-lightbox' + (showSelect ? ' om-lb-has-select' : '');
    lb.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2147483647 !important;pointer-events:auto !important;';

    function isOutfitActive(id) {
        try {
            var curP = loadCurrent();
            return partIsActive(curP, id);
        } catch (e) { return false; }
    }

    function applyCharMutexOnActivate() {
        var m = loadMeta();
        if (m.currentView !== 'char') return;
        if (m.currentChar === SHARED_CHAR_KEY) {
            (m.charIndex || []).forEach(function (ci) {
                if (ci.id !== SHARED_CHAR_KEY) {
                    var cp = loadPartition(ci.partKey);
                    if (cp.activeIds && cp.activeIds.length > 0) {
                        cp.activeIds = [];
                        savePartition(ci.partKey, cp);
                        syncActivePartitions(ci.partKey, []);
                    }
                }
            });
        } else {
            var sharedPK = 'char:' + SHARED_CHAR_KEY;
            var sp = loadPartition(sharedPK);
            if (sp.activeIds && sp.activeIds.length > 0) {
                sp.activeIds = [];
                savePartition(sharedPK, sp);
                syncActivePartitions(sharedPK, []);
            }
        }
    }

    function toggleSelectCurrent() {
        var o = outfits[idx];
        if (!o || !o.id) return;
        var targetPK = options.targetPartKey || currentPartKey();
        var curP = (options.targetPartKey ? loadPartition(options.targetPartKey) : loadCurrent());
        if (sourceChat !== getChatIdentity()) { toast('聊天已切换，请重新打开当前聊天的穿搭'); return; }
        var aids = (curP.activeIds || []).slice();
        var ai = aids.indexOf(o.id);
        if (ai !== -1) {
            aids.splice(ai, 1);
            toast('已取消：' + (o.name || ''));
        } else {
            if (options.replaceOnSelect) {
                aids = [o.id];
            } else {
                aids.push(o.id);
            }
            applyCharMutexOnActivate();
            toast(options.replaceOnSelect ? ('✅ 已换上：' + (o.name || '')) : ('✅ 已选：' + (o.name || '')));
            if (fn.recordWearHistory) fn.recordWearHistory(o);
        }
        curP.activeIds = aids;
        if (options.targetPartKey) savePartition(options.targetPartKey, curP);
        else saveCurrent(curP);
        syncActivePartitions(targetPK, aids);
        if (fn.updateBtn) fn.updateBtn();
        if (fn.renderBottomStatus) fn.renderBottomStatus();
        if (fn.renderGrid) fn.renderGrid();
        if (fn.preResolveActiveImages) fn.preResolveActiveImages();
        if (fn.outfitsInternalRefreshDetailPanel) fn.outfitsInternalRefreshDetailPanel();
        render();
    }

    function render() {
        var o = outfits[idx];
        var active = showSelect && o && isOutfitActive(o.id);
        var selectHtml = '';
        if (showSelect) {
            var selectLabel = active
                ? '<i class="fa-solid fa-circle-xmark"></i><span>取消选择</span>'
                : (options.replaceOnSelect
                    ? '<i class="fa-solid fa-shirt"></i><span>换上这套</span>'
                    : '<i class="fa-solid fa-circle-check"></i><span>选择这套</span>');
            selectHtml =
                '<div class="om-lb-footer">' +
                '<button type="button" class="om-lb-select' + (active ? ' on' : '') + '" id="om-lb-select">' +
                selectLabel +
                '</button>' +
                '</div>';
        }
        lb.innerHTML =
            '<button type="button" class="om-lb-close" id="om-lb-close" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>' +
            '<div class="om-lb-name">' + esc(o.name || '') + '</div>' +
            (outfits.length > 1 ? '<button type="button" class="om-lb-nav om-lb-prev" id="om-lb-prev" aria-label="上一张"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
            '<div class="om-lb-stage">' +
            '<img class="om-lb-img" src="' + (o.imageData || '') + '" draggable="false" alt="' + esc(o.name || '') + '" />' +
            '</div>' +
            (outfits.length > 1 ? '<button type="button" class="om-lb-nav om-lb-next" id="om-lb-next" aria-label="下一张"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
            (outfits.length > 1 ? '<div class="om-lb-counter">' + (idx + 1) + ' / ' + outfits.length + '</div>' : '') +
            selectHtml;
        hydrateLocalImages(lb);
        lb.querySelector('#om-lb-close').addEventListener('click', closeLb);
        var prev = lb.querySelector('#om-lb-prev'); var next = lb.querySelector('#om-lb-next');
        if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx - 1 + outfits.length) % outfits.length; render(); });
        if (next) next.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx + 1) % outfits.length; render(); });
        var selBtn = lb.querySelector('#om-lb-select');
        if (selBtn) selBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleSelectCurrent(); });
    }
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.classList.contains('om-lb-stage')) closeLb(); });
    function closeLb() { if (lb.parentNode) lb.parentNode.removeChild(lb); document.removeEventListener('keydown', keyH); }
    function keyH(e) {
        if (e.key === 'Escape') closeLb();
        else if (e.key === 'ArrowLeft' && outfits.length > 1) { idx = (idx - 1 + outfits.length) % outfits.length; render(); }
        else if (e.key === 'ArrowRight' && outfits.length > 1) { idx = (idx + 1) % outfits.length; render(); }
    }
    document.addEventListener('keydown', keyH);
    render();
    getPopupLayer().appendChild(lb);
    lb.style.setProperty('pointer-events', 'auto', 'important');
}

// ── 单品操作菜单 ─────────────────────────────────────────
