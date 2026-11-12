// Outfit Manager · 二改版 | 穿搭及单品分类管理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { fn, state } from '../bridge.js';
import { SHARED_CHAR_KEY, SHARED_CHAR_LABEL, getCatNames } from '../data.js';
import { load, loadCurrent, save, saveCurrent } from '../db/index.js';
import { esc, toast } from '../utils.js';
import { closeSheet, createSheet } from './sheet-base.js';

export function openCatsSheet(isAcc) {
    isAcc = !!isAcc;
    var cats = [];
    var catNames = [];
    var viewOutfits = [];
    var viewLabel = '';
    var itemLabel = isAcc ? '单品' : '穿搭';
    var itemUnit = isAcc ? '个' : '套';
    // 折叠状态（面板内部管理，每次打开默认全部折叠）
    var expanded = {};

    function loadCatData() {
        var p = loadCurrent();
        if (isAcc) {
            if (!Array.isArray(p.accCategories)) p.accCategories = [];
            if (!Array.isArray(p.accessories)) p.accessories = [];
            return { raw: p, cats: p.accCategories, items: p.accessories };
        }
        if (!Array.isArray(p.categories)) p.categories = [];
        if (!Array.isArray(p.outfits)) p.outfits = [];
        // raw 仍给兼容层一份视图对象，但 cats/items 直接指向 partition
        var d = load();
        d.categories = p.categories;
        d.outfits = p.outfits;
        return { raw: d, cats: p.categories, items: p.outfits };
    }

    function saveCatData(raw, nextCats) {
        // 始终写回当前 partition，避免 load()/save() 兼容层丢 categories 引用
        var part = loadCurrent();
        if (isAcc) {
            part.accCategories = nextCats || [];
            if (raw && Array.isArray(raw.accessories)) part.accessories = raw.accessories;
            saveCurrent(part);
            fn.renderAccCatbar();
        } else {
            part.categories = nextCats || [];
            // 同步穿搭上的 category 清理结果
            if (raw) {
                if (Array.isArray(raw.outfits)) part.outfits = raw.outfits;
                else if (raw.currentView === 'char' && raw.currentChar && raw.chars && raw.chars[raw.currentChar]) {
                    part.outfits = raw.chars[raw.currentChar].outfits || part.outfits;
                }
            }
            saveCurrent(part);
            fn.renderCatbar();
        }
        fn.renderGrid();
    }

    function refreshLocalData() {
        var data = loadCatData();
        cats = data.cats;
        catNames = getCatNames(cats);
        viewOutfits = data.items;
        if (isAcc) {
            viewLabel = '单品';
        } else {
            var d = data.raw;
            viewLabel = d.currentView === 'char' && d.currentChar ? (d.currentChar === SHARED_CHAR_KEY ? SHARED_CHAR_LABEL : d.currentChar) + '的' : 'User的';
        }
    }

    refreshLocalData();

    function buildList() {
        var listHTML = '';
        if (catNames.length === 0) {
            return '<div class="om-empty"><i class="fa-solid fa-tags"></i><span>还没有分类</span></div>';
        }
        cats.forEach(function (catObj, idx) {
            var catName = typeof catObj === 'object' ? catObj.name : catObj;
            var children = typeof catObj === 'object' ? (catObj.children || []) : [];
            var n = viewOutfits.filter(function (o) { return o.category === catName; }).length;
            var isExpanded = !!expanded[idx];
            var chevron = children.length > 0
                ? '<i class="fa-solid fa-chevron-' + (isExpanded ? 'down' : 'right') + ' om-cat-chevron"></i>'
                : '<span class="om-cat-chevron-placeholder"></span>';
            listHTML += '<div class="om-cat-item om-cat-parent" data-idx="' + idx + '">' +
                '<input type="checkbox" class="om-chk om-cat-batch-cb" data-idx="' + idx + '" data-name="' + esc(catName) + '" title="批量选择" onclick="event.stopPropagation()" />' +
                chevron +
                '<span class="om-cat-name" style="font-weight:600">' + esc(catName) + '</span><span class="om-cat-count">' + n + itemUnit + '</span>' +
                '<button class="om-btn-sm om-cat-addsub" data-idx="' + idx + '" title="添加子分类"><i class="fa-solid fa-plus"></i></button>' +
                '<button class="om-btn-sm om-cat-ren" data-idx="' + idx + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="om-btn-sm om-cat-del" data-idx="' + idx + '" title="删除"><i class="fa-solid fa-trash"></i></button></div>';
            // 子分类（仅展开时显示）
            if (isExpanded) {
                children.forEach(function (sc, si) {
                    var sn = viewOutfits.filter(function (o) { return o.category === catName && o.subCategory === sc; }).length;
                    listHTML += '<div class="om-cat-item om-cat-child" style="padding-left:32px;opacity:.85"><span class="om-cat-name"><i class="fa-solid fa-turn-up fa-rotate-90" style="font-size:.6em;opacity:.3;margin-right:6px"></i>' + esc(sc) + '</span><span class="om-cat-count">' + sn + itemUnit + '</span>' +
                        '<button class="om-btn-sm om-subcat-ren" data-pidx="' + idx + '" data-sidx="' + si + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                        '<button class="om-btn-sm om-subcat-del" data-pidx="' + idx + '" data-sidx="' + si + '" title="删除"><i class="fa-solid fa-trash"></i></button></div>';
                });
            }
        });
        return listHTML;
    }

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-tags"></i>' + esc(viewLabel) + '分类管理</div>',
        '<div id="om-cats-list">' + buildList() + '</div>',
        '<div class="om-btn-row" style="margin-top:8px">' +
        '<button class="om-btn om-btn-outline" id="om-cats-selall" style="flex:1">全选</button>' +
        '<button class="om-btn om-btn-outline" id="om-cats-clean-empty" style="flex:1" title="删除没有任何衣服的分类">清空分类</button>' +
        '<button class="om-btn om-btn-danger" id="om-cats-batch-del" style="flex:1"><i class="fa-solid fa-trash"></i> 批量删除</button></div>',
        '<div class="om-divider"></div>',
        '<div class="om-cat-add-row"><input type="text" id="om-newcat" placeholder="新分类名称…" /><button class="om-btn om-btn-safe" id="om-newadd">添加</button></div>',
        '<div class="om-divider"></div>',
        '<div class="om-hint">合并：将源分类下的穿搭全部移到目标分类，并删除源分类</div>',
        '<div class="om-cat-merge-row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<select id="om-merge-from" style="flex:1;min-width:100px;padding:8px;border-radius:8px;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);color:inherit;font-family:inherit"><option value="">源分类…</option></select>' +
        '<i class="fa-solid fa-arrow-right" style="opacity:.4"></i>' +
        '<select id="om-merge-to" style="flex:1;min-width:100px;padding:8px;border-radius:8px;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);color:inherit;font-family:inherit"><option value="">目标分类…</option></select>' +
        '<button class="om-btn om-btn-outline" id="om-merge-go">合并</button></div>',
        (!isAcc ? '<div class="om-divider"></div><button class="om-btn om-btn-outline" id="om-cats-autoclass" style="width:100%"><i class="fa-solid fa-wand-magic-sparkles"></i> 一键分类全部未分类</button>' : ''),
    ].join(''));

    function rebindEvents() {
        var listEl = sheet.querySelector('#om-cats-list');
        if (!listEl) return;
        listEl.innerHTML = buildList();

        // 点击父分类行折叠/展开
        listEl.querySelectorAll('.om-cat-parent').forEach(function (row) {
            row.addEventListener('click', function (e) {
                // 不拦截按钮点击
                if (e.target.closest('.om-btn-sm')) return;
                var idx = parseInt(row.dataset.idx);
                var catObj = cats[idx];
                var children = typeof catObj === 'object' ? (catObj.children || []) : [];
                if (children.length === 0) return; // 无子分类不响应
                expanded[idx] = !expanded[idx];
                rebindEvents();
            });

            // 有子分类的父行显示 pointer
            var idx2 = parseInt(row.dataset.idx);
            var catObj2 = cats[idx2];
            var children2 = typeof catObj2 === 'object' ? (catObj2.children || []) : [];
            if (children2.length > 0) row.style.cursor = 'pointer';
        });

        // 添加子分类
        listEl.querySelectorAll('.om-cat-addsub').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats;
                var idx = parseInt(btn.dataset.idx);
                var catObj = vc[idx]; if (!catObj || typeof catObj !== 'object') return;
                var scName = prompt('为「' + catObj.name + '」添加子分类：'); if (!scName || !scName.trim()) return; scName = scName.trim();
                if (!catObj.children) catObj.children = [];
                if (catObj.children.indexOf(scName) !== -1) { toast('子分类已存在', true); return; }
                catObj.children.push(scName); saveCatData(data.raw, vc);
                // 更新本地引用并展开
                refreshLocalData();
                expanded[idx] = true;
                rebindEvents();
                toast('子分类「' + scName + '」已添加');
            });
        });

        // 父分类重命名
        listEl.querySelectorAll('.om-cat-ren').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var idx = parseInt(btn.dataset.idx);
                var catObj = vc[idx]; if (!catObj) return;
                var old = typeof catObj === 'object' ? catObj.name : catObj;
                var nw = prompt('重命名（原：' + old + '）：', old); if (!nw || !nw.trim() || nw.trim() === old) return;
                nw = nw.trim();
                if (typeof catObj === 'object') catObj.name = nw; else vc[idx] = { name: nw, children: [] };
                vo.forEach(function (o) { if (o.category === old) o.category = nw; });
                saveCatData(data.raw, vc);
                refreshLocalData();
                rebindEvents();
                toast('已重命名');
            });
        });

        // 父分类删除
        listEl.querySelectorAll('.om-cat-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var idx = parseInt(btn.dataset.idx);
                var catObj = vc[idx]; if (!catObj) return;
                var catName = typeof catObj === 'object' ? catObj.name : catObj;
                if (!confirm('删除分类「' + catName + '」及其所有子分类？（' + itemLabel + '不会被删除）')) return;
                vc.splice(idx, 1);
                vo.forEach(function (o) { if (o.category === catName) { o.category = ''; o.subCategory = ''; } });
                if (isAcc) {
                    if (state.accCat === catName) { state.accCat = '__all__'; state.accDrillParent = null; state.accSubCat = null; }
                } else if (state.curCat === catName) {
                    state.curCat = '__all__'; state.catDrillParent = null; state.curSubCat = null;
                }
                saveCatData(data.raw, vc);
                refreshLocalData();
                // 移除已删除索引的展开状态
                delete expanded[idx];
                rebindEvents();
                toast('已删除');
            });
        });

        // 子分类重命名
        listEl.querySelectorAll('.om-subcat-ren').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var pidx = parseInt(btn.dataset.pidx); var sidx = parseInt(btn.dataset.sidx);
                var catObj = vc[pidx]; if (!catObj || typeof catObj !== 'object') return;
                var old = catObj.children[sidx];
                var nw = prompt('重命名子分类（原：' + old + '）：', old); if (!nw || !nw.trim() || nw.trim() === old) return;
                nw = nw.trim(); catObj.children[sidx] = nw;
                vo.forEach(function (o) { if (o.category === catObj.name && o.subCategory === old) o.subCategory = nw; });
                saveCatData(data.raw, vc);
                refreshLocalData();
                rebindEvents();
                toast('已重命名');
            });
        });

        // 子分类删除
        listEl.querySelectorAll('.om-subcat-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var data = loadCatData(); var vc = data.cats; var vo = data.items;
                var pidx = parseInt(btn.dataset.pidx); var sidx = parseInt(btn.dataset.sidx);
                var catObj = vc[pidx]; if (!catObj || typeof catObj !== 'object') return;
                var scName = catObj.children[sidx];
                if (!confirm('删除子分类「' + scName + '」？（' + itemLabel + '不会被删除）')) return;
                catObj.children.splice(sidx, 1);
                vo.forEach(function (o) { if (o.category === catObj.name && o.subCategory === scName) o.subCategory = ''; });
                saveCatData(data.raw, vc);
                refreshLocalData();
                rebindEvents();
                toast('已删除');
            });
        });
    }

    rebindEvents();

    var inp = sheet.querySelector('#om-newcat');
    
    function fillMergeSelects() {
        var from = sheet.querySelector('#om-merge-from');
        var to = sheet.querySelector('#om-merge-to');
        if (!from || !to) return;
        var opts = catNames.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
        from.innerHTML = '<option value="">源分类…</option>' + opts;
        to.innerHTML = '<option value="">目标分类…</option>' + opts;
    }
    fillMergeSelects();

    function getCheckedCatNames() {
        var names = [];
        sheet.querySelectorAll('.om-cat-batch-cb:checked').forEach(function (cb) {
            if (cb.dataset.name) names.push(cb.dataset.name);
        });
        return names;
    }
    var selAllBtn = sheet.querySelector('#om-cats-selall');
    if (selAllBtn) selAllBtn.addEventListener('click', function () {
        var boxes = sheet.querySelectorAll('.om-cat-batch-cb');
        var allOn = true;
        boxes.forEach(function (b) { if (!b.checked) allOn = false; });
        boxes.forEach(function (b) { b.checked = !allOn; });
        selAllBtn.textContent = allOn ? '全选' : '取消全选';
    });
    var cleanEmptyBtn = sheet.querySelector('#om-cats-clean-empty');
    if (cleanEmptyBtn) cleanEmptyBtn.addEventListener('click', function () {
        var data = loadCatData();
        var items = data.items || [];
        var nextCats = (data.cats || []).filter(function (c) {
            var n = typeof c === 'object' ? c.name : c;
            var count = items.filter(function (o) { return o.category === n; }).length;
            return count > 0;
        });
        var removed = (data.cats || []).length - nextCats.length;
        if (removed === 0) { toast('没有空分类需要清理'); return; }
        if (!confirm('将删除 ' + removed + ' 个没有任何' + itemLabel + '的分类，确定？')) return;
        saveCatData(data.raw, nextCats);
        refreshLocalData();
        fillMergeSelects();
        rebindEvents();
        toast('已清理 ' + removed + ' 个空分类');
    });
    var batchDelBtn = sheet.querySelector('#om-cats-batch-del');
    if (batchDelBtn) batchDelBtn.addEventListener('click', function () {
        var names = getCheckedCatNames();
        if (names.length === 0) { toast('请先勾选要删除的分类', true); return; }
        if (!confirm('确定删除选中的 ' + names.length + ' 个分类？\n分类下的' + itemLabel + '会变成「未分类」，此操作不可撤销。')) return;
        var data = loadCatData();
        var nameSet = {};
        names.forEach(function (n) { nameSet[n] = true; });
        (data.items || []).forEach(function (o) {
            if (o.category && nameSet[o.category]) {
                o.category = '';
                o.subCategory = '';
            }
        });
        var nextCats = (data.cats || []).filter(function (c) {
            var n = typeof c === 'object' ? c.name : c;
            return !nameSet[n];
        });
        if (isAcc) {
            data.raw.accCategories = nextCats;
            data.raw.accessories = data.items;
            saveCurrent(data.raw);
            fn.renderAccCatbar();
        } else {
            saveCatData(data.raw, nextCats);
            var curP = loadCurrent();
            saveCurrent(curP);
        }
        refreshLocalData();
        fillMergeSelects();
        rebindEvents();
        toast('已删除 ' + names.length + ' 个分类');
    });

    var mergeGo = sheet.querySelector('#om-merge-go');
    if (mergeGo) mergeGo.addEventListener('click', function () {
        var fromName = (sheet.querySelector('#om-merge-from').value || '').trim();
        var toName = (sheet.querySelector('#om-merge-to').value || '').trim();
        if (!fromName || !toName) { toast('请选择源分类和目标分类', true); return; }
        if (fromName === toName) { toast('源与目标不能相同', true); return; }
        if (!confirm('将「' + fromName + '」合并到「' + toName + '」？\\n该分类下的' + itemLabel + '会移过去，源分类将被删除。')) return;
        var data = loadCatData();
        var nextCats = (data.cats || []).slice();
        var fromObj = null, toObj = null, fromIdx = -1;
        for (var i = 0; i < nextCats.length; i++) {
            var n = typeof nextCats[i] === 'object' ? nextCats[i].name : nextCats[i];
            if (n === fromName) { fromObj = nextCats[i]; fromIdx = i; }
            if (n === toName) toObj = nextCats[i];
        }
        if (fromIdx < 0 || !toObj) { toast('分类不存在', true); return; }
        // 移动 items
        (data.items || []).forEach(function (o) {
            if (o.category === fromName) {
                o.category = toName;
                // 子分类若目标没有则挂到目标 children
            }
        });
        // 合并子分类
        var fromChildren = typeof fromObj === 'object' ? (fromObj.children || []) : [];
        if (typeof toObj !== 'object') {
            toObj = { name: toName, children: [] };
            for (var j = 0; j < nextCats.length; j++) {
                var tn = typeof nextCats[j] === 'object' ? nextCats[j].name : nextCats[j];
                if (tn === toName) { nextCats[j] = toObj; break; }
            }
        }
        if (!Array.isArray(toObj.children)) toObj.children = [];
        fromChildren.forEach(function (sc) {
            if (toObj.children.indexOf(sc) === -1) toObj.children.push(sc);
        });
        nextCats.splice(fromIdx, 1);
        if (isAcc) {
            data.raw.accCategories = nextCats;
            data.raw.accessories = data.items;
            saveCurrent(data.raw);
            fn.renderAccCatbar();
        } else {
            // outfits already mutated in items reference if same array
            saveCatData(data.raw, nextCats);
            // ensure outfits saved
            var curP = loadCurrent();
            saveCurrent(curP);
        }
        refreshLocalData();
        fillMergeSelects();
        rebindEvents();
        toast('已合并：' + fromName + ' → ' + toName);
    });
    var autoClassBtn = sheet.querySelector('#om-cats-autoclass');
    if (autoClassBtn) autoClassBtn.addEventListener('click', function () {
        closeSheet(sheet);
        if (fn.classifyAllUncategorized) fn.classifyAllUncategorized();
    });

sheet.querySelector('#om-newadd').addEventListener('click', function () {
        var name = inp.value.trim(); if (!name) return;
        var data = loadCatData(); var vc = data.cats;
        var names = getCatNames(vc);
        if (names.indexOf(name) !== -1) { toast('分类已存在', true); return; }
        vc.push({ name: name, children: [] }); saveCatData(data.raw, vc);
        refreshLocalData();
        inp.value = '';
        rebindEvents();
        toast('分类「' + name + '」已添加');
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-newadd').click(); });
}

// ── Bottom Sheet 通用创建/关闭 ───────────────────────────
