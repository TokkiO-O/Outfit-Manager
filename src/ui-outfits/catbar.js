// Outfit Manager · 二改版 | 穿搭分类与子分类栏
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { fn, state } from '../bridge.js';
import { getCatNames, getSubCats, hasSubCats } from '../data.js';
import { loadCurrent } from '../db/index.js';
import { esc } from '../utils.js';

// ── 分类栏渲染（使用新 API）────────────────────────────────
export function renderCatbar() {
    var catbar = document.getElementById('om-catbar');
    if (!catbar) return;
    var wrap = document.querySelector('.om-catbar-wrap');

    // 单品模式：收起穿搭分类栏，只留单品分类
    if (state.accMode) {
        catbar.style.display = 'none';
        if (wrap) wrap.style.display = 'none';
        return;
    }
    if (wrap) wrap.style.display = '';

    var part = loadCurrent();
    var cats = part.categories || [];
    var catNames = getCatNames(cats);

    // 兼容旧状态：有 drill 时同步到 curCat
    if (state.catDrillParent) {
        state.curCat = state.catDrillParent;
    }

    if (catNames.length === 0) {
        catbar.style.display = 'none';
        state.catDrillParent = null;
        state.curSubCat = null;
        state.curCat = '__all__';
        return;
    }
    catbar.style.display = '';

    var activeParent = (state.curCat && state.curCat !== '__all__') ? state.curCat : null;
    var subCats = activeParent && hasSubCats(cats, activeParent) ? getSubCats(cats, activeParent) : [];

    // 第一行：母分类（始终显示，不覆盖）
    var html = '<div class="om-cat-row om-cat-row-main">';
    html += '<button class="om-catbtn' + (state.curCat === '__all__' ? ' on' : '') + '" data-c="__all__">全部</button>';
    catNames.forEach(function (c) {
        var hasSub = hasSubCats(cats, c);
        html += '<button class="om-catbtn' + (state.curCat === c ? ' on' : '') + (hasSub ? ' om-catbtn-parent' : '') + '" data-c="' + esc(c) + '">' +
            esc(c) + (hasSub ? '<i class="fa-solid fa-caret-down om-cat-caret"></i>' : '') + '</button>';
    });
    html += '</div>';

    // 第二行：子分类（在选中的母分类下方展开，不替换母分类）
    if (subCats.length) {
        html += '<div class="om-cat-row om-cat-row-sub">';
        html += '<button class="om-catbtn om-catbtn-sub' + (state.curSubCat === null ? ' on' : '') + '" data-sub="__all__">全部·' + esc(activeParent) + '</button>';
        subCats.forEach(function (sc) {
            html += '<button class="om-catbtn om-catbtn-sub' + (state.curSubCat === sc ? ' on' : '') + '" data-sub="' + esc(sc) + '">' + esc(sc) + '</button>';
        });
        html += '</div>';
    }

    catbar.innerHTML = html;

    catbar.querySelectorAll('.om-catbtn[data-c]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var c = btn.dataset.c;
            if (c === '__all__') {
                state.curCat = '__all__';
                state.catDrillParent = null;
                state.curSubCat = null;
            } else {
                state.curCat = c;
                state.catDrillParent = hasSubCats(cats, c) ? c : null;
                state.curSubCat = null;
            }
            renderCatbar();
            fn.renderGrid();
        });
    });
    catbar.querySelectorAll('.om-catbtn[data-sub]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var sub = btn.dataset.sub;
            state.curSubCat = (sub === '__all__') ? null : sub;
            if (activeParent) {
                state.curCat = activeParent;
                state.catDrillParent = activeParent;
            }
            renderCatbar();
            fn.renderGrid();
        });
    });

    // 电脑端：鼠标滚轮横向滚动 + 拖拽（绑定到每一行）
    catbar.querySelectorAll('.om-cat-row').forEach(function (row) {
        if (row._wheelBound) return;
        row.addEventListener('wheel', function (e) {
            if (Math.abs(e.deltaY) > 0) {
                e.preventDefault();
                row.scrollLeft += e.deltaY;
            }
        }, { passive: false });
        var _drag = { down: false, startX: 0, scrollL: 0 };
        row.addEventListener('mousedown', function (e) {
            if (e.target.closest && e.target.closest('button')) return;
            _drag.down = true; _drag.startX = e.pageX; _drag.scrollL = row.scrollLeft;
            row.style.cursor = 'grabbing'; row.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', function (e) {
            if (!_drag.down) return;
            row.scrollLeft = _drag.scrollL - (e.pageX - _drag.startX);
        });
        document.addEventListener('mouseup', function () {
            if (_drag.down) { _drag.down = false; row.style.cursor = ''; row.style.userSelect = ''; }
        });
        row._wheelBound = true;
    });
}
