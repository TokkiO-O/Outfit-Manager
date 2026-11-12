// Outfit Manager · 二改版 | 图片分类、标签入口与操作记录
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { openTagReview } from '../ui-tag-review.js';

import { batchClassifyOutfits } from '../api.js';
import { fn, state } from '../bridge.js';
import { partGetById, partGetAccById } from '../data.js';
import { currentPartKey, loadCurrent, loadMeta, loadPartition, saveCurrent, savePartition } from '../db/index.js';
import { esc, getPopupLayer, toast, uniqueIds } from '../utils.js';
import { SCENE_FILL_BY, inferSceneTagsDetailed, openUncertainTagPicker } from './autotag.js';
import { renderBottomStatus } from './detail.js';
import { createSheet, closeSheet } from '../ui-sheets/sheet-base.js';
import { confirmApiBatch } from '../ui-api-confirm.js';
import { ensurePartitionLoaded } from '../db/index.js';
import { getChatIdentity } from '../chat-state.js';
var activeClassification = null;

// ── 通用操作撤销栈 ──────────────────────────────────────
export function pushActionUndo(entry) {
    try {
        if (!state.actionUndoStack) state.actionUndoStack = [];
        entry = entry || {};
        entry.id = entry.id || ('u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
        entry.ts = entry.ts || Date.now();
        state.actionUndoStack.unshift(entry);
        if (state.actionUndoStack.length > 30) state.actionUndoStack.length = 30;
    } catch (e) {}
}

export { openActionUndoSheet } from '../ui-sheets/undo.js';

export function autoTagUntagged() { return openTagReview(); }

export function classifyAllUncategorized() {
    var part = loadCurrent();
    var ids = (part.outfits || []).filter(function (o) {
        return o && o.imageData && (!o.category || !String(o.category).trim());
    }).map(function (o) { return o.id; });
    if (ids.length === 0) {
        toast('没有未分类且带图片的穿搭', true);
        return;
    }
    openAutoClassifyModal(ids);
}

// ── 低置信度确认 ────────────────────────────────────────
export function showConfidenceReviewModal(items, partKey) {
    if (!items || !items.length) return;
    var _mp = getPopupLayer();
    var modal = document.createElement('div');
    modal.className = 'om-modal';
    modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:4 !important;pointer-events:auto !important;';
    var rows = items.map(function (it, i) {
        var confPct = Math.round((it.confidence || 0) * 100);
        return '<div class="om-review-row" data-idx="' + i + '">' +
            '<div class="om-review-main"><b>' + esc(it.name) + '</b>' +
            '<span class="om-review-conf">置信度 ' + confPct + '%</span></div>' +
            '<div class="om-review-path">' + esc((it.category || '') + (it.subCategory ? ' / ' + it.subCategory : '')) + '</div>' +
            '<div class="om-review-acts">' +
            '<button type="button" class="om-btn-sm om-review-ok" data-idx="' + i + '">保留</button>' +
            '<button type="button" class="om-btn-sm om-review-clear" data-idx="' + i + '">清除分类</button>' +
            '</div></div>';
    }).join('');
    modal.innerHTML = '<div class="om-modal-box om-result-box" style="max-width:460px">' +
        '<div class="om-result-badge" style="color:#ffb74d"><i class="fa-solid fa-triangle-exclamation"></i> 低置信度确认</div>' +
        '<div class="om-hint">以下 ' + items.length + ' 套分类置信度较低，请确认或清除</div>' +
        '<div class="om-review-list">' + rows + '</div>' +
        '<div class="om-btn-row" style="margin-top:12px;justify-content:flex-end">' +
        '<button class="om-btn om-btn-outline" id="om-review-all-ok">全部保留</button>' +
        '<button class="om-btn om-btn-safe" id="om-review-done">完成</button></div></div>';
    _mp.appendChild(modal);
    var pending = items.slice();
    function close() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
    function clearCat(idx) {
        var it = pending[idx];
        if (!it || it._done) return;
        var cp = loadPartition(partKey || currentPartKey());
        var o = partGetById(cp, it.id);
        if (o) { o.category = ''; o.subCategory = ''; savePartition(partKey || currentPartKey(), cp); }
        it._done = true;
        var row = modal.querySelector('.om-review-row[data-idx="' + idx + '"]');
        if (row) row.style.opacity = '0.35';
    }
    function keep(idx) {
        var it = pending[idx];
        if (!it) return;
        it._done = true;
        var row = modal.querySelector('.om-review-row[data-idx="' + idx + '"]');
        if (row) row.style.opacity = '0.35';
    }
    modal.querySelectorAll('.om-review-ok').forEach(function (btn) {
        btn.addEventListener('click', function () { keep(parseInt(btn.dataset.idx, 10)); });
    });
    modal.querySelectorAll('.om-review-clear').forEach(function (btn) {
        btn.addEventListener('click', function () { clearCat(parseInt(btn.dataset.idx, 10)); });
    });
    modal.querySelector('#om-review-all-ok').addEventListener('click', function () {
        pending.forEach(function (_, i) { keep(i); });
        close();
        fn.renderCatbar(); fn.renderGrid();
        toast('已全部保留');
    });
    modal.querySelector('#om-review-done').addEventListener('click', function () {
        close();
        fn.renderCatbar(); fn.renderGrid();
        toast('确认完成');
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
}

export function showAutoClassifyResultModal(err, doneCount, errors, extra) {
    extra = extra || {};
    var failCount = errors ? errors.length : 0;
    var successCount = Math.max(0, (doneCount || 0) - failCount);
    var created = extra.createdCategories || [];
    var assigned = extra.assigned || [];

    var _mp = getPopupLayer();
    var modal = document.createElement('div');
    modal.className = 'om-modal om-result-modal';
    modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:3 !important;pointer-events:auto !important;';

    var summaryHtml = err
        ? '<div class="om-result-badge bad"><i class="fa-solid fa-circle-exclamation"></i> 分类失败</div>' +
          '<div class="om-result-summary">' + esc(err) + '</div>'
        : '<div class="om-result-badge ok"><i class="fa-solid fa-circle-check"></i> 自动分类完成</div>' +
          '<div class="om-result-stats">' +
          '<div class="om-result-stat"><b>' + successCount + '</b><span>成功</span></div>' +
          '<div class="om-result-stat"><b>' + failCount + '</b><span>失败</span></div>' +
          '<div class="om-result-stat"><b>' + created.length + '</b><span>新建分类</span></div>' +
          '</div>';

    var createdHtml = '';
    if (created.length) {
        createdHtml = '<div class="om-result-section"><div class="om-result-sec-title">新建分类</div><div class="om-result-tags">' +
            created.map(function (c) { return '<span class="om-result-tag new">' + esc(c) + '</span>'; }).join('') +
            '</div></div>';
    }

    var listHtml = '';
    if (assigned.length) {
        var rows = assigned.slice(0, 40).map(function (a) {
            var path = (a.category || '未分类') + (a.subCategory ? ' / ' + a.subCategory : '');
            return '<div class="om-result-row" data-id="' + esc(a.id || '') + '">' +
                '<span class="om-result-row-name">' + esc(a.name) + '</span>' +
                '<span class="om-result-row-path">' + esc(path) + (a.isNew ? ' <em>新</em>' : '') + '</span></div>';
        }).join('');
        if (assigned.length > 40) {
            rows += '<div class="om-hint" style="margin-top:6px">… 还有 ' + (assigned.length - 40) + ' 条</div>';
        }
        listHtml = '<div class="om-result-section"><div class="om-result-sec-title">分类明细</div><div class="om-result-list">' + rows + '</div></div>';
    }

    if (failCount && errors) {
        listHtml += '<div class="om-result-section"><div class="om-result-sec-title">失败项</div><div class="om-result-list">' +
            errors.slice(0, 20).map(function (e) {
                return '<div class="om-result-row bad" data-id="' + esc(e.id || '') + '" title="点击重试">' +
                    '<span class="om-result-row-name">' + esc(e.name) + '</span>' +
                    '<span class="om-result-row-path">' + esc(e.error || '失败') + ' · 点此重试</span></div>';
            }).join('') + '</div></div>';
    }

    var canUndo = !err && state.lastClassifyUndo && state.lastClassifyUndo.items && state.lastClassifyUndo.items.length;
    modal.innerHTML = '<div class="om-modal-box om-result-box om-ornate-box">' +
        summaryHtml + createdHtml + listHtml +
        '<div class="om-btn-row" style="margin-top:14px;justify-content:flex-end;flex-wrap:wrap;gap:8px">' +
        (canUndo ? '<button class="om-btn om-btn-outline" id="om-autocat-undo"><i class="fa-solid fa-rotate-left"></i> 选择性撤销</button>' : '') +
        '<button class="om-btn om-btn-safe" id="om-autocat-done">知道了</button></div></div>';
    _mp.appendChild(modal);

    function close() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#om-autocat-done').addEventListener('click', close);
    var undoBtn = modal.querySelector('#om-autocat-undo');
    if (undoBtn) undoBtn.addEventListener('click', function () {
        close();
        openClassifyUndoSheet();
    });
    // 失败项可点：打开该穿搭并支持重试分类
    modal.querySelectorAll('.om-result-row.bad[data-id]').forEach(function (row) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', function () {
            var id = row.dataset.id;
            close();
            if (id) openAutoClassifyModal([id]);
        });
    });
    modal.querySelectorAll('.om-result-row[data-id]:not(.bad)').forEach(function (row) {
        row.style.cursor = 'pointer';
        row.title = '查看该穿搭';
        row.addEventListener('click', function () {
            var id = row.dataset.id;
            if (!id) return;
            var part = loadCurrent();
            var o = partGetById(part, id);
            if (o && o.imageData && typeof fn.openLightbox === 'function') {
                close();
                fn.openLightbox([o], o.id, { showSelect: true });
            }
        });
    });
}

export function openClassifyUndoSheet() {
    var snap = state.lastClassifyUndo;
    if (!snap || !snap.items || !snap.items.length) {
        toast('没有可撤销的分类记录', true);
        return;
    }
    var rows = snap.items.map(function (it, i) {
        var prev = (it.prevCategory || '未分类') + (it.prevSubCategory ? ' / ' + it.prevSubCategory : '');
        var now = (it.category || '未分类') + (it.subCategory ? ' / ' + it.subCategory : '');
        return '<label class="om-undo-row">' +
            '<input type="checkbox" class="om-undo-chk" data-idx="' + i + '" checked />' +
            '<span class="om-undo-name">' + esc(it.name) + '</span>' +
            '<span class="om-undo-path">' + esc(now) + ' → ' + esc(prev) + '</span></label>';
    }).join('');
    var modal = document.createElement('div');
    modal.className = 'om-modal';
    modal.innerHTML = '<div class="om-modal-box om-result-box om-ornate-box">' +
        '<div class="om-result-badge"><i class="fa-solid fa-rotate-left"></i> 选择性撤销分类</div>' +
        '<div class="om-hint" style="margin:6px 0 10px">勾选要恢复为分类前状态的项</div>' +
        '<div class="om-btn-row" style="margin-bottom:8px">' +
        '<button type="button" class="om-btn om-btn-outline" id="om-undo-all">全选</button>' +
        '<button type="button" class="om-btn om-btn-outline" id="om-undo-none">全不选</button></div>' +
        '<div class="om-undo-list">' + rows + '</div>' +
        '<div class="om-btn-row" style="margin-top:12px;justify-content:flex-end;gap:8px">' +
        '<button class="om-btn om-btn-outline" id="om-undo-cancel">取消</button>' +
        '<button class="om-btn om-btn-safe" id="om-undo-apply">撤销所选</button></div></div>';
    getPopupLayer().appendChild(modal);
    function close() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#om-undo-cancel').addEventListener('click', close);
    modal.querySelector('#om-undo-all').addEventListener('click', function () {
        modal.querySelectorAll('.om-undo-chk').forEach(function (c) { c.checked = true; });
    });
    modal.querySelector('#om-undo-none').addEventListener('click', function () {
        modal.querySelectorAll('.om-undo-chk').forEach(function (c) { c.checked = false; });
    });
    modal.querySelector('#om-undo-apply').addEventListener('click', function () {
        var part = loadPartition(snap.partKey);
        var n = 0;
        modal.querySelectorAll('.om-undo-chk:checked').forEach(function (c) {
            var it = snap.items[parseInt(c.dataset.idx, 10)];
            if (!it) return;
            var o = partGetById(part, it.id);
            if (!o) return;
            o.category = it.prevCategory || '';
            o.subCategory = it.prevSubCategory || '';
            n++;
        });
        if (n) {
            savePartition(snap.partKey, part);
            state.lastClassifyUndo = null;
            if (fn.renderCatbar) fn.renderCatbar();
            if (fn.renderGrid) fn.renderGrid();
            toast('已撤销 ' + n + ' 套分类');
        } else {
            toast('未选择任何项', true);
        }
        close();
    });
}

export function ensureProgressChip() {
    var ov = document.querySelector('.om-overlay .om-box') || document.querySelector('.om-overlay');
    var chip = document.getElementById('om-progress-chip');
    if (chip) return chip;
    if (!ov) return null;
    chip = document.createElement('div');
    chip.id = 'om-progress-chip';
    chip.className = 'om-progress-chip';
    chip.innerHTML = '<div class="om-progress-chip-top"><i class="fa-solid fa-spinner fa-spin"></i><span id="om-progress-text">分类中…</span></div>' +
        '<div class="om-progress-track"><div class="om-progress-bar" id="om-progress-bar"></div></div><button type="button" class="om-btn om-btn-outline" id="om-classify-stop">停止分类</button>';
    chip.querySelector('#om-classify-stop').onclick=function(){if(activeClassification&&activeClassification.cancel){activeClassification.cancel();this.disabled=true;this.textContent='正在停止…';}};
    ov.appendChild(chip);
    return chip;
}

export function updateProgressChip(done, total, msg) {
    var chip = ensureProgressChip();
    if (!chip) return;
    var pct = total > 0 ? Math.round(done / total * 100) : 0;
    var text = document.getElementById('om-progress-text');
    var bar = document.getElementById('om-progress-bar');
    if (text) text.textContent = (msg || ('分类中 ' + done + '/' + total)) + ' · ' + pct + '%';
    if (bar) bar.style.width = pct + '%';
}

export function hideProgressChip() {
    var chip = document.getElementById('om-progress-chip');
    if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
}

export function openAutoClassifyModal(ids, options) {
    if(activeClassification){toast('当前有分类正在进行，可先停止或等待完成');return;}
    options=options||{};
    var meta = loadMeta();
    var apiCfg = meta.apiVision || {};
    if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) {
        toast('请先在设置中配置"描述生成 API"', true);
        return;
    }
    var sourcePartKey = options.sourcePartKey || currentPartKey();
    var sourcePart = loadPartition(sourcePartKey);
    var queue = uniqueIds(ids).map(function (id) { return partGetById(sourcePart, id); })
        .filter(function (o) { return o && o.imageData; });
    if (queue.length === 0) {
        toast('所选穿搭中没有带图片的', true);
        return;
    }

    var snapshots=queue.map(function(item){return {id:item.id,name:item.name,imageData:item.imageData,category:item.category,subCategory:item.subCategory};});
    var sheet=createSheet('<div class="om-sheet-title">图片自动分类</div><div class="om-feature-content">'+
        '<p>当前范围共有 <strong>'+queue.length+'</strong> 套带图片的穿搭。</p><p class="om-hint">本地“标签”不用 API；图片分类会调用 API，按风格与季节整理，必要时新增分类，完成后可以撤销。</p>'+
        '<label class="om-tag-scope">本次处理<select id="om-classify-range"><option value="10">先试 '+Math.min(10,queue.length)+' 套</option>'+(queue.length>30?'<option value="30">前 30 套</option>':'')+'<option value="all">全部 '+queue.length+' 套</option><option value="custom">自定义数量</option></select></label>'+
        '<label id="om-classify-custom-row" hidden>处理数量<input id="om-classify-custom" type="number" min="1" max="'+queue.length+'" value="'+Math.min(10,queue.length)+'"></label>'+
        '<p id="om-classify-cost" role="status"></p><div class="om-edit-foot"><button type="button" class="om-btn om-btn-outline" id="om-classify-cancel">取消</button><button type="button" class="om-btn om-btn-safe" id="om-classify-review">核对调用范围</button></div></div>',{modal:true,medium:true});
    function count(){var range=sheet.querySelector('#om-classify-range').value,n=range==='all'?queue.length:range==='custom'?Number(sheet.querySelector('#om-classify-custom').value):Number(range);return Math.max(0,Math.min(queue.length,Math.floor(n)||0));}
    function update(){var n=count();sheet.querySelector('#om-classify-custom-row').hidden=sheet.querySelector('#om-classify-range').value!=='custom';sheet.querySelector('#om-classify-cost').textContent='本次 '+n+' 套，预计最多 '+n+' 次 API 请求；下一步还需确认，当前不会调用。';sheet.querySelector('#om-classify-review').disabled=!n;}
    sheet.querySelector('#om-classify-range').onchange=update;sheet.querySelector('#om-classify-custom').oninput=update;update();
    sheet.querySelector('#om-classify-cancel').onclick=function(){closeSheet(sheet);};
    sheet.querySelector('#om-classify-review').onclick=async function(){
        var selected=snapshots.slice(0,count());if(!selected.length)return;
        this.disabled=true;
        var yes=await confirmApiBatch({count:selected.length,action:'为这些穿搭生成图片分类'});
        if(!sheet.isConnected)return;this.disabled=false;if(!yes)return;
        var current=await new Promise(function(resolve){ensurePartitionLoaded(sourcePartKey,resolve);});
        if(!current||selected.some(function(before){var now=partGetById(current,before.id);return !now||['name','imageData','category','subCategory'].some(function(key){return now[key]!==before[key];});})){toast('范围内服装已有修改，请重新打开分类确认',true);return;}
        closeSheet(sheet);runConfirmedClassification(selected,sourcePartKey);
    };
}

function runConfirmedClassification(queue, sourcePartKey) {
    if(activeClassification){toast('已有分类正在进行，请等待完成');return;}
    var ids=queue.map(function(item){return item.id;}),sourceIdentity=getChatIdentity(),ticket={cancel:null};activeClassification=ticket;
    toast('开始分类 ' + queue.length + ' 套（风格 + 春夏/秋冬）');
    updateProgressChip(0, queue.length, '准备中');
    var handle=batchClassifyOutfits(ids, { allowCreate: true, sourcePartKey: sourcePartKey },
        function (done, total, msg) {
            updateProgressChip(done, total, msg || ('分类中 ' + done + '/' + total));
        },
        function (err, doneCount, errors, extra) {
            if(activeClassification===ticket)activeClassification=null;
            extra = extra || {};
            hideProgressChip();
            if(currentPartKey()===sourcePartKey&&getChatIdentity()===sourceIdentity)state.batchSelected = [];
            fn.renderCatbar();
            fn.renderGrid();
            renderBottomStatus();
            fn.updateBtn();
            if (!err && extra.assigned && extra.assigned.length) {
                state.lastClassifyUndo = {
                    partKey: sourcePartKey,
                    ts: Date.now(),
                    items: extra.assigned.map(function (a) {
                        return {
                            id: a.id,
                            name: a.name,
                            prevCategory: a.prevCategory || '',
                            prevSubCategory: a.prevSubCategory || '',
                            category: a.category || '',
                            subCategory: a.subCategory || ''
                        };
                    })
                };
            }
            showAutoClassifyResultModal(err, doneCount, errors, extra);
            var low = (extra.assigned || []).filter(function (a) { return a.lowConfidence && a.id; });
            if (!err && low.length) {
                setTimeout(function () {
                    showConfidenceReviewModal(low, sourcePartKey);
                }, 400);
            }
        }
    );
    ticket.cancel=function(){if(handle)handle.cancel();};
}


export function setupBatchSwipeSelect(area, opts) {
    opts = opts || {};
    var idKey = opts.idKey || 'id'; // dataset key: id | accId
    if (!area || area.dataset.swipeBound === '1') return;
    area.dataset.swipeBound = '1';

    var drag = null;
    var suppressClick = false;
    var moveOpts = { passive: false, capture: true };
    var rubber = null;
    var cachedRects = null; // [{el,id,l,t,r,b}]
    var rafId = 0;
    var pendingXY = null;

    function ensureRubber() {
        if (rubber) return rubber;
        rubber = document.createElement('div');
        rubber.className = 'om-marquee';
        rubber.style.display = 'none';
        area.appendChild(rubber);
        if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
        return rubber;
    }

    function updateRubber(x0, y0, x1, y1) {
        var el = ensureRubber();
        var ar = area.getBoundingClientRect();
        el.style.display = 'block';
        el.style.left = (Math.min(x0, x1) - ar.left + area.scrollLeft) + 'px';
        el.style.top = (Math.min(y0, y1) - ar.top + area.scrollTop) + 'px';
        el.style.width = Math.abs(x1 - x0) + 'px';
        el.style.height = Math.abs(y1 - y0) + 'px';
    }

    function hideRubber() {
        if (rubber) rubber.style.display = 'none';
    }

    function cardId(el) {
        if (!el || !el.dataset) return '';
        return el.dataset[idKey] || el.dataset.id || el.dataset.accId || '';
    }

    function cacheCardRects() {
        var cards = area.querySelectorAll('.om-card');
        cachedRects = [];
        for (var i = 0; i < cards.length; i++) {
            var el = cards[i];
            var id = cardId(el);
            if (!id) continue;
            var r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            cachedRects.push({ el: el, id: id, l: r.left, t: r.top, r: r.right, b: r.bottom });
        }
    }

    function applyCardEl(el, id) {
        if (!drag || !id) return;
        if (drag.visited[id]) return;
        drag.visited[id] = true;
        var idx = state.batchSelected.indexOf(id);
        if (drag.mode === 'add') {
            if (idx === -1) state.batchSelected.push(id);
        } else if (idx !== -1) {
            state.batchSelected.splice(idx, 1);
        }
        var selected = state.batchSelected.indexOf(id) !== -1;
        el.classList.toggle('batch-sel', selected);
        var chk = el.querySelector('.om-card-check');
        if (chk) chk.classList.toggle('checked', selected);
    }

    function flushCount() {
        var cnt = document.getElementById('om-batch-count');
        if (cnt) cnt.textContent = state.batchSelected.length;
    }

    function paintRect(x0, y0, x1, y1) {
        if (!cachedRects) cacheCardRects();
        var left = Math.min(x0, x1);
        var right = Math.max(x0, x1);
        var top = Math.min(y0, y1);
        var bottom = Math.max(y0, y1);
        if (right - left < 3 && bottom - top < 3) {
            if (drag.startCard) applyCardEl(drag.startCard, cardId(drag.startCard));
            return;
        }
        for (var i = 0; i < cachedRects.length; i++) {
            var c = cachedRects[i];
            if (c.r < left || c.l > right || c.b < top || c.t > bottom) continue;
            applyCardEl(c.el, c.id);
        }
    }

    function schedulePaint(x, y) {
        pendingXY = { x: x, y: y };
        if (rafId) return;
        rafId = requestAnimationFrame(function () {
            rafId = 0;
            if (!drag || !pendingXY) return;
            paintRect(drag.startX, drag.startY, pendingXY.x, pendingXY.y);
            if (drag.pointerType === 'mouse') updateRubber(drag.startX, drag.startY, pendingXY.x, pendingXY.y);
            flushCount();
        });
    }

    function unbindDoc() {
        document.removeEventListener('pointermove', onDocMove, moveOpts);
        document.removeEventListener('pointerup', onDocUp, true);
        document.removeEventListener('pointercancel', onDocUp, true);
        area.classList.remove('is-swiping-x');
        hideRubber();
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        pendingXY = null;
        cachedRects = null;
    }

    function onDocMove(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        var dx = e.clientX - drag.startX;
        var dy = e.clientY - drag.startY;
        var adx = Math.abs(dx);
        var ady = Math.abs(dy);
        var dist = Math.hypot(dx, dy);
        var isMouse = drag.pointerType === 'mouse';

        if (!drag.axis) {
            var threshold = isMouse ? 5 : 16;
            if (dist < threshold) return;
            if (!isMouse && ady > adx * 1.25) {
                drag.axis = 'scroll';
                drag.cancelled = true;
                return;
            }
            drag.axis = 'select';
            area.classList.add('is-swiping-x');
            cacheCardRects();
            drag.visited = {};
            schedulePaint(e.clientX, e.clientY);
            return;
        }
        if (drag.axis !== 'select' || drag.cancelled) return;
        if (e.cancelable) e.preventDefault();
        schedulePaint(e.clientX, e.clientY);
    }

    function onDocUp(e) {
        if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return;
        var dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        var isMouse = drag.pointerType === 'mouse';
        var wasTap = !drag.axis && !drag.cancelled && dist < (isMouse ? 6 : 14);

        if (drag.axis === 'select') {
            paintRect(drag.startX, drag.startY, e.clientX, e.clientY);
            flushCount();
        } else if (wasTap && drag.startCard) {
            applyCardEl(drag.startCard, cardId(drag.startCard));
            flushCount();
            suppressClick = true;
            setTimeout(function () { suppressClick = false; }, 120);
        }
        drag = null;
        unbindDoc();
    }

    function onPointerDown(e) {
        if (!state.batchMode) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        var card = e.target.closest && e.target.closest('.om-card');
        if (e.pointerType === 'mouse' && !card) {
            if (!area.contains(e.target) && e.target !== area) return;
        } else if (!card || !area.contains(card)) {
            return;
        }
        if (e.target.closest && e.target.closest('.om-card-menu')) return;

        unbindDoc();
        var startCard = card || null;
        var mode = 'add';
        if (startCard && cardId(startCard)) {
            mode = state.batchSelected.indexOf(cardId(startCard)) !== -1 ? 'remove' : 'add';
        }
        drag = {
            pointerId: e.pointerId,
            pointerType: e.pointerType || 'mouse',
            startX: e.clientX,
            startY: e.clientY,
            startCard: startCard,
            mode: mode,
            axis: null,
            cancelled: false,
            visited: {}
        };
        document.addEventListener('pointermove', onDocMove, moveOpts);
        document.addEventListener('pointerup', onDocUp, true);
        document.addEventListener('pointercancel', onDocUp, true);
    }

    area.addEventListener('click', function (e) {
        if (!state.batchMode) return;
        if (suppressClick && e.target.closest && e.target.closest('.om-card')) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);

    area.addEventListener('pointerdown', onPointerDown);
}
