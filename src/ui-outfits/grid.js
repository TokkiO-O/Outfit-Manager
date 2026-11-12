// Outfit Manager · 二改版 | 穿搭网格、可见区域渲染与点选
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { batchToolbarHTML, bindBatchToolbar } from '../batch-toolbar.js';
import { confirmCategoryChange } from '../ui-api-confirm.js';
import { getChatIdentity, getChatState, selectChatOutfit } from '../chat-state.js';

import { fn, state } from '../bridge.js';
import { getCatNames, partGetById, partIsActive } from '../data.js';
import { currentPartKey, loadCurrent, loadMeta, saveCurrent, syncActivePartitions } from '../db/index.js';
import { esc, toast } from '../utils.js';
import { SH, OM_TRANSPARENT_PIXEL, clearKitDraft, isCurrentKitFocus, preResolveActiveImages } from './core.js';
import { openAutoClassifyModal, pushActionUndo, setupBatchSwipeSelect } from './classify.js';
import { refreshDetailPanel, renderBottomStatus } from './detail.js';
import { applyCharWardrobeMutex, getFilteredOutfits } from './filter.js';
import { recordWearHistory } from './history.js';
import { setupGridLazyImages } from './imgqueue.js';
import { pickThumbWidth } from './srccache.js';

// 选择变化只更新受影响卡片的状态，保留已解码的图片节点。
export function patchOutfitCardActive(outfitId, on) {
    var area = document.getElementById('om-grid-area');
    if (!area || !outfitId) return false;
    var cards = area.querySelectorAll('.om-card');
    for (var i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-id') !== outfitId) continue;
        var el = cards[i];
        el._omMarkup = null;
        el.classList.toggle('on', !!on);
        var badge = el.querySelector('.om-badge-on');
        if (on && !badge) {
            var imgBox = el.querySelector('.om-card-img');
            if (imgBox) {
                var b = document.createElement('div');
                b.className = 'om-badge-on';
                b.innerHTML = '<i class="fa-solid fa-check"></i>';
                imgBox.appendChild(b);
            }
        } else if (!on && badge && badge.parentNode) {
            badge.parentNode.removeChild(badge);
        }
        return true;
    }
    return false;
}

// 网格按可见区域渲染，控制大衣柜的卡片和图片节点数量。
export var VGRID = {
    area: null,
    grid: null,
    items: null,   // [{kind:'add'} | {kind:'outfit', o}]
    list: null,    // 纯穿搭数组（给事件绑定用）
    cols: 1,
    gap: 10,
    cardH: 180,
    rowH: 190,
    start: -1,
    end: -1,
    raf: 0,
    scrolling: false,
    scrollIdleTimer: 0,
    boundArea: null,
    ro: null,
    lastW: 0,
    pendingTop: null,
    metrics: null      // { key, cols, gap, cardH, rowH } 尺寸缓存
};

export function vgridCardHtml(o, part) {
    var chat = getChatState();
    var on = chat ? (chat.active[currentPartKey()] || []).indexOf(o.id) !== -1 : partIsActive(part, o.id);
    var worn = !!(chat && chat.current[currentPartKey()] && chat.current[currentPartKey()].outfitId === o.id);
    var bsel = state.batchSelected.indexOf(o.id) !== -1;
    var checkBox = state.batchMode ? '<div class="om-card-check' + (bsel ? ' checked' : '') + '" data-id="' + o.id + '"><i class="fa-solid fa-check"></i></div>' : '';
    var badge = (on && !state.batchMode) ? '<div class="om-badge-on"><i class="fa-solid fa-check"></i></div>' : '';

    var imgContent = '';
    if (o.imageData) {
        // ⚠ 绝对不要把 base64 拼进 innerHTML。
        // 实测（4x CPU 降速、17 张卡）：内联 913KB 的 base64 → innerHTML 46ms；
        // 用占位图 → 3ms。手机上一张 800px 图 base64 就有 300~500KB，
        // 17 张就是 5~8MB 的字符串要拼、要解析、要写进 DOM 属性，直接把重绘顶到 150ms。
        // 改成插入后用 JS 赋 src（见 setupGridLazyImages），浏览器照样命中已解码缓存，不会闪白。
        imgContent = '<img class="om-lazy-img" src="' + OM_TRANSPARENT_PIXEL + '" data-outfit-id="' + esc(o.id) + '" alt="' + esc(o.name || '') + '" loading="lazy" decoding="async" />';
    } else {
        var descPreview = (o.description && o.description.trim()) ? o.description.trim() : '';
        imgContent = '<div class="om-card-noimg">' +
            '<div class="om-noimg-name">' + esc(o.name) + '</div>' +
            (descPreview ? '<div class="om-noimg-desc">' + esc(descPreview) + '</div>' : '') +
            '<i class="fa-regular fa-file-lines om-noimg-icon"></i>' +
            '</div>';
    }

    var favMark = (!state.batchMode && o.favorite) ? '<div class="om-card-fav-mark" title="已收藏"><i class="fa-solid fa-star"></i></div>' : '';
    var menuBtn = state.batchMode ? '' : '<button class="om-card-menu" data-id="' + o.id + '" title="操作"><i class="fa-solid fa-ellipsis"></i></button>';
    var tagText = (o.sceneTag && o.sceneTag.trim()) ? o.sceneTag.trim() : '';
    return '<div class="om-card' + (on ? ' on' : '') + (bsel ? ' batch-sel' : '') + (o.imageData ? '' : ' no-img') + '" data-id="' + o.id + '">' +
        '<div class="om-card-img">' +
        checkBox + imgContent + favMark + badge + menuBtn +
        '</div>' +
        '<div class="om-card-info">' + (on && !state.batchMode ? '<span class="om-wear-label' + (worn ? ' current' : '') + '">' + (worn ? '当前' : '备用') + '</span>' : '') +
        '<div class="om-card-name">' + esc(o.name) + '</div>' +
        (tagText ? '<div class="om-card-tag">' + esc(tagText) + '</div>' : '') +
        '</div>' +
        '</div>';
}

export function vgridUnbind() {
    var V = VGRID;
    if (V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; }
    if (V.scrollIdleTimer) { clearTimeout(V.scrollIdleTimer); V.scrollIdleTimer = 0; }
    V.scrolling = false;
    if (V.boundArea) {
        V.boundArea.removeEventListener('scroll', vgridOnScroll);
        V.boundArea = null;
    }
    if (V.ro) { try { V.ro.disconnect(); } catch (eRo) {} V.ro = null; }
    V.area = null;
    V.grid = null;
    V.items = null;
    V.list = null;
    V.start = -1;
    V.end = -1;
    V.lastW = 0;
    V.pendingTop = null;
}

export function vgridOnScroll() {
    var V = VGRID;
    // 滚动期间关掉卡片过渡（见 base.js 的 .om-grid.om-scrolling），
    // 停下 120ms 后恢复，这样图片淡入不会因为快速滚动被跳过。
    if (V.grid && V.grid.isConnected) {
        if (!V.scrolling) {
            V.scrolling = true;
            V.grid.classList.add('om-scrolling');
        }
        if (V.scrollIdleTimer) clearTimeout(V.scrollIdleTimer);
        V.scrollIdleTimer = setTimeout(function () {
            V.scrollIdleTimer = 0;
            V.scrolling = false;
            if (V.grid) V.grid.classList.remove('om-scrolling');
        }, 120);
    }
    if (VGRID.raf) return;
    VGRID.raf = requestAnimationFrame(function () {
        VGRID.raf = 0;
        vgridRender(false);
    });
}

// 网格里一张卡实际需要多少物理像素。
// 只按「列宽 × DPR」算，取档时向上取整——算宽了最多多下几十 KB，
// 按显示宽度向上选取缩略图档位。
export function vgridThumbWidth(area) {
    if (!area) return 0;
    var w = area.clientWidth || 0;
    if (!w) return 0;
    var cols = VGRID.cols || 1;
    var gap = VGRID.gap || 10;
    var cardW = (w - (cols - 1) * gap) / cols;
    if (!isFinite(cardW) || cardW <= 0) return 0;
    return pickThumbWidth(cardW, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
}

export function vgridRender(force) {
    var V = VGRID;
    if (!V.area || !V.grid || !V.items) return;
    if (V.grid.isConnected === false) return;   // 网格已被别的渲染路径换掉
    var area = V.area, grid = V.grid;
    var part = loadCurrent();

    var viewH = area.clientHeight || 600;
    var total = V.items.length;
    var totalRows = Math.ceil(total / V.cols);
    var maxScroll = Math.max(0, totalRows * V.rowH - viewH + (V.gap));
    var st = (V.pendingTop != null) ? V.pendingTop : (area.scrollTop || 0);
    if (st > maxScroll) st = maxScroll;
    var firstRow = Math.max(0, Math.floor(st / V.rowH) - 1);
    var spanRows = Math.ceil(viewH / V.rowH) + 1;
    var lastRow = Math.min(totalRows, firstRow + spanRows + 2);
    if (!force && firstRow === V.start && lastRow === V.end) {
        if (V.pendingTop != null) { area.scrollTop = st; V.pendingTop = null; }
        return;
    }
    V.start = firstRow;
    V.end = lastRow;

    var from = firstRow * V.cols;
    var to = Math.min(total, lastRow * V.cols);
    var existing = new Map();
    Array.from(grid.children).forEach(function (card) { existing.set(card.dataset.id || '__add__', card); });
    var wanted = new Set(), cursor = grid.firstElementChild;
    var visList = [];
    for (var i = from; i < to; i++) {
        var it = V.items[i], id = it.kind === 'add' ? '__add__' : it.o.id;
        var markup = it.kind === 'add' ? '<div class="om-add-card" id="om-addcard"><i class="fa-solid fa-plus"></i><span>添加穿搭</span></div>' : vgridCardHtml(it.o, part);
        var card = existing.get(id);
        if (!card || card._omMarkup !== markup || (it.o && card._omImage !== it.o.imageData)) {
            var template = document.createElement('template'); template.innerHTML = markup;
            var replacement = template.content.firstElementChild;
            replacement._omMarkup = markup; replacement._omImage = it.o && it.o.imageData;
            if (card) {
                // Selection badges and labels can change without discarding the
                // decoded photo. This also avoids a transparent frame on mobile.
                if (it.o && card._omImage === it.o.imageData) {
                    var resident = card.querySelector('.om-lazy-img'), placeholder = replacement.querySelector('.om-lazy-img');
                    if (resident && placeholder) { resident.alt = it.o.name || ''; placeholder.replaceWith(resident); }
                }
                if (cursor === card) cursor = replacement;
                card.replaceWith(replacement);
            }
            card = replacement;
        }
        wanted.add(id);
        if (card !== cursor) grid.insertBefore(card, cursor);
        cursor = card.nextElementSibling;
        if (it.kind !== 'add') visList.push(it.o);
    }
    existing.forEach(function (card, id) { if (!wanted.has(id)) card.remove(); });

    grid.style.paddingTop = (firstRow * V.rowH) + 'px';
    grid.style.paddingBottom = ((totalRows - lastRow) * V.rowH) + 'px';
    if (V.pendingTop != null) {
        area.scrollTop = st;
        V.pendingTop = null;
    }

    setupGridLazyImages(area, visList, true, vgridThumbWidth(area));
    bindGridWindow(area);
}

export function vgridCols(area, grid) {
    var cs = window.getComputedStyle(grid);
    var gapRaw = cs.columnGap || cs.gap || '10px';
    var gap = parseFloat(gapRaw);
    if (!isFinite(gap) || gap < 0) gap = 10;
    VGRID.gap = gap;
    var tracks = (cs.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
    var cols = tracks.length;
    if (!cols || !isFinite(cols)) cols = 1;
    return Math.max(1, Math.min(cols, 12));
}

export function vgridMeasure(area, grid, force) {
    // 尺寸缓存：getComputedStyle 在「两万条 CSS 规则 + 四万节点」的页面上一次 6ms，
    // 而 renderGrid 会被筛选/分类/换装反复调用。宽度、列数、主题都没变就直接复用。
    var key = '';
    try {
        var meta = loadMeta();
        key = (area.clientWidth || 0) + '|' + (parseInt(meta.gridCols, 10) || 0) + '|' +
            (meta.uiTheme || '') + '|' + (meta.liteMode ? 1 : 0);
    } catch (eMeta) {
        key = 'x' + (area.clientWidth || 0);
    }
    if (!force && VGRID.metrics && VGRID.metrics.key === key) {
        VGRID.cols = VGRID.metrics.cols;
        VGRID.gap = VGRID.metrics.gap;
        VGRID.cardH = VGRID.metrics.cardH;
        VGRID.rowH = VGRID.metrics.rowH;
        grid.style.setProperty('--om-vrow', VGRID.cardH + 'px');
        grid.style.setProperty('--om-vgap', VGRID.gap + 'px');
        return true;   // 复用缓存，跳过测量和校准
    }

    var csA = window.getComputedStyle(area);
    var padL = parseFloat(csA.paddingLeft) || 0;
    var padR = parseFloat(csA.paddingRight) || 0;
    var contentW = Math.max(60, (area.clientWidth || 320) - padL - padR);
    VGRID.cols = vgridCols(area, grid);
    var cardW = Math.max(60, (contentW - VGRID.gap * (VGRID.cols - 1)) / VGRID.cols);
    // 卡片图区 aspect-ratio:3/4，信息条约 44px
    VGRID.cardH = Math.round(cardW * 4 / 3) + 44;
    VGRID.rowH = VGRID.cardH + VGRID.gap;
    grid.style.setProperty('--om-vrow', VGRID.cardH + 'px');
    grid.style.setProperty('--om-vgap', VGRID.gap + 'px');
    VGRID.metrics = { key: key, cols: VGRID.cols, gap: VGRID.gap, cardH: VGRID.cardH, rowH: VGRID.rowH };
    return false;
}

export function vgridMount(area, items, list) {
    var V = VGRID;
    var keepTop = area.scrollTop || 0;
    var previousGrid = area.querySelector('.om-grid.om-virt');
    if (previousGrid && previousGrid.dataset.part !== currentPartKey()) previousGrid = null;
    vgridUnbind();
    V.area = area;
    V.items = items;
    V.list = list;
    V.pendingTop = keepTop;
    V.lastW = area.clientWidth || 0;

    var grid = previousGrid || document.createElement('div');
    grid.className = 'om-grid om-virt';
    grid.dataset.part = currentPartKey();
    if (!previousGrid) { area.replaceChildren(grid); }
    V.grid = grid;

    var reused = vgridMeasure(area, grid);
    vgridRender(true);

    // 用真实卡片的「图宽 + 信息条高」校准一次（主题字号不同会让估算偏几像素）。
    // 尺寸是从缓存复用的话就不用再量，也不用再重绘一次。
    var probe = reused ? null : grid.querySelector('.om-card:not(.no-img)');
    if (probe) {
        var info = probe.querySelector('.om-card-info');
        var infoH = info ? info.offsetHeight : 0;
        var pw = probe.clientWidth || 0;
        if (pw > 40 && infoH > 0) {
            var realH = Math.round(pw * 4 / 3) + infoH;
            if (Math.abs(realH - V.cardH) > 2) {
                V.cardH = realH;
                V.rowH = realH + V.gap;
                grid.style.setProperty('--om-vrow', realH + 'px');
                if (V.metrics) { V.metrics.cardH = realH; V.metrics.rowH = V.rowH; }
                vgridRender(true);
            }
        }
    }

    V.boundArea = area;
    area.addEventListener('scroll', vgridOnScroll, { passive: true });

    if ('ResizeObserver' in window && !V.ro) {
        V.ro = new ResizeObserver(function () {
            var w = area.clientWidth || 0;
            if (!V.area || Math.abs(w - V.lastW) < 8) return;
            V.lastW = w;
            if (V.raf) return;
            V.raf = requestAnimationFrame(function () {
                V.raf = 0;
                if (!V.grid) return;
                vgridMeasure(area, V.grid);
                V.start = -1;
                vgridRender(true);
            });
        });
        try { V.ro.observe(area); } catch (eObs) {}
    }
}

// 保留重叠窗口内的卡片和图片，仅为新增节点绑定一次。
export function bindGridWindow(area) {
    var ac = area.querySelector('#om-addcard');
    if (ac && !ac._omGridBound) { ac._omGridBound = true; ac.addEventListener('click', function () {
        var defCat = state.catDrillParent || (state.curCat !== '__all__' ? state.curCat : '');
        var defSub = state.catDrillParent && state.curSubCat ? state.curSubCat : '';
        fn.openEditSheet(null, defCat, defSub);
    }); }

    if (state.batchMode) {
        // 多选勾选统一由滑动/点选逻辑处理，避免滚动松手触发 click 误取消
        setupBatchSwipeSelect(area);
        return;
    }

    area.querySelectorAll('.om-card').forEach(function (card) {
        if (card._omGridBound) return;
        card._omGridBound = true;
        var id = card.dataset.id;
        var clickTimer = null;

        function doToggleSelect() {
            var curP = loadCurrent();
            if (!selectChatOutfit(currentPartKey(), id)) { toast('请先打开一段聊天，再选择当前穿搭'); return; }
            var worn = partGetById(curP, id); if (worn && partIsActive(loadCurrent(), id)) recordWearHistory(worn);
            fn.updateBtn(); renderBottomStatus(); preResolveActiveImages();
            // Paint from this chat's state; cached markup must match the actual DOM.
            if (fn.requestWardrobeRefresh) fn.requestWardrobeRefresh(currentPartKey());
            if (SH.detailPanelOpen) refreshDetailPanel();
        }

        card.addEventListener('click', function (e) {
            if (e.target.closest('.om-card-menu')) return;
            if (e.detail > 1) return;
            if (clickTimer) clearTimeout(clickTimer);
            var sourceChat = getChatIdentity(), sourcePart = currentPartKey();
            clickTimer = setTimeout(function () {
                clickTimer = null;
                if (sourceChat !== getChatIdentity() || sourcePart !== currentPartKey() || state.batchMode || !card.isConnected) return;
                doToggleSelect();
            }, 280);
        });

        card.addEventListener('dblclick', function (e) {
            if (e.target.closest('.om-card-menu')) return;
            e.preventDefault();
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            var o = partGetById(loadCurrent(), id);
            if (!o || !o.imageData) {
                toast('该穿搭没有图片', true);
                return;
            }
            if (typeof fn.openLightbox === 'function') {
                var imgOutfits = VGRID.list ? VGRID.list.filter(function (entry) { return !!entry.imageData; }) : [];
                fn.openLightbox(imgOutfits.length ? imgOutfits : [o], o.id, { showSelect: true });
            }
        });
    });

    area.querySelectorAll('.om-card-menu').forEach(function (btn) {
        if (btn._omGridBound) return;
        btn._omGridBound = true;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var id = btn.dataset.id;
            var o = partGetById(loadCurrent(), id);
            var imgOutfits = VGRID.list ? VGRID.list.filter(function (entry) { return !!entry.imageData; }) : [];
            fn.openContextMenu(o, imgOutfits);
        });
    });
}

export function renderOutfitGrid(area, part) {
    var list = getFilteredOutfits(part);

    // 批量操作栏
    var batchArea = document.getElementById('om-batch-area');
    if (batchArea) {
        if (state.batchMode) {
            batchArea.style.display = '';
            batchArea.innerHTML = batchToolbarHTML('outfit');
            bindBatchToolbar(batchArea, 'outfit');
        } else {
            batchArea.style.display = 'none';
            batchArea.innerHTML = '';
        }
    }

    if (list.length === 0) {
        var hasFilter = state.filterNoCat || state.filterNoTag || state.filterNoDesc;
        var emptyMsg = state.searchQuery ? '没有匹配「' + esc(state.searchQuery) + '」的穿搭'
            : hasFilter ? '没有符合筛选条件的穿搭'
            : (state.curCat !== '__all__' ? '该分类暂无穿搭' : '还没有穿搭，点击左上角添加');
        vgridUnbind();
        area.innerHTML = '<div class="om-empty"><i class="fa-solid fa-shirt"></i><span>' + emptyMsg + '</span></div>';
    } else {
        var items = [];
        if (!state.batchMode) items.push({ kind: 'add' });
        for (var vi = 0; vi < list.length; vi++) items.push({ kind: 'outfit', o: list[vi] });
        if (!area.clientWidth) {
            // 弹窗还没显示（宽度为 0），只铺前 60 张占位，
            // 等界面可见后 openPopup 会再调一次 renderGrid 走虚拟滚动。
            vgridUnbind();
            var flat = '';
            var lim = Math.min(items.length, 60);
            for (var fi = 0; fi < lim; fi++) {
                flat += items[fi].kind === 'add'
                    ? '<div class="om-add-card" id="om-addcard"><i class="fa-solid fa-plus"></i><span>添加穿搭</span></div>'
                    : vgridCardHtml(items[fi].o, part);
            }
            area.innerHTML = '<div class="om-grid">' + flat + '</div>';
            VGRID.list = list;
            setupGridLazyImages(area, list, false, vgridThumbWidth(area));
            bindGridWindow(area);
        } else {
            vgridMount(area, items, list);
        }
    }

    // 批量操作
    if (state.batchMode) {
        var selall = batchArea.querySelector('#om-batch-selall');
        var selnone = batchArea.querySelector('#om-batch-none');
        var btagBtn = batchArea.querySelector('#om-batch-tag');
        var bdelBtn = batchArea.querySelector('#om-batch-del');

        if (selall) selall.addEventListener('click', function () { state.batchSelected = list.map(function (o) { return o.id; }); fn.renderGrid(); });
        if (selnone) selnone.addEventListener('click', function () { state.batchSelected = []; fn.renderGrid(); });
        var bcatBtn = batchArea.querySelector('#om-batch-cat');
        if (bcatBtn) bcatBtn.addEventListener('click', function () {
            if (state.batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
            var curPart = loadCurrent();
            var cats = curPart.categories || [];
            var catNames = getCatNames(cats);
            if (catNames.length === 0) { toast('还没有分类，请先在设置中添加', true); return; }
            var expandedCats = {};
            function buildBatchCategoryList() {
                var itemsHtml = '';
                cats.forEach(function (catObj, catIdx) {
                    var catName = typeof catObj === 'object' ? catObj.name : catObj;
                    var children = typeof catObj === 'object' ? (catObj.children || []) : [];
                    var n = curPart.outfits.filter(function (o) { return o.category === catName; }).length;
                    var isExpanded = !!expandedCats[catIdx];
                    var chevron = children.length > 0
                        ? '<i class="fa-solid fa-chevron-' + (isExpanded ? 'down' : 'right') + ' om-cat-chevron"></i>'
                        : '<span class="om-cat-chevron-placeholder"></span>';
                    itemsHtml += '<div class="om-cat-item om-bcat-parent" data-idx="' + catIdx + '" data-cat="' + esc(catName) + '" style="cursor:pointer;font-weight:600">' +
                        chevron + '<span class="om-cat-name">' + esc(catName) + '</span><span class="om-cat-count">' + n + '套</span>' +
                        '<button class="om-btn-sm om-bcat-parent-pick" data-cat="' + esc(catName) + '" title="选择父分类"><i class="fa-solid fa-check"></i></button></div>';
                    if (isExpanded) {
                        children.forEach(function (sc) {
                            var sn = curPart.outfits.filter(function (o) { return o.category === catName && o.subCategory === sc; }).length;
                            itemsHtml += '<div class="om-cat-item om-bcat-pick om-cat-child" data-cat="' + esc(catName) + '" data-sub="' + esc(sc) + '" style="cursor:pointer;padding-left:32px;opacity:.85"><span class="om-cat-name"><i class="fa-solid fa-turn-up fa-rotate-90" style="font-size:.6em;opacity:.3;margin-right:6px"></i>' + esc(sc) + '</span><span class="om-cat-count">' + sn + '套</span></div>';
                        });
                    }
                });
                return itemsHtml;
            }
            var catSheet = fn.createSheet([
                '<div class="om-sheet-title"><i class="fa-solid fa-folder"></i>选择分类</div>',
                '<div class="om-hint" style="margin-bottom:10px">为已选 ' + state.batchSelected.length + ' 套穿搭设置分类</div>',
                '<div id="om-bcat-list">' + buildBatchCategoryList() + '</div>',
                '<div class="om-divider"></div>',
                '<div class="om-cat-item" id="om-bcat-auto" style="cursor:pointer"><span class="om-cat-name"><i class="fa-solid fa-wand-magic-sparkles" style="opacity:.55;margin-right:7px"></i>图片自动分类 · API</span><span class="om-cat-count">可新建</span></div>',
                '<div class="om-cat-item" id="om-bcat-clear" style="cursor:pointer;opacity:.6"><span class="om-cat-name">清除分类</span></div>',
            ].join(''));
            function bindBatchCategoryList() {
                var listEl = catSheet.querySelector('#om-bcat-list');
                if (!listEl) return;
                listEl.innerHTML = buildBatchCategoryList();
                listEl.querySelectorAll('.om-bcat-parent').forEach(function (row) {
                    row.addEventListener('click', function () {
                        var idx = parseInt(row.dataset.idx);
                        var catObj = cats[idx];
                        var children = typeof catObj === 'object' ? (catObj.children || []) : [];
                        if (children.length > 0) {
                            expandedCats[idx] = !expandedCats[idx];
                            bindBatchCategoryList();
                            return;
                        }
                        applyBatchCategory(row.dataset.cat, '');
                    });
                });
                listEl.querySelectorAll('.om-bcat-parent-pick').forEach(function (btn) {
                    btn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        applyBatchCategory(btn.dataset.cat, '');
                    });
                });
                listEl.querySelectorAll('.om-bcat-pick').forEach(function (item) {
                    item.addEventListener('click', function () {
                        applyBatchCategory(item.dataset.cat, item.dataset.sub || '');
                    });
                });
            }
            async function applyBatchCategory(targetCat, targetSub) {
                var ids=state.batchSelected.slice(),sourceKey=currentPartKey(),sourceChat=getChatIdentity();
                if(ids.length>1&&!await confirmCategoryChange(ids.length,targetCat+(targetSub?' / '+targetSub:''),'套穿搭'))return;
                if(currentPartKey()!==sourceKey||getChatIdentity()!==sourceChat){toast('聊天或衣柜已切换，请重新确认',true);return;}
                var p2 = loadCurrent();
                var undo=p2.outfits.filter(function(o){return ids.includes(o.id);}).map(function(o){return {id:o.id,prevCategory:o.category||'',prevSubCategory:o.subCategory||''};});
                p2.outfits.forEach(function (o) {
                    if (ids.indexOf(o.id) !== -1) {
                        o.category = targetCat;
                        o.subCategory = targetSub || '';
                    }
                });
                saveCurrent(p2); fn.closeSheet(catSheet);
                pushActionUndo({type:'batch_cat',partKey:sourceKey,label:'手动修改 '+ids.length+' 套分类',payload:{items:undo}});
                var label = targetCat ? (targetSub ? '「' + targetCat + ' > ' + targetSub + '」' : '「' + targetCat + '」') : '清除分类';
                toast('✅ 已将 ' + state.batchSelected.length + ' 套' + (targetCat ? '移到' + label : label));
                state.batchSelected = []; fn.renderGrid();
            }
            var autoCatBtn = catSheet.querySelector('#om-bcat-auto');
            if (autoCatBtn) autoCatBtn.addEventListener('click', function () {
                var ids = state.batchSelected.slice();
                fn.closeSheet(catSheet);
                openAutoClassifyModal(ids);
            });
            bindBatchCategoryList();
            var clearCatBtn = catSheet.querySelector('#om-bcat-clear');
            if (clearCatBtn) clearCatBtn.addEventListener('click', function () { applyBatchCategory('', ''); });
        });
        if (btagBtn) btagBtn.addEventListener('click', function () {
            if (state.batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
            fn.openBatchTagPanel(state.batchSelected.slice(), function () {
                state.batchSelected = []; fn.renderGrid();
            });
        });
        var bmoveBtn = batchArea.querySelector('#om-batch-move');
        if (bmoveBtn) bmoveBtn.addEventListener('click', function () {
            if (state.batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
            fn.openMoveToPanel(state.batchSelected.slice(), function () {
                state.batchSelected = []; state.batchMode = false;
                fn.renderViewbar(); fn.renderCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn();
            });
        });
        if (bdelBtn) bdelBtn.addEventListener('click', function () {
            if (state.batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
            if (!confirm('确定删除已选 ' + state.batchSelected.length + ' 套穿搭？')) return;
            if (state.kitFocusPartKey === currentPartKey() && state.batchSelected.indexOf(state.kitFocusOutfitId) !== -1) clearKitDraft();
            var curP = loadCurrent();
            var removed = (curP.outfits || []).filter(function (o) { return state.batchSelected.indexOf(o.id) !== -1; });
            if (removed.length && typeof pushActionUndo === 'function') {
                pushActionUndo({
                    type: 'delete_outfits',
                    label: '删除 ' + removed.length + ' 套',
                    partKey: currentPartKey(),
                    payload: { outfits: JSON.parse(JSON.stringify(removed)) }
                });
            }
            curP.outfits = curP.outfits.filter(function (o) { return state.batchSelected.indexOf(o.id) === -1; });
            curP.activeIds = (curP.activeIds || []).filter(function (id) { return state.batchSelected.indexOf(id) === -1; });
            saveCurrent(curP);
            syncActivePartitions(currentPartKey(), curP.activeIds);
            fn.updateBtn(); renderBottomStatus(); toast('已删除 ' + state.batchSelected.length + ' 套（可在更多→操作撤销恢复）'); state.batchSelected = []; fn.renderGrid();
        });

        var baidescBtn = batchArea.querySelector('#om-batch-aidesc');
        if (baidescBtn) baidescBtn.addEventListener('click', function () {
            if (state.batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
            var m = loadMeta();
            if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) {
                toast('请先在设置中配置"描述生成 API"', true); return;
            }
            var curP = loadCurrent();
            var hasImg = state.batchSelected.some(function (id) { var o = partGetById(curP, id); return o && o.imageData; });
            if (!hasImg) { toast('所选穿搭中没有带图片的', true); return; }
            fn.openBatchDescModal(state.batchSelected.slice());
        });

        var bexportBtn = batchArea.querySelector('#om-batch-export');
        if (bexportBtn) bexportBtn.addEventListener('click', function () {
            if (state.batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
            var curP = loadCurrent();
            var selected = (curP.outfits || []).filter(function (o) {
                return state.batchSelected.indexOf(o.id) !== -1;
            });
            if (!selected.length) { toast('未找到选中穿搭', true); return; }
            if (fn.exportSelectedOutfits) fn.exportSelectedOutfits(state.batchSelected.slice());
        });

        // 多选勾选统一由滑动/点选逻辑处理，避免滚动松手触发 click 误取消
        setupBatchSwipeSelect(area);
    }
}

// ── 断开网格图片观察器 ───────────────────────
export function disconnectOutfitGridObserver() {
    if (SH.gridImageObserver) { SH.gridImageObserver.disconnect(); SH.gridImageObserver = null; }
    vgridUnbind();
}
