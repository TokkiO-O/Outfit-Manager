// Outfit Manager · 二改版 | 穿搭标签选择面板
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { load, save } from '../db/index.js';
import { esc, toast } from '../utils.js';
import { closeSheet, createSheet } from './sheet-base.js';

export function getAllTagSuggestions(d) {
    // 收集所有实际使用中的标签
    var found = [];
    d.outfits.forEach(function (o) { if (o.sceneTag && o.sceneTag.trim()) { var t = o.sceneTag.trim(); if (found.indexOf(t) === -1) found.push(t); } });
    if (d.chars) { for (var cn in d.chars) { (d.chars[cn].outfits || []).forEach(function (o) { if (o.sceneTag && o.sceneTag.trim()) { var t = o.sceneTag.trim(); if (found.indexOf(t) === -1) found.push(t); } }); } }
    // 按 tagOrder 排序：先按记忆顺序排，新标签追加到末尾
    var order = d.tagOrder || [];
    var sorted = [];
    order.forEach(function (t) { if (found.indexOf(t) !== -1) sorted.push(t); });
    found.forEach(function (t) { if (sorted.indexOf(t) === -1) sorted.push(t); });
    return sorted;
}

// ── 标签管理面板 ──────────────────────────────────────────
export function openTagPanel(sceneInput) {
    var d = load();
    var allOutfits = d.outfits.slice();
    if (d.chars) { for (var cn in d.chars) { allOutfits = allOutfits.concat(d.chars[cn].outfits || []); } }
    var tags = getAllTagSuggestions(d);

    function countTag(tag) {
        var n = 0;
        allOutfits.forEach(function (o) { if (o.sceneTag && o.sceneTag.trim() === tag) n++; });
        return n;
    }

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-tags"></i>场景标签管理</div>',
        '<div class="om-tagpanel">',
        '<input type="text" class="om-tagpanel-search" id="om-tag-search" placeholder="搜索标签…" autocomplete="off" />',
        '<div class="om-tagpanel-list" id="om-tag-list"></div>',
        '<div class="om-tagpanel-add"><input type="text" id="om-tag-new" placeholder="新标签名称…" /><button class="om-btn om-btn-safe" id="om-tag-add">添加</button></div>',
        '</div>',
    ].join(''));

    var listEl = sheet.querySelector('#om-tag-list');
    var searchInp = sheet.querySelector('#om-tag-search');
    var dragSrcIdx = null;

    function renderTagList(filter) {
        var q = (filter || '').trim().toLowerCase();
        var filtered = q ? tags.filter(function (t) { return t.toLowerCase().indexOf(q) !== -1; }) : tags;

        if (filtered.length === 0) {
            listEl.innerHTML = '<div class="om-tagpanel-empty">' + (q ? '没有匹配的标签' : '还没有标签，添加穿搭时输入场景标签即可') + '</div>';
            return;
        }

        listEl.innerHTML = filtered.map(function (tag, i) {
            var realIdx = tags.indexOf(tag);
            return '<div class="om-tagpanel-item" draggable="true" data-idx="' + realIdx + '">' +
                '<i class="fa-solid fa-grip-vertical om-tagpanel-grip"></i>' +
                '<span class="om-tagpanel-name">' + esc(tag) + '</span>' +
                '<span class="om-tagpanel-count">' + countTag(tag) + '套</span>' +
                '<div class="om-tagpanel-acts">' +
                '<button class="om-tagpanel-use" data-tag="' + esc(tag) + '" title="使用此标签">使用</button>' +
                '<button class="om-tagpanel-del" data-idx="' + realIdx + '" title="删除"><i class="fa-solid fa-trash"></i></button>' +
                '</div></div>';
        }).join('');

        // 拖拽排序
        listEl.querySelectorAll('.om-tagpanel-item').forEach(function (item) {
            item.addEventListener('dragstart', function (e) {
                dragSrcIdx = parseInt(item.dataset.idx);
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('dragend', function () {
                item.classList.remove('dragging');
                listEl.querySelectorAll('.om-tagpanel-item').forEach(function (el) { el.classList.remove('drag-over'); });
                dragSrcIdx = null;
            });
            item.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                listEl.querySelectorAll('.om-tagpanel-item').forEach(function (el) { el.classList.remove('drag-over'); });
                item.classList.add('drag-over');
            });
            item.addEventListener('dragleave', function () {
                item.classList.remove('drag-over');
            });
            item.addEventListener('drop', function (e) {
                e.preventDefault();
                item.classList.remove('drag-over');
                var targetIdx = parseInt(item.dataset.idx);
                if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
                // 执行交换
                var moved = tags.splice(dragSrcIdx, 1)[0];
                tags.splice(targetIdx > dragSrcIdx ? targetIdx - 1 : targetIdx, 0, moved);
                // 持久化标签顺序
                var dd = load(); dd.tagOrder = tags.slice(); save(dd);
                renderTagList(searchInp.value);
                toast('标签已移动');
            });
        });

        // 触屏拖拽排序
        var touchState = { idx: null, el: null, startY: 0, moved: false };
        listEl.querySelectorAll('.om-tagpanel-grip').forEach(function (grip) {
            grip.addEventListener('touchstart', function (e) {
                var item = grip.closest('.om-tagpanel-item');
                touchState.idx = parseInt(item.dataset.idx);
                touchState.el = item;
                touchState.startY = e.touches[0].clientY;
                touchState.moved = false;
                item.classList.add('dragging');
            }, { passive: true });
        });
        listEl.addEventListener('touchmove', function (e) {
            if (touchState.el === null) return;
            var dy = Math.abs(e.touches[0].clientY - touchState.startY);
            if (dy > 8) touchState.moved = true;
            if (touchState.moved) {
                var touch = e.touches[0];
                listEl.querySelectorAll('.om-tagpanel-item').forEach(function (el) {
                    el.classList.remove('drag-over');
                    var rect = el.getBoundingClientRect();
                    if (touch.clientY >= rect.top && touch.clientY <= rect.bottom && el !== touchState.el) {
                        el.classList.add('drag-over');
                    }
                });
            }
        }, { passive: true });
        listEl.addEventListener('touchend', function () {
            if (touchState.el === null) return;
            touchState.el.classList.remove('dragging');
            var overEl = listEl.querySelector('.om-tagpanel-item.drag-over');
            if (overEl && touchState.moved) {
                var targetIdx = parseInt(overEl.dataset.idx);
                var srcIdx = touchState.idx;
                overEl.classList.remove('drag-over');
                if (srcIdx !== targetIdx) {
                    var moved = tags.splice(srcIdx, 1)[0];
                    tags.splice(targetIdx > srcIdx ? targetIdx - 1 : targetIdx, 0, moved);
                    var dd = load(); dd.tagOrder = tags.slice(); save(dd);
                    renderTagList(searchInp.value);
                    toast('标签已移动');
                }
            }
            listEl.querySelectorAll('.om-tagpanel-item').forEach(function (el) { el.classList.remove('drag-over'); });
            touchState = { idx: null, el: null, startY: 0, moved: false };
        }, { passive: true });

        // 使用按钮
        listEl.querySelectorAll('.om-tagpanel-use').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (sceneInput) sceneInput.value = btn.dataset.tag;
                closeSheet(sheet);
                toast('已选择：' + btn.dataset.tag);
            });
        });

        // 删除按钮
        listEl.querySelectorAll('.om-tagpanel-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.dataset.idx);
                var tagName = tags[idx];
                if (!confirm('删除标签「' + tagName + '」？\n（不会删除穿搭，仅清除对应标签）')) return;
                // 清除所有穿搭上的此标签
                var dd = load();
                dd.outfits.forEach(function (o) { if (o.sceneTag && o.sceneTag.trim() === tagName) o.sceneTag = ''; });
                if (dd.chars) { for (var cn2 in dd.chars) { (dd.chars[cn2].outfits || []).forEach(function (o) { if (o.sceneTag && o.sceneTag.trim() === tagName) o.sceneTag = ''; }); } }
                // 从排序记忆中也移除
                var oi = (dd.tagOrder || []).indexOf(tagName); if (oi !== -1) dd.tagOrder.splice(oi, 1);
                save(dd);
                tags.splice(idx, 1);
                // 同步更新 allOutfits 里的数据
                allOutfits.forEach(function (o) { if (o.sceneTag && o.sceneTag.trim() === tagName) o.sceneTag = ''; });
                renderTagList(searchInp.value);
                toast('标签「' + tagName + '」已删除');
            });
        });
    }

    renderTagList('');

    searchInp.addEventListener('input', function () { renderTagList(this.value); });
    setTimeout(function () { searchInp.focus(); }, 100);

    // 添加新标签
    var newInp = sheet.querySelector('#om-tag-new');
    sheet.querySelector('#om-tag-add').addEventListener('click', function () {
        var name = newInp.value.trim();
        if (!name) return;
        if (tags.indexOf(name) !== -1) { toast('标签已存在', true); return; }
        tags.push(name);
        newInp.value = '';
        renderTagList(searchInp.value);
        toast('标签「' + name + '」已添加');
    });
    newInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-tag-add').click(); });
}
