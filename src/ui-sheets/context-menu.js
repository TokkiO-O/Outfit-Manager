// Outfit Manager · 二改版 | 穿搭的单条操作菜单
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getChatIdentity, setCurrentOutfit, addWardrobeCandidate } from '../chat-state.js';

import { generateSingleDescription } from '../api.js';
import { fn } from '../bridge.js';
import { SHARED_CHAR_KEY, partGetById, partIsActive } from '../data.js';
import { currentPartKey, loadCurrent, loadMeta, loadPartition, saveCurrent, savePartition, syncActivePartitions } from '../db/index.js';
import { patchOutfitCardActive } from '../ui-outfits/index.js';
import { esc, toast } from '../utils.js';
import { openEditSheet } from './edit-sheet.js';
import { openLightbox } from './lightbox.js';
import { closeSheet, createSheet } from './sheet-base.js';

export function openContextMenu(outfit, imgOutfits) {
    if (!outfit) return;
    var sourceChat = getChatIdentity(), sourcePart = currentPartKey();
    var part = loadCurrent();
    var isOn = partIsActive(part, outfit.id);

    var sheet = createSheet([
        '<div class="om-ctx-outfit-name"><i class="fa-solid fa-shirt" style="margin-right:6px;opacity:.5;"></i>' + esc(outfit.name) + '</div>',
        '<div class="om-ctx-item" id="om-ctx-wear"><i class="fa-solid fa-shirt"></i>穿这套</div>',
        '<div class="om-ctx-item" id="om-ctx-backup"><i class="fa-solid fa-layer-group"></i>加入备用衣柜</div>',
        '<div class="om-ctx-item" id="om-ctx-fav"><i class="fa-' + (outfit.favorite ? 'solid' : 'regular') + ' fa-star"></i>' + (outfit.favorite ? '取消收藏' : '收藏服装') + '</div>',
        outfit.imageData ? '<div class="om-ctx-item" id="om-ctx-view"><i class="fa-solid fa-expand"></i>查看大图</div>' : '',
        '<div class="om-ctx-item" id="om-ctx-edit"><i class="fa-solid fa-pen"></i>编辑</div>',
        '<div class="om-ctx-item" id="om-ctx-move"><i class="fa-solid fa-arrow-right-arrow-left"></i>移动到…</div>',
        outfit.imageData ? '<div class="om-ctx-item" id="om-ctx-aidesc"><i class="fa-solid fa-wand-magic-sparkles"></i>AI 生成描述</div>' : '',
        '<div class="om-ctx-item danger" id="om-ctx-del"><i class="fa-solid fa-trash"></i>删除</div>',
    ].join(''));

    sheet.querySelector('#om-ctx-wear').onclick = function () {
        closeSheet(sheet); if (sourceChat !== getChatIdentity() || sourcePart !== currentPartKey()) return;
        setCurrentOutfit(sourcePart, outfit.id); fn.updateBtn();
    };
    sheet.querySelector('#om-ctx-backup').onclick = function () {
        closeSheet(sheet); if (sourceChat !== getChatIdentity() || sourcePart !== currentPartKey()) return;
        addWardrobeCandidate(sourcePart, outfit.id); fn.updateBtn(); toast('已加入本次聊天的备用衣柜');
    };

    var favEl = sheet.querySelector('#om-ctx-fav');
    if (favEl) favEl.addEventListener('click', function () {
        closeSheet(sheet);
        var curP = loadCurrent();
        var o = partGetById(curP, outfit.id);
        if (!o) return;
        o.favorite = !o.favorite;
        saveCurrent(curP);
        fn.renderGrid();
        toast(o.favorite ? '已收藏：' + (o.name || '') : '已取消收藏');
    });

    var viewEl = sheet.querySelector('#om-ctx-view');
    if (viewEl) viewEl.addEventListener('click', function () {
        closeSheet(sheet);
        openLightbox(imgOutfits, outfit.id, { showSelect: true });
    });

    var editEl = sheet.querySelector('#om-ctx-edit');
    if (editEl) editEl.addEventListener('click', function () {
        closeSheet(sheet);
        openEditSheet(outfit, outfit.category || '');
    });

    var moveEl = sheet.querySelector('#om-ctx-move');
    if (moveEl) moveEl.addEventListener('click', function () {
        closeSheet(sheet);
        fn.openMoveToPanel([outfit.id], function () {
            fn.renderViewbar(); fn.renderCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn();
            fn.closeDetailPanel();
        });
    });

    var aidescEl = sheet.querySelector('#om-ctx-aidesc');
    if (aidescEl) aidescEl.addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) {
            toast('请先在设置中配置"描述生成 API"', true); closeSheet(sheet); return;
        }
        aidescEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>生成中...';
        aidescEl.style.pointerEvents = 'none';
        generateSingleDescription(outfit, function (err, result) {
            closeSheet(sheet);
            if (err) { toast('生成失败：' + err, true); return; }
            var curP = loadCurrent();
            var o = partGetById(curP, outfit.id);
            if (o) {
                if (result.description) o.description = result.description;
                if (result.name && result.name.trim()) o.name = result.name.trim();
                saveCurrent(curP);
            }
            toast('✅ 已生成：' + (o ? o.name : outfit.name));
            fn.renderGrid();
        });
    });

    var delEl = sheet.querySelector('#om-ctx-del');
    if (delEl) delEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (!confirm('确定删除「' + outfit.name + '」？')) return;
        var curP = loadCurrent();
        var removed = (curP.outfits || []).filter(function (o) { return o.id === outfit.id; });
        if (removed.length && fn.pushActionUndo) {
            fn.pushActionUndo({
                type: 'delete_outfits',
                label: '删除「' + (outfit.name || '') + '」',
                partKey: currentPartKey(),
                payload: { outfits: JSON.parse(JSON.stringify(removed)) }
            });
        }
        curP.outfits = curP.outfits.filter(function (o) { return o.id !== outfit.id; });
        var ai = (curP.activeIds || []).indexOf(outfit.id);
        if (ai !== -1) curP.activeIds.splice(ai, 1);
        saveCurrent(curP);
        syncActivePartitions(currentPartKey(), curP.activeIds);
        fn.updateBtn(); fn.renderBottomStatus(); fn.renderGrid(); toast('已删除（可撤销）');
    });
}

// ── 编辑 Bottom Sheet ─────────────────────────────────────
