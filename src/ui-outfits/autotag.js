// Outfit Manager · 二改版 | 本地标签建议与待确认项目
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { fn } from '../bridge.js';
import { esc, getPopupLayer, toast } from '../utils.js';
import { resolveGridImageSrc } from './imgqueue.js';

// ── 一键分类全部未分类 ──────────────────────────────────

// ── 一键自动场景标签（无标签穿搭）────────────────────────
export { inferSceneTags, inferSceneTagsDetailed } from '../scene-tags.js';
import { SCENE_PALETTE } from '../scene-tags.js';
export var SCENE_PICK_PALETTE = SCENE_PALETTE;
export var SCENE_FILL_BY = {};

export function openUncertainTagPicker(queue, existingTags, onDone) {
    if (!queue || !queue.length) {
        if (onDone) onDone();
        return;
    }
    var idx = 0;
    var _mp = getPopupLayer();
    var modal = document.createElement('div');
    modal.className = 'om-modal om-result-modal';
    modal.style.zIndex = '2147483646';

    function close() {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        if (onDone) onDone();
    }

    function render() {
        if (idx >= queue.length) {
            close();
            return;
        }
        var item = queue[idx];
        var o = item.outfit;
        var suggested = item.suggested || [];
        var selected = {};
        suggested.forEach(function (t) { selected[t] = true; });
        // 保留已有
        (item.prev || []).forEach(function (t) { selected[t] = true; });

        var palette = SCENE_PICK_PALETTE.slice();
        (existingTags || []).forEach(function (t) {
            if (t && palette.indexOf(t) === -1) palette.push(t);
        });
        suggested.forEach(function (t) {
            if (t && palette.indexOf(t) === -1) palette.unshift(t);
        });

        function chipsHtml() {
            return palette.map(function (tg) {
                var on = selected[tg] ? ' on' : '';
                return '<button type="button" class="om-tag-pick-chip' + on + '" data-tag="' + esc(tg) + '">' + esc(tg) + '</button>';
            }).join('');
        }

        var imgPlaceholder =
            '<div class="om-tag-pick-img-wrap" id="om-tag-pick-img-wrap">' +
            (o.imageData
                ? '<img class="om-tag-pick-img" id="om-tag-pick-img" alt="" />'
                : '<div class="om-tag-pick-img-empty">暂无图片</div>') +
            '</div>';

        modal.innerHTML =
            '<div class="om-modal-box om-result-box" style="max-width:min(480px,94vw)">' +
            '<div class="om-sheet-title" style="margin-bottom:6px">场景标签 · 请确认 (' + (idx + 1) + '/' + queue.length + ')</div>' +
            '<div class="om-hint" style="margin-bottom:8px">看图选标签；可新建。建议 2～4 个</div>' +
            imgPlaceholder +
            '<div style="font-weight:700;margin:8px 0 4px">' + esc(o.name || '未命名') + '</div>' +
            (o.category ? '<div class="om-hint" style="margin-bottom:6px">分类：' + esc(o.category) + (o.subCategory ? ' / ' + esc(o.subCategory) : '') + '</div>' : '') +
            (item.reason ? '<div class="om-hint" style="margin-bottom:6px;opacity:.75">系统：' + esc(item.reason) + '</div>' : '') +
            '<div class="om-tag-pick-grid" id="om-tag-pick-grid">' + chipsHtml() + '</div>' +
            '<div class="om-btn-row" style="margin-top:10px;gap:6px;flex-wrap:wrap">' +
            '<input type="text" id="om-tag-pick-new" placeholder="新建标签，如：温泉" style="flex:1;min-width:120px" />' +
            '<button type="button" class="om-btn om-btn-outline" id="om-tag-pick-add">添加</button>' +
            '</div>' +
            '<div class="om-btn-row" style="margin-top:12px;gap:8px;flex-wrap:wrap">' +
            '<button type="button" class="om-btn om-btn-outline" id="om-tag-pick-skip">跳过</button>' +
            '<button type="button" class="om-btn om-btn-outline" id="om-tag-pick-skipall">全部跳过</button>' +
            '<button type="button" class="om-btn om-btn-outline" id="om-tag-pick-applyrest">此标签用于剩余</button>' +
            '<button type="button" class="om-btn om-btn-safe" id="om-tag-pick-ok" style="flex:1">确认</button>' +
            '</div></div>';

        _mp.appendChild(modal);

        // 加载预览图（支持 dataURL / 服务器路径）
        var imgEl = modal.querySelector('#om-tag-pick-img');
        if (imgEl && o.imageData) {
            imgEl.alt = o.name || '';
            if (typeof resolveGridImageSrc === 'function') {
                resolveGridImageSrc(o.imageData, o.id, function (url) {
                    if (!url) {
                        // 回退直接用原始
                        imgEl.src = o.imageData;
                        return;
                    }
                    imgEl.src = url;
                });
            } else {
                imgEl.src = o.imageData;
            }
            imgEl.addEventListener('click', function () {
                if (typeof fn.openLightbox === 'function') {
                    fn.openLightbox([o], o.id);
                }
            });
            imgEl.title = '点击放大';
        }

        var grid = modal.querySelector('#om-tag-pick-grid');
        function refreshChips() {
            grid.innerHTML = chipsHtml();
            bindChips();
        }
        function bindChips() {
            grid.querySelectorAll('.om-tag-pick-chip').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var tg = btn.getAttribute('data-tag');
                    if (selected[tg]) delete selected[tg];
                    else selected[tg] = true;
                    refreshChips();
                });
            });
        }
        bindChips();

        modal.querySelector('#om-tag-pick-add').addEventListener('click', function () {
            var inp = modal.querySelector('#om-tag-pick-new');
            var v = (inp.value || '').trim();
            if (!v) return;
            // 支持一次输入多个：顿号/逗号分隔
            v.split(/[,，、/|]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (tg) {
                selected[tg] = true;
                if (palette.indexOf(tg) === -1) palette.unshift(tg);
                if (existingTags.indexOf(tg) === -1) existingTags.push(tg);
            });
            inp.value = '';
            refreshChips();
        });
        modal.querySelector('#om-tag-pick-new').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                modal.querySelector('#om-tag-pick-add').click();
            }
        });
        modal.querySelector('#om-tag-pick-skip').addEventListener('click', function () {
            idx++;
            if (modal.parentNode) modal.parentNode.removeChild(modal);
            render();
        });
        modal.querySelector('#om-tag-pick-skipall').addEventListener('click', function () {
            idx = queue.length;
            close();
        });
        modal.querySelector('#om-tag-pick-ok').addEventListener('click', function () {
            var tags = Object.keys(selected).filter(Boolean).slice(0, 6);
            if (!tags.length) {
                toast('请至少选 1 个标签，或点跳过', true);
                return;
            }
            o.sceneTag = tags.join('、');
            idx++;
            if (modal.parentNode) modal.parentNode.removeChild(modal);
            render();
        });
        var applyRest = modal.querySelector('#om-tag-pick-applyrest');
        if (applyRest) applyRest.addEventListener('click', function () {
            var tags = Object.keys(selected).filter(Boolean).slice(0, 6);
            if (!tags.length) {
                toast('请先选好标签', true);
                return;
            }
            var joined = tags.join('、');
            o.sceneTag = joined;
            var n = 1;
            for (var j = idx + 1; j < queue.length; j++) {
                queue[j].outfit.sceneTag = joined;
                n++;
            }
            toast('已将「' + joined + '」应用到 ' + n + ' 件');
            idx = queue.length;
            if (modal.parentNode) modal.parentNode.removeChild(modal);
            close();
        });
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                // 点遮罩不关闭，避免误触丢进度
            }
        });
    }
    render();
}
