// Outfit Manager · 二改版 | 本地与图片标签的预览、确认和保存
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { currentPartKey, loadCurrent, loadMeta, ensurePartitionLoaded, savePartition, resolveImageForExternal } from './db/index.js';
import { callVisionAPI } from './api.js';
import { imageFingerprint } from './vision-batch.js';
import { inferSceneTagsDetailed, validateAITags, buildSceneTagUpdate, AUTOMATIC_SCENES } from './scene-tags.js';
import { createSheet, closeSheet } from './ui-sheets/sheet-base.js';
import { fn, state } from './bridge.js';
import { esc, toast } from './utils.js';

function signature(item) {
    return JSON.stringify([item.name || '', item.description || '', item.category || '', item.subCategory || '',
        item.sceneTag || '', item._omTagSource || null, imageFingerprint(item.imageData)]);
}
function suggestion(result) { return Object.assign({}, result, { checked: !!result.confident }); }

export function openTagReview() {
    var source = currentPartKey(), part = loadCurrent(), mode = 'local', scope = 'repair', page = 0, filter = 'changes';
    var running = false, saving = false, closed = false, controller = null, progress = '';
    var selected = state.batchMode && state.batchSelected.length ? state.batchSelected.slice() : null;
    var rows = (part.outfits || []).filter(function (item) { return !selected || selected.includes(item.id); }).map(function (item) {
        var beforeSource = item._omTagSource ? JSON.parse(JSON.stringify(item._omTagSource)) : null;
        return { id: item.id, name: item.name || '未命名', signature: signature(item), hasImage: !!item.imageData,
            before: item.sceneTag || '', beforeSource: beforeSource,
            automatic: !!(beforeSource && beforeSource.appliedValue === item.sceneTag && Array.isArray(beforeSource.tags) && beforeSource.tags.length),
            local: suggestion(inferSceneTagsDetailed(item)), vision: null };
    });
    rows.forEach(function (row) {
        if (row.automatic && row.beforeSource.tags.includes('日常') && !row.local.confident) {
            row.local = suggestion({ tags: [], confident: true, reason: '移除旧规则自动添加的泛用“日常”；保留手工标签，可补充描述后再推荐' });
        }
    });
    var sheet = createSheet('<div class="om-sheet-title"><i class="fa-solid fa-tags"></i>标签</div>' +
        '<div class="om-feature-content om-tag-workspace">' +
        '<p class="om-hint om-tag-intro">' + (selected ? '多选中的 ' + rows.length + ' 套' : '当前衣柜 · ' + rows.length + ' 套') + '，按时代、风格和用途整理，不拿场景词凑数。</p>' +
        '<div class="om-tag-methods" role="tablist" aria-label="标签判断方式">' +
        '<button type="button" class="om-tag-method on" role="tab" aria-selected="true" data-tag-method="local"><i class="fa-solid fa-bolt"></i><span>本地规则<small>不用 API</small></span></button>' +
        '<button type="button" class="om-tag-method" role="tab" aria-selected="false" data-tag-method="vision"><i class="fa-solid fa-image"></i><span>图片识别<small>需识图 API</small></span></button></div>' +
        '<label class="om-tag-scope">处理范围<select id="om-tags-scope"><option value="repair">无标签 + 重新检查自动标签</option><option value="missing">只补无标签</option><option value="all">全部 · 保留手工标签</option><option value="replace">重做全部 · 替换原标签</option></select></label>' +
        '<p class="om-hint" id="om-tags-method-hint">根据名称、分类和描述中的用途、服装组合判断。</p>' +
        '<div class="om-tag-stats" id="om-tags-stats"></div><p class="om-hint" id="om-tags-retained"></p>' +
        '<div class="om-tag-vision" id="om-tags-vision" hidden>' +
        '<label class="om-tag-scope">识别图片<select id="om-tags-vision-range"><option value="uncertain">仅本地无法判断的服装</option><option value="all">处理范围内的全部图片</option></select></label>' +
        '<p class="om-hint" id="om-tags-api-count"></p><div class="om-feature-actions"><button type="button" class="om-btn om-btn-outline" id="om-tags-ai">开始识别</button><button type="button" class="om-btn om-btn-outline" id="om-tags-stop" hidden>停止识别</button></div></div>' +
        '<p class="om-tag-progress" id="om-tags-progress" role="status" aria-live="polite"></p>' +
        '<details class="om-tag-details" id="om-tags-details"><summary>按需查看建议与待判断 <span id="om-tags-details-count"></span></summary>' +
        '<div class="om-tag-review-tools"><label>查看<select id="om-tags-filter"><option value="changes">有变更的建议</option><option value="uncertain">暂不自动判断</option></select></label><span>每页最多 8 套</span></div>' +
        '<div id="om-tags-rows"></div><div id="om-tags-pages"></div></details>' +
        '<div class="om-edit-foot om-tag-footer"><button type="button" class="om-btn om-btn-safe" id="om-tags-apply">应用本地标签</button><button type="button" class="om-btn om-btn-outline" id="om-tags-close">关闭</button></div>' +
        '<p class="om-hint om-tag-footnote" id="om-tags-footnote">默认保留手工标签；不能判断的保持原样。更新后可在“操作撤销”恢复。</p></div>',
        { modal: true, medium: true, onClose: function () { closed = true; if (controller) controller.abort(); } });
    var details = sheet.querySelector('#om-tags-details');
    function result(row) { return row[mode]; }
    function eligible(row) { return scope === 'all' || scope === 'replace' || !row.before.trim() || (scope === 'repair' && row.automatic); }
    function beforeItem(row) { return { sceneTag: row.before, _omTagSource: row.beforeSource }; }
    function change(row) { var value = result(row); return value && (value.confident || value.edited) ? buildSceneTagUpdate(beforeItem(row), value, mode, scope === 'replace') : null; }
    function changed(row) { var update = change(row); return update && update.changed; }
    function ready(row) { return eligible(row) && result(row) && result(row).checked && changed(row); }
    function visionRows() {
        var range = sheet.querySelector('#om-tags-vision-range').value;
        return rows.filter(function (row) { return eligible(row) && row.hasImage && (range === 'all' || !row.local.confident); });
    }
    function reviewRows() {
        return rows.filter(function (row) { return eligible(row) && (filter === 'changes' ? changed(row) : !result(row) || !result(row).confident && !result(row).edited); });
    }
    function renderDetails() {
        if (!details.open) { sheet.querySelector('#om-tags-rows').innerHTML = ''; sheet.querySelector('#om-tags-pages').innerHTML = ''; return; }
        var list = reviewRows(), pages = Math.max(1, Math.ceil(list.length / 8));
        page = Math.max(0, Math.min(page, pages - 1));
        sheet.querySelector('#om-tags-rows').innerHTML = list.slice(page * 8, page * 8 + 8).map(function (row) {
            var value = result(row), update = change(row), index = rows.indexOf(row);
            return '<section class="om-tag-row" data-tag-row="' + index + '">' +
                '<label class="om-tag-row-title"><input type="checkbox" data-tag-check' + (value && value.checked ? ' checked' : '') + (running || saving || !value || !value.confident && !value.edited ? ' disabled' : '') + '> <strong>' + esc(row.name) + '</strong></label>' +
                '<div class="om-tag-row-change"><span>' + esc(row.before || '无标签') + '</span><span aria-hidden="true">→</span><strong>' + esc(update ? update.sceneTag || '无标签' : value && value.tags.length ? value.tags.join('、') : '保持原样') + '</strong></div>' +
                '<input data-tag-value' + (running || saving ? ' disabled' : '') + ' aria-label="' + esc(row.name) + '的建议标签" value="' + esc(value ? value.tags.join('、') : '') + '" placeholder="可手动填写，以顿号分隔">' +
                '<p class="om-hint">' + esc(value ? value.reason : '尚未识别，可手动填写标签') + '</p></section>';
        }).join('') || '<p class="om-hint om-tag-empty">这一项没有需要检查的服装。</p>';
        sheet.querySelector('#om-tags-pages').innerHTML = pages > 1 ? '<div class="om-feature-actions"><button type="button" class="om-btn om-btn-outline" data-tag-page="-1"' + (!page ? ' disabled' : '') + '>上一页</button><span>' + (page + 1) + ' / ' + pages + '</span><button type="button" class="om-btn om-btn-outline" data-tag-page="1"' + (page + 1 >= pages ? ' disabled' : '') + '>下一页</button></div>' : '';
    }
    function render(updateDetails) {
        var active = rows.filter(eligible), count = active.filter(ready).length;
        var additions = active.filter(function (row) { return ready(row) && !row.before.trim(); }).length;
        var uncertain = active.filter(function (row) { var value = result(row); return !value || !value.confident && !value.edited; }).length;
        sheet.querySelector('#om-tags-stats').innerHTML = [['可补充', additions], ['可更新', count - additions], [mode === 'vision' ? '待识别 / 待确认' : '暂不判断', uncertain]].map(function (pair) { return '<div><strong>' + pair[1] + '</strong><span>' + pair[0] + '</span></div>'; }).join('');
        sheet.querySelector('#om-tags-retained').textContent = '处理 ' + active.length + ' 套 · 保留范围外 ' + (rows.length - active.length) + ' 套' + (mode === 'local' ? ' · 全程不调用 API' : ' · 识别结果不会自动写入');
        sheet.querySelector('#om-tags-footnote').textContent = scope === 'replace' ? '重做模式：有可靠建议的服装会替换原标签（含手工标签）；无法判断的保持原样。可在操作撤销中恢复。' : '保留手工标签；不能判断的保持原样。更新后可在“操作撤销”恢复。';
        sheet.querySelectorAll('[data-tag-method]').forEach(function (button) { var on = button.dataset.tagMethod === mode; button.classList.toggle('on', on); button.setAttribute('aria-selected', String(on)); button.disabled = running || saving; });
        sheet.querySelector('#om-tags-scope').disabled = running || saving;
        sheet.querySelector('#om-tags-vision-range').disabled = running || saving;
        sheet.querySelector('#om-tags-vision').hidden = mode !== 'vision';
        sheet.querySelector('#om-tags-method-hint').textContent = mode === 'local' ? '先识别古代／近代／现代，再识别汉服、洛丽塔、JK等风格，最后补有依据的用途；拍照、节庆只认明确用途，本地不读取图片。' : '使用设置中的描述生成 / 识图 API。可以先看预计请求数量，再开始识别。';
        var images = visionRows().length, apply = sheet.querySelector('#om-tags-apply');
        sheet.querySelector('#om-tags-api-count').textContent = images ? '本次 ' + images + ' 张图片，预计至多 ' + images + ' 次识图请求；会使用接口额度。' : '当前范围没有需要识别的图片。';
        sheet.querySelector('#om-tags-ai').textContent = '识别 ' + images + ' 张图片';
        sheet.querySelector('#om-tags-ai').disabled = running || saving || !images;
        sheet.querySelector('#om-tags-stop').hidden = !running;
        apply.textContent = (mode === 'local' ? '应用本地标签' : '应用识别结果') + (count ? ' · ' + count + ' 套' : '');
        apply.disabled = running || saving || !count;
        sheet.querySelector('#om-tags-progress').textContent = progress;
        sheet.querySelector('#om-tags-details-count').textContent = '（' + active.filter(changed).length + ' 套有建议）';
        if (updateDetails !== false) renderDetails();
    }
    sheet.querySelector('#om-tags-close').onclick = function () { closeSheet(sheet); };
    details.addEventListener('toggle', function () { renderDetails(); });
    sheet.addEventListener('click', function (event) {
        var method = event.target.closest('[data-tag-method]');
        if (method && !running && !saving) { mode = method.dataset.tagMethod; page = 0; progress = ''; render(); }
        var pager = event.target.closest('[data-tag-page]');
        if (pager) { page += Number(pager.dataset.tagPage); renderDetails(); }
    });
    sheet.addEventListener('change', function (event) {
        if (event.target.id === 'om-tags-scope') { scope = event.target.value; page = 0; render(); return; }
        if (event.target.id === 'om-tags-vision-range') { render(false); return; }
        if (event.target.id === 'om-tags-filter') { filter = event.target.value; page = 0; renderDetails(); return; }
        var section = event.target.closest('[data-tag-row]'); if (!section || running || saving) return;
        var row = rows[Number(section.dataset.tagRow)], value = result(row);
        if (event.target.matches('[data-tag-check]') && value) value.checked = event.target.checked;
        if (event.target.matches('[data-tag-value]')) {
            value = row[mode] = Object.assign({}, value || {}, { tags: Array.from(new Set(event.target.value.split(/[,，、/|\n]/).map(function (tag) { return tag.trim(); }).filter(Boolean))), edited: true, checked: true, confident: true, reason: '已手动调整；原有手工标签仍保留' });
            section.querySelector('[data-tag-check]').disabled = false; section.querySelector('[data-tag-check]').checked = true;
            section.querySelector('.om-tag-row-change strong').textContent = buildSceneTagUpdate(beforeItem(row), value, mode, scope === 'replace').sceneTag || '无标签';
        }
        render(false);
    });
    sheet.querySelector('#om-tags-stop').onclick = function () { if (controller) controller.abort(); };
    sheet.querySelector('#om-tags-ai').onclick = async function () {
        if (running || saving) return;
        var cfg = Object.assign({}, loadMeta().apiVision || {});
        if (!cfg.endpoint || !cfg.key || !cfg.model) { toast('请先在设置中配置描述生成 / 识图 API', true); return; }
        var work = visionRows(); if (!work.length) return;
        controller = new AbortController(); var signal = controller.signal;
        running = true; var next = 0, done = 0, failed = 0;
        progress = '识别中 0 / ' + work.length; render();
        var prompt = '依据服装图片与资料整理标签，分三类：时代（古代、近代、现代，最多一项）、风格（如汉服、洛丽塔、JK，最多两项）、用途（最多两项）。汉服不能因为被拍成照片就标拍照，也不能因为古装、花纹或装饰就标节庆。拍照或节庆必须有明确用途证据；蕾丝、露肩、性感不能单独证明约会、派对或私密。不要根据摄影背景或人物判断。只从以下词中选择最多五项：' + AUTOMATIC_SCENES.join('、') +
            '。只回复JSON：{"tags":[{"tag":"标签","confidence":0.9,"evidence":"具体服装形制、类型或用途依据"}]}。可确认时代或款式就先给出对应标签，不必为缺少用途而全部留空；真实不明才返回空数组。';
        async function worker() {
            while (next < work.length && !signal.aborted && !closed) {
                var row = work[next++], item = (part.outfits || []).find(function (value) { return value.id === row.id; });
                try {
                    if (!item || signature(item) !== row.signature) throw new Error('服装资料已变化，请重新打开标签页');
                    var image = await new Promise(function (resolve) { resolveImageForExternal(item.imageData, resolve); });
                    if (signal.aborted || closed) break;
                    if (!image) throw new Error('图片未能读取');
                    var text = await new Promise(function (resolve, reject) {
                        callVisionAPI(cfg, { dataUrl: image }, prompt + '\n服装资料：' + JSON.stringify({ name: item.name, description: item.description, category: item.category, subCategory: item.subCategory }),
                            function (error, value) { if (error) reject(new Error(error)); else resolve(value); }, { signal: signal });
                    });
                    if (signal.aborted || closed) break;
                    var match = text.match(/\{[\s\S]*\}/);
                    row.vision = suggestion(validateAITags(JSON.parse(match ? match[0] : text)));
                } catch (error) {
                    if (signal.aborted || closed) break;
                    row.vision = { tags: [], confident: false, checked: false, reason: '识别未完成：' + (error.message || '请重试') }; failed++;
                }
                done++; progress = '已识别 ' + done + ' / ' + work.length + (failed ? ' · ' + failed + ' 套未成功' : '');
                if (!closed) sheet.querySelector('#om-tags-progress').textContent = progress;
            }
        }
        try { await Promise.all([worker(), worker()]); }
        finally {
            running = false;
            progress = (signal.aborted ? '已停止，保留已完成的结果。' : '识别结束。') + '完成 ' + done + ' / ' + work.length + (failed ? '，其中 ' + failed + ' 套未成功' : '') + '，检查后应用。';
            if (!closed) render();
        }
    };
    sheet.querySelector('#om-tags-apply').onclick = async function () {
        if (running || saving) return;
        var changes = rows.filter(ready); if (!changes.length) return;
        saving = true; render(false);
        try {
            var current = await new Promise(function (resolve) { ensurePartitionLoaded(source, resolve); });
            if (!current) throw new Error('源衣柜未能载入');
            var undo = [], conflicts = 0, updates = new Map();
            changes.forEach(function (row) {
                var item = (current.outfits || []).find(function (value) { return value.id === row.id; });
                if (!item || signature(item) !== row.signature) { conflicts++; return; }
                var update = buildSceneTagUpdate(item, result(row), mode, scope === 'replace');
                if (!update.changed) return;
                undo.push({ id: item.id, prevTag: item.sceneTag || '', prevSource: item._omTagSource || null });
                var next = Object.assign({}, item, { sceneTag: update.sceneTag });
                if (update.source) next._omTagSource = update.source; else delete next._omTagSource;
                updates.set(item.id, next);
            });
            if (!updates.size) { progress = conflicts ? '服装资料已有修改，已全部保留。请重新打开标签页。' : '没有需要更新的标签。'; return; }
            var staged = Object.assign({}, current, { outfits: (current.outfits || []).map(function (item) { return updates.get(item.id) || item; }) });
            var accepted = false, saved = await new Promise(function (resolve) { accepted = savePartition(source, staged, resolve); if (!accepted) resolve(false); });
            if (accepted) {
                var entry = { id: 'tags_' + Date.now(), ts: Date.now(), type: 'batch_tag', partKey: source, label: (mode === 'local' ? '本地场景标签' : '图片识别标签'), payload: { items: undo } };
                if (fn.pushActionUndo) fn.pushActionUndo(entry); else { state.actionUndoStack.unshift(entry); state.actionUndoStack.length = Math.min(30, state.actionUndoStack.length); }
                if (fn.requestWardrobeRefresh) fn.requestWardrobeRefresh(source);
            }
            if (!saved) throw new Error(accepted ? '标签尚未保存成功，可在操作撤销中恢复；请检查存储空间' : '标签保存失败，请稍后重试');
            toast('已更新 ' + undo.length + ' 套标签' + (conflicts ? '，保留 ' + conflicts + ' 套期间有修改的服装' : '') + '，可在操作撤销中恢复');
            closeSheet(sheet);
        } catch (error) { toast(error.message, true); progress = error.message; }
        finally { saving = false; if (!closed) render(); }
    };
    render();
    return sheet;
}
