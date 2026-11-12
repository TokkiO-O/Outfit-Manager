// Outfit Manager · 二改版 | 单品分类、网格与套装编辑
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { batchToolbarHTML, bindBatchToolbar } from './batch-toolbar.js';
import { confirmCategoryChange } from './ui-api-confirm.js';
import { getChatIdentity, getChatState, getWornKit, updateChatCurrent } from './chat-state.js';
import { resolveAccessorySlots } from './slots.js';
import { isLocalImage, resolveLocalImageURL, peekLocalImageURL } from './db/local-images.js';
// 单品分类、网格、卡片操作与套装草稿

import {
    loadMeta,
    loadCurrent, saveCurrent,
    loadPartition, savePartition,
    currentPartKey,
    resolveImageForExternal, getImageUrlPrefix
} from './db/index.js';
// image resolve via outfits helpers if available
import {
    getCatNames, getSubCats, hasSubCats,
    partGetById, partGetAccById,
    getActiveKit, ensureOutfitKits, cleanAccIdFromKits
} from './data.js';
import { genId, esc, toast, uniqueIds } from './utils.js';
import { state, fn } from './bridge.js';
import { setupBatchSwipeSelect, pushActionUndo } from './ui-outfits/index.js';

var OM_TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export function clearKitDraft() {
    state.kitFocusPartKey = null;
    state.kitFocusOutfitId = null;
    state.kitDraftAccIds = [];
    state.kitDraftSourceKitId = null;
    state.kitDraftDirty = false;
}

export function isCurrentKitFocus(partKey, outfitId) {
    return state.kitFocusPartKey === partKey && state.kitFocusOutfitId === outfitId;
}

function getCurrentFocusContext() {
    if (!state.kitFocusPartKey || !state.kitFocusOutfitId) return null;
    var part = loadPartition(state.kitFocusPartKey);
    var outfit = partGetById(part, state.kitFocusOutfitId);
    if (!part || !outfit || (part.activeIds || []).indexOf(outfit.id) === -1) {
        clearKitDraft();
        return null;
    }
    ensureOutfitKits(outfit);
    return { partKey: state.kitFocusPartKey, part: part, outfit: outfit };
}

export function setKitFocus(partKey, outfitId) {
    var part = loadPartition(partKey);
    var outfit = partGetById(part, outfitId);
    if (!part || !outfit || (part.activeIds || []).indexOf(outfitId) === -1) return false;
    ensureOutfitKits(outfit);
    var kit = getWornKit(partKey,outfit);
    state.kitFocusPartKey = partKey;
    state.kitFocusOutfitId = outfitId;
    state.kitDraftAccIds = kit ? uniqueIds(kit.accIds || []) : [];
    state.kitDraftSourceKitId = kit ? kit.id : null;
    state.kitDraftDirty = false;
    return true;
}

export function ensureKitFocusForAccMode(showToast) {
    if (!state.accMode) return false;
    var pk = currentPartKey();
    var ctx = getCurrentFocusContext();
    if (ctx && ctx.partKey === pk) return true;

    clearKitDraft();
    var part = loadCurrent();
    var active = (part.activeIds || []).filter(function (id) { return !!partGetById(part, id); });
    if (active.length === 1) return setKitFocus(pk, active[0]);
    if (showToast) {
        toast(active.length === 0 ? '请先选择一套穿搭' : '当前衣柜有多套已选穿搭，请在底栏点一个主体', true);
    }
    return false;
}

export function draftHasAcc(accId) {
    if (state.kitFocusPartKey !== currentPartKey()) return false;
    return (state.kitDraftAccIds || []).indexOf(accId) !== -1;
}

export function toggleDraftAcc(accId) {
    if (!ensureKitFocusForAccMode(true)) {
        fn.outfitsInternalRefreshDetailPanel();
        return;
    }
    var ids = uniqueIds(state.kitDraftAccIds || []);
    var idx = ids.indexOf(accId);
    if (idx !== -1) ids.splice(idx, 1);
    else {
        ids.push(accId);
        var part = loadCurrent();
        var result = resolveAccessorySlots(ids.map(function (id) { return partGetAccById(part, id); }).filter(Boolean), loadMeta().slotRules);
        ids = result.items.map(function (item) { return item.id; });
        if (result.conflicts.length) toast('已替换同槽位的互斥单品');
    }
    state.kitDraftAccIds = ids;
    state.kitDraftDirty = true;
    fn.renderGrid();
    fn.outfitsInternalRefreshDetailPanel();
}

function nextKitName(kits) {
    var n = (kits || []).length + 1;
    var used = {};
    (kits || []).forEach(function (kit) { if (kit && kit.name) used[kit.name] = true; });
    while (used['套装' + n]) n++;
    return '套装' + n;
}

export function saveFocusedKitDraft() {
    if (!ensureKitFocusForAccMode(true)) return;
    var ctx = getCurrentFocusContext();
    if (!ctx || ctx.partKey !== currentPartKey()) { toast('请先在当前衣柜选择主体', true); return; }
    ensureOutfitKits(ctx.outfit);
    var draft = uniqueIds(state.kitDraftAccIds || []).filter(function (id) { return !!partGetAccById(ctx.part, id); });
    var kit = getWornKit(ctx.partKey,ctx.outfit);

    if (!kit) {
        if (draft.length === 0) { toast('请先选择单品', true); return; }
        var autoName = nextKitName(ctx.outfit.kits);
        var rawName = prompt('套装名称（留空自动命名）：', autoName);
        if (rawName === null) return;
        kit = { id: 'k_' + genId(), name: rawName.trim() || autoName, accIds: draft, disabledAccIds: [] };
        ctx.outfit.kits.push(kit);
        ctx.outfit.activeKitId = kit.id;
    } else {
        kit.accIds = draft;
        if (!Array.isArray(kit.disabledAccIds)) kit.disabledAccIds = [];
        kit.disabledAccIds = kit.disabledAccIds.filter(function (id) { return draft.indexOf(id) !== -1; });
    }

    ensureOutfitKits(ctx.outfit);
    savePartition(ctx.partKey, ctx.part);
    setKitFocus(ctx.partKey, ctx.outfit.id);
    state.kitDraftDirty = false;
    fn.renderGrid();
    fn.renderBottomStatus();
    fn.outfitsInternalRefreshDetailPanel();
    toast('已保存套装');
}

export function toggleDisabledAcc(partKey, outfitId, accId) {
    var part = loadPartition(partKey);
    var outfit = partGetById(part, outfitId);
    if (!part || !outfit) return;
    ensureOutfitKits(outfit);
    var kit = getActiveKit(outfit);
    if (!kit || (kit.accIds || []).indexOf(accId) === -1) return;
    var chat=getChatState(),current=chat&&chat.current[partKey];if(current&&current.outfitId===outfitId){var hidden=(current.hiddenAccIds||[]).slice(),at=hidden.indexOf(accId);if(at<0)hidden.push(accId);else hidden.splice(at,1);updateChatCurrent(partKey,{hiddenAccIds:hidden});fn.renderBottomStatus();fn.outfitsInternalRefreshDetailPanel();return;}
    if (!Array.isArray(kit.disabledAccIds)) kit.disabledAccIds = [];
    var idx = kit.disabledAccIds.indexOf(accId);
    if (idx !== -1) kit.disabledAccIds.splice(idx, 1);
    else kit.disabledAccIds.push(accId);
    ensureOutfitKits(outfit);
    savePartition(partKey, part);
    fn.renderBottomStatus();
    fn.outfitsInternalRefreshDetailPanel();
}

function batchDeleteAccessories(accIds) {
    accIds = uniqueIds(accIds || []);
    if (accIds.length === 0) { toast('请先选择单品', true); return; }
    if (!confirm('确定删除 ' + accIds.length + ' 个单品？引用它们的套装方案将自动更新。')) return;
    var part = loadCurrent();
    part.accessories = (part.accessories || []).filter(function (acc) {
        return accIds.indexOf(acc.id) === -1;
    });
    accIds.forEach(function (id) { cleanAccIdFromKits(part, id); });
    if (state.kitFocusPartKey === currentPartKey()) {
        state.kitDraftAccIds = (state.kitDraftAccIds || []).filter(function (id) { return accIds.indexOf(id) === -1; });
    }
    saveCurrent(part);
    state.batchSelected = [];
    state.batchMode = false;
    fn.accessoriesInternalUpdateBatchButtonState();
    fn.renderAccCatbar();
    fn.renderGrid();
    fn.renderBottomStatus();
    toast('已删除 ' + accIds.length + ' 个单品');
}

function openAccBatchCategorySheet(accIds) {
    var sourceKey=currentPartKey(),sourceChat=getChatIdentity();
    accIds = uniqueIds(accIds || []);
    if (accIds.length === 0) { toast('请先选择单品', true); return; }
    var part = loadCurrent();
    var cats = part.accCategories || [];
    var catNames = getCatNames(cats);
    if (catNames.length === 0) { toast('还没有单品分类，请先在设置中添加', true); return; }
    var itemsHtml = '';
    cats.forEach(function (catObj) {
        var catName = typeof catObj === 'object' ? catObj.name : catObj;
        var children = typeof catObj === 'object' ? (catObj.children || []) : [];
        var n = (part.accessories || []).filter(function (a) { return a.category === catName; }).length;
        itemsHtml += '<div class="om-cat-item om-acc-bcat-pick" data-cat="' + esc(catName) + '" data-sub="" style="cursor:pointer;font-weight:600"><span class="om-cat-name">' + esc(catName) + '</span><span class="om-cat-count">' + n + '件</span></div>';
        children.forEach(function (sc) {
            var sn = (part.accessories || []).filter(function (a) { return a.category === catName && a.subCategory === sc; }).length;
            itemsHtml += '<div class="om-cat-item om-acc-bcat-pick" data-cat="' + esc(catName) + '" data-sub="' + esc(sc) + '" style="cursor:pointer;padding-left:28px;opacity:.85"><span class="om-cat-name"><i class="fa-solid fa-turn-up fa-rotate-90" style="font-size:.6em;opacity:.3;margin-right:6px"></i>' + esc(sc) + '</span><span class="om-cat-count">' + sn + '件</span></div>';
        });
    });
    var sheet = fn.createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-folder"></i>选择单品分类</div>',
        '<div class="om-hint" style="margin-bottom:10px">为已选 ' + accIds.length + ' 件单品设置分类</div>',
        itemsHtml,
        '<div class="om-divider"></div>',
        '<div class="om-cat-item om-acc-bcat-pick" data-cat="" data-sub="" style="cursor:pointer;opacity:.6"><span class="om-cat-name">清除分类</span></div>',
    ].join(''));
    sheet.querySelectorAll('.om-acc-bcat-pick').forEach(function (item) {
        item.addEventListener('click', async function () {
            var targetCat = item.dataset.cat;
            var targetSub = item.dataset.sub;
            if(accIds.length>1&&!await confirmCategoryChange(accIds.length,targetCat+(targetSub?' / '+targetSub:''),'件单品'))return;
            if(currentPartKey()!==sourceKey||getChatIdentity()!==sourceChat){toast('聊天或衣柜已切换，请重新确认',true);return;}
            var p = loadCurrent();
            var undo=(p.accessories||[]).filter(function(acc){return accIds.includes(acc.id);}).map(function(acc){return {id:acc.id,prevCategory:acc.category||'',prevSubCategory:acc.subCategory||''};});
            (p.accessories || []).forEach(function (acc) {
                if (accIds.indexOf(acc.id) !== -1) {
                    acc.category = targetCat;
                    acc.subCategory = targetSub || '';
                }
            });
            saveCurrent(p);
            pushActionUndo({type:'batch_acc_cat',partKey:sourceKey,label:'手动修改 '+accIds.length+' 件单品分类',payload:{items:undo}});
            fn.closeSheet(sheet);
            state.batchSelected = [];
            fn.renderAccCatbar();
            fn.renderGrid();
            toast('已更新 ' + accIds.length + ' 件单品分类');
        });
    });
}

// ── 单品分类栏渲染 ─────────────────────────────────────────
export function renderAccCatbar() {
    var accbar = document.getElementById('om-acc-catbar'); if (!accbar) return;

    if (!state.accMode) {
        accbar.style.display = 'none';
        return;
    }

    var meta = loadMeta();
    if (meta.currentView === 'char' && !meta.currentChar) {
        accbar.style.display = 'none';
        return;
    }
    accbar.style.display = 'flex';

    var part = loadCurrent();
    var cats = part.accCategories || [];
    var catNames = getCatNames(cats);

    accbar.style.display = 'flex';
    accbar.style.flexDirection = 'column';
    accbar.style.alignItems = 'stretch';
    var activeParent = (state.accCat && state.accCat !== '__all__') ? state.accCat : null;
    if (state.accDrillParent) activeParent = state.accDrillParent;
    var subCats = activeParent && hasSubCats(cats, activeParent) ? getSubCats(cats, activeParent) : [];

    var html = '<div class="om-cat-row om-cat-row-main">';
    html += '<span class="om-acc-catbar-label"><i class="fa-solid fa-gem"></i></span>';
    html += '<button class="om-catbtn' + (state.accCat === '__all__' && !state.accDrillParent ? ' on' : '') + '" data-ac="__all__">全部</button>';
    catNames.forEach(function (c) {
        var hasSub = hasSubCats(cats, c);
        var on = (state.accCat === c || state.accDrillParent === c) ? ' on' : '';
        html += '<button class="om-catbtn' + on + (hasSub ? ' om-catbtn-parent' : '') + '" data-ac="' + esc(c) + '">' +
            esc(c) + (hasSub ? '<i class="fa-solid fa-caret-down om-cat-caret"></i>' : '') + '</button>';
    });
    html += '</div>';

    if (subCats.length) {
        html += '<div class="om-cat-row om-cat-row-sub">';
        html += '<button class="om-catbtn om-catbtn-sub' + (state.accSubCat === null ? ' on' : '') + '" data-asub="__all__">全部·' + esc(activeParent) + '</button>';
        subCats.forEach(function (sc) {
            html += '<button class="om-catbtn om-catbtn-sub' + (state.accSubCat === sc ? ' on' : '') + '" data-asub="' + esc(sc) + '">' + esc(sc) + '</button>';
        });
        html += '</div>';
    }
    accbar.innerHTML = html;
    if (fn.syncAccToggleBtn) fn.syncAccToggleBtn();

    accbar.querySelectorAll('.om-catbtn[data-ac]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var c = btn.dataset.ac;
            if (c === '__all__') {
                state.accCat = '__all__'; state.accDrillParent = null; state.accSubCat = null;
            } else {
                state.accCat = c;
                state.accDrillParent = hasSubCats(cats, c) ? c : null;
                state.accSubCat = null;
            }
            renderAccCatbar(); fn.renderGrid();
        });
    });
    accbar.querySelectorAll('.om-catbtn[data-asub]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var sub = btn.dataset.asub;
            state.accSubCat = (sub === '__all__') ? null : sub;
            if (activeParent) {
                state.accCat = activeParent;
                state.accDrillParent = activeParent;
            }
            renderAccCatbar(); fn.renderGrid();
        });
    });

    // 滚轮横向滚动
    if (!accbar._wheelBound) {
        accbar.addEventListener('wheel', function (e) {
            if (Math.abs(e.deltaY) > 0) { e.preventDefault(); accbar.scrollLeft += e.deltaY; }
        }, { passive: false });
        accbar._wheelBound = true;
    }
}

// ── 单品网格渲染 ────────────────────────────────────────
export function renderAccGrid(area, part) {
    var allAcc = part.accessories || [];

    // 按单品分类过滤
    var list;
    if (state.accDrillParent) {
        var parentCat = state.accDrillParent;
        var inParent = allAcc.filter(function (a) { return a.category === parentCat; });
        list = (state.accSubCat === null) ? inParent : inParent.filter(function (a) { return a.subCategory === state.accSubCat; });
    } else if (state.accCat === '__all__') {
        list = allAcc;
    } else {
        list = allAcc.filter(function (a) { return a.category === state.accCat; });
    }

    // 搜索过滤
    if (state.searchQuery) {
        var q = state.searchQuery.toLowerCase();
        list = list.filter(function (a) {
            return (a.name && a.name.toLowerCase().indexOf(q) !== -1) ||
                (a.category && a.category.toLowerCase().indexOf(q) !== -1) ||
                (a.description && a.description.toLowerCase().indexOf(q) !== -1);
        });
    }
    if (state.filterNoCat) {
        list = list.filter(function (a) { return !a.category || !a.category.trim(); });
    }
    if (state.filterNoDesc) {
        list = list.filter(function (a) { return !a.description || !a.description.trim(); });
    }

    var batchArea = document.getElementById('om-batch-area');
    if (batchArea) {
        if (state.batchMode) {
            batchArea.style.display = '';
            batchArea.innerHTML = batchToolbarHTML('accessory');
            bindBatchToolbar(batchArea, 'accessory');
        } else {
            batchArea.style.display = 'none';
            batchArea.innerHTML = '';
        }
    }

    var html = '<div class="om-grid">';
    if (!state.batchMode) {
        html += '<div class="om-add-card" id="om-acc-addcard"><i class="fa-solid fa-plus"></i><span>添加单品</span></div>';
    }

    if (list.length === 0) {
        var hasFilter = state.filterNoCat || state.filterNoDesc;
        var emptyMsg = state.searchQuery ? '没有匹配的单品'
            : hasFilter ? '没有符合筛选条件的单品'
            : (state.accCat !== '__all__' ? '该分类暂无单品' : '还没有单品，点击添加');
        html += '</div><div class="om-empty"><i class="fa-solid fa-gem"></i><span>' + emptyMsg + '</span></div>';
    } else {
        list.forEach(function (a) {
            var imgContent = '';
            var selected = !state.batchMode && draftHasAcc(a.id);
            var bsel = state.batchSelected.indexOf(a.id) !== -1;
            var checkBox = state.batchMode ? '<div class="om-card-check' + (bsel ? ' checked' : '') + '" data-acc-id="' + esc(a.id) + '"><i class="fa-solid fa-check"></i></div>' : '';
            if (a.imageData) {
                var accCached = isLocalImage(a.imageData) ? peekLocalImageURL(a.imageData) : (state.gridSrcCache && state.gridSrcCache['acc:' + a.id]) || (a.imageData.indexOf('data:image/') === 0 ? a.imageData : null);
                if (accCached) {
                    imgContent = '<img class="om-lazy-img om-loaded" src="' + String(accCached).replace(/"/g, '&quot;') + '" data-acc-id="' + esc(a.id) + '" alt="' + esc(a.name || '') + '" decoding="async" />';
                } else {
                    imgContent = '<img class="om-lazy-img" src="' + OM_TRANSPARENT_PIXEL + '" data-acc-id="' + esc(a.id) + '" alt="' + esc(a.name || '') + '" loading="lazy" decoding="async" />';
                }
            } else {
                var descPreview = (a.description && a.description.trim()) ? a.description.trim() : '';
                imgContent = '<div class="om-card-noimg">' +
                    '<div class="om-noimg-name">' + esc(a.name) + '</div>' +
                    (descPreview ? '<div class="om-noimg-desc">' + esc(descPreview) + '</div>' : '') +
                    '<i class="fa-solid fa-gem om-noimg-icon"></i>' +
                    '</div>';
            }
            var menuBtn = state.batchMode ? '' : '<button class="om-card-menu" data-acc-id="' + esc(a.id) + '" title="操作"><i class="fa-solid fa-ellipsis"></i></button>';
            html += '<div class="om-card' + (a.imageData ? '' : ' no-img') + (selected ? ' kit-selected' : '') + (bsel ? ' batch-sel' : '') + ' om-acc-card" data-acc-id="' + esc(a.id) + '">' +
                '<div class="om-card-img">' +
                checkBox + imgContent +
                (selected ? '<div class="om-badge-on om-kit-badge"><i class="fa-solid fa-check"></i></div>' : '') +
                menuBtn +
                '</div>' +
                '<div class="om-card-info">' +
                '<div class="om-card-name">' + esc(a.name) + '</div>' +
                '</div>' +
                '</div>';
        });
        html += '</div>';
    }

    area.innerHTML = html;

    // 单品懒加载
    setupAccLazyImages(area);

    if (state.batchMode && batchArea) {
        var selall = batchArea.querySelector('#om-acc-batch-selall');
        var selnone = batchArea.querySelector('#om-acc-batch-none');
        var catBtn = batchArea.querySelector('#om-acc-batch-cat');
        var moveBtn = batchArea.querySelector('#om-acc-batch-move');
        var delBtn = batchArea.querySelector('#om-acc-batch-del');
        var descBtn = batchArea.querySelector('#om-acc-batch-desc');
        if (selall) selall.addEventListener('click', function () {
            state.batchSelected = list.map(function (a) { return a.id; });
            fn.renderGrid();
        });
        if (selnone) selnone.addEventListener('click', function () {
            state.batchSelected = [];
            fn.renderGrid();
        });
        if (catBtn) catBtn.addEventListener('click', function () {
            openAccBatchCategorySheet(state.batchSelected.slice());
        });
        if (moveBtn) moveBtn.addEventListener('click', function () {
            if (state.batchSelected.length === 0) { toast('请先选择单品', true); return; }
            if (fn.openAccMoveToPanel) {
                fn.openAccMoveToPanel(state.batchSelected.slice(), function () {
                    state.batchSelected = [];
                    state.batchMode = false;
                    fn.accessoriesInternalUpdateBatchButtonState();
                    fn.renderAccCatbar();
                    fn.renderGrid();
                    fn.renderBottomStatus();
                });
            }
        });
        if (delBtn) delBtn.addEventListener('click', function () {
            batchDeleteAccessories(state.batchSelected.slice());
        });
        if (descBtn) descBtn.addEventListener('click', function () {
            var m = loadMeta();
            if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) {
                toast('请先在设置中配置"描述生成 API"', true); return;
            }
            var curP = loadCurrent();
            var ids = state.batchSelected.slice();
            if (ids.length === 0) {
                toast('请先勾选要生成描述的单品', true); return;
            }
            var hasImg = ids.some(function (id) { var acc = partGetAccById(curP, id); return acc && acc.imageData; });
            if (!hasImg) { toast('所选单品中没有带图片的', true); return; }
            if (fn.openAccBatchDescModal) fn.openAccBatchDescModal(ids);
        });
    }

    // 添加单品
    var ac = area.querySelector('#om-acc-addcard');
    if (ac) ac.addEventListener('click', function () {
        var defCat = state.accDrillParent || (state.accCat !== '__all__' ? state.accCat : '');
        fn.openAccEditSheet(null, defCat);
    });

    // 单品卡片点击 → 临时选择到当前主体草稿
    area.querySelectorAll('.om-acc-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
            if (e.target.closest('.om-card-menu')) return;
            var accId = card.dataset.accId;
            if (state.batchMode) {
                var idx = state.batchSelected.indexOf(accId);
                if (idx !== -1) state.batchSelected.splice(idx, 1); else state.batchSelected.push(accId);
                var chk = card.querySelector('.om-card-check');
                if (chk) chk.classList.toggle('checked', state.batchSelected.indexOf(accId) !== -1);
                card.classList.toggle('batch-sel', state.batchSelected.indexOf(accId) !== -1);
                var cnt = document.getElementById('om-batch-count');
                if (cnt) cnt.textContent = state.batchSelected.length;
                return;
            }
            toggleDraftAcc(accId);
        });
    });
    area.querySelectorAll('.om-card-check[data-acc-id]').forEach(function (chk) {
        chk.addEventListener('click', function (e) {
            e.stopPropagation();
            var accId = chk.dataset.accId;
            var idx = state.batchSelected.indexOf(accId);
            if (idx !== -1) state.batchSelected.splice(idx, 1); else state.batchSelected.push(accId);
            chk.classList.toggle('checked', state.batchSelected.indexOf(accId) !== -1);
            var card = chk.closest('.om-card');
            if (card) card.classList.toggle('batch-sel', state.batchSelected.indexOf(accId) !== -1);
            var cnt = document.getElementById('om-batch-count');
            if (cnt) cnt.textContent = state.batchSelected.length;
        });
    });

    if (state.batchMode) {
        // 与穿搭相同的框选/滑动多选
        setupBatchSwipeSelect(area, { idKey: 'accId' });
    }

    // 菜单按钮
    area.querySelectorAll('.om-card-menu[data-acc-id]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var accId = btn.dataset.accId;
            var acc = partGetAccById(loadCurrent(), accId);
            if (acc) fn.openAccContextMenu(acc);
        });
    });
}

// 单品图片懒加载
var ACC_IMG_CONCURRENCY = 4;
var accImgInFlight = 0;
var accImgQueue = [];
function pumpAccImgQueue() {
    while (accImgInFlight < ACC_IMG_CONCURRENCY && accImgQueue.length) {
        var task = accImgQueue.shift();
        accImgInFlight++;
        try {
            task(function () {
                accImgInFlight = Math.max(0, accImgInFlight - 1);
                pumpAccImgQueue();
            });
        } catch (e) {
            accImgInFlight = Math.max(0, accImgInFlight - 1);
            pumpAccImgQueue();
        }
    }
}
function setupAccLazyImages(area) {
    accImgQueue = [];
    accImgInFlight = 0;
    var imgs = area.querySelectorAll('img.om-lazy-img[data-acc-id]');
    if (!imgs.length) return;

    function loadImg(img) {
        if (!img || img.dataset.loaded === '1' || img.dataset.queued === '1') return;
        var id = img.getAttribute('data-acc-id');
        if (!id) return;
        img.dataset.queued = '1';
        accImgQueue.push(function (done) {
            if (!img.parentNode) { done(); return; }
            var part = loadCurrent();
            var a = partGetAccById(part, id);
            if (!a || !a.imageData) {
                img.dataset.loaded = '1';
                img.classList.add('om-loaded');
                done();
                return;
            }
            var src = a.imageData;
            function apply(url) {
                if (!img.parentNode) { done(); return; }
                img.dataset.loaded = '1';
                img.onload = function () { img.classList.add('om-loaded'); };
                img.onerror = function () { img.classList.add('om-loaded'); img.classList.add('om-img-error'); };
                if (url) {
                    if (!state.gridSrcCache) state.gridSrcCache = {};
                    state.gridSrcCache['acc:' + id] = url;
                    if (img.getAttribute('src') !== url) img.src = url;
                }
                img.classList.add('om-loaded');
                img.removeAttribute('data-acc-id');
                if (img.complete && img.naturalWidth) img.classList.add('om-loaded');
                done();
            }
            if (isLocalImage(src)) { resolveLocalImageURL(src).then(apply).catch(function(){apply('');}); return; }
            if (src.indexOf('data:image/') === 0 || src.indexOf('blob:') === 0) {
                apply(src);
                return;
            }
            if (typeof resolveImageForExternal === 'function') {
                resolveImageForExternal(src, function (url) { apply(url || src); });
            } else {
                apply(src);
            }
        });
        pumpAccImgQueue();
    }

    if (!('IntersectionObserver' in window)) {
        Array.prototype.slice.call(imgs, 0, 24).forEach(loadImg);
        return;
    }
    var obs = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            loadImg(entry.target);
            observer.unobserve(entry.target);
        });
    }, { root: area, rootMargin: '180px 0px', threshold: 0.01 });
    imgs.forEach(function (img) { obs.observe(img); });
    Array.prototype.slice.call(imgs, 0, 8).forEach(loadImg);
}
