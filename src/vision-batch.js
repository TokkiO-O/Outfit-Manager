// Outfit Manager · 二改版 | 识图描述的队列、进度与停止
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { currentPartKey, ensurePartitionLoaded, loadMeta, savePartition } from './db/index.js';

var worker = null, queue = [], active = 0, applyTail = Promise.resolve();
export function registerVisionWorker(value) { worker = value; }
export function imageFingerprint(value) {
    var text = String(value || ''), a = 2166136261, b = 5381;
    for (var i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
    return text.length + ':' + (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16);
}
function loadPart(key) { return new Promise(function (resolve, reject) { ensurePartitionLoaded(key, function (part) { if (part) resolve(part); else reject(new Error('源衣柜未能载入')); }); }); }
function itemIn(part, job, id) { return (job.kind === 'accessory' ? part.accessories || [] : part.outfits || []).find(function (item) { return item.id === id; }); }
function addCategory(part, name, sub) {
    if (!name) return false;
    if (!Array.isArray(part.categories)) part.categories = [];
    var category = part.categories.find(function (item) { return (typeof item === 'string' ? item : item.name) === name; }), created = !category;
    if (!category) { category = { name: name, children: [] }; part.categories.push(category); }
    if (sub) {
        if (typeof category === 'string') { var index = part.categories.indexOf(category); category = { name: name, children: [] }; part.categories[index] = category; }
        if (!Array.isArray(category.children)) category.children = [];
        if (category.children.indexOf(sub) === -1) category.children.push(sub);
    }
    return created;
}
async function applyResult(job, item, result) {
    var part = await loadPart(job.partKey), target = itemIn(part, job, item.id);
    if (job.controller.signal.aborted) throw new Error('已取消');
    if (!target || imageFingerprint(target.imageData) !== result.imageFingerprint ||
        Object.keys(result.changes).some(function (field) { return (target[field] || '') !== (result.before[field] || ''); })) {
        throw new Error('生成期间内容或图片已变更，已保留你的修改；需要时可重新生成');
    }
    Object.assign(target, result.changes);
    var created = job.kind !== 'accessory' && addCategory(part, target.category, target.subCategory);
    var saved = await new Promise(function (resolve) { if (!savePartition(job.partKey, part, resolve)) resolve(false); });
    if (!saved) throw new Error('已生成，但本地保存失败；结果仍在当前页面，请导出备份后重试保存');
    if (Object.prototype.hasOwnProperty.call(result.changes, 'description')) job.stats.descSuccess++;
    if (Object.prototype.hasOwnProperty.call(result.changes, 'category')) {
        job.stats.classSuccess++;
        if (created && job.stats.createdCategories.indexOf(target.category) === -1) job.stats.createdCategories.push(target.category);
        job.stats.assigned.push({ id: item.id, name: target.name, prevCategory: result.before.category, prevSubCategory: result.before.subCategory,
            category: target.category, subCategory: target.subCategory, isNew: !!created, lowConfidence: !!result.lowConfidence });
    }
}
function completeItem(job, item, error) {
    if (error) job.errors.push({ id: item.id, name: item.name, error: error.message || String(error) });
    job.completed++;
    if (job.progress) { try { job.progress(job.completed, job.items.length, '已处理 ' + job.completed + '/' + job.items.length); } catch (e) {} }
    if (job.completed === job.items.length) {
        if (job.done) job.done(null, job.items.length, job.errors, job.stats);
        job.apiConfig = null;
    }
}
function pump() {
    if (!worker) return;
    var limit = Math.max(1, Math.min(4, Number((loadMeta().apiVision || {}).concurrency) || 2));
    while (active < limit && queue.length) {
        var task = queue.shift();
        run(task.job, task.item);
    }
}
function run(job, item) {
    active++;
    Promise.resolve().then(function () {
        if (job.controller.signal.aborted) throw new Error('已取消');
        return worker(job, item, job.controller.signal);
    }).then(function (result) {
        // Apply only to the captured wardrobe, and serialize writes from concurrent requests.
        var applied = applyTail.catch(function () {}).then(function () { return applyResult(job, item, result); });
        applyTail = applied; return applied;
    }).then(function () { completeItem(job, item); }, function (error) { completeItem(job, item, error); })
        .finally(function () { active--; pump(); });
}
export function runVisionBatch(kind, ids, options, progress, done) {
    options = Object.assign({}, options || {});
    var job = { kind: kind, partKey: options.sourcePartKey || currentPartKey(), options: options, progress: progress, done: done,
        apiConfig: Object.assign({}, loadMeta().apiVision || {}), controller: new AbortController(), items: [], errors: [], completed: 0,
        stats: { descTarget: 0, classTarget: 0, descSuccess: 0, classSuccess: 0, assigned: [], createdCategories: [] } };
    loadPart(job.partKey).then(function (part) {
        var cfg = job.apiConfig;
        if (!cfg.endpoint || !cfg.key || !cfg.model) throw new Error('请先在设置中配置描述 API');
        var overwrite = options.overwriteDescription !== undefined ? options.overwriteDescription : !!cfg.overwrite;
        Array.from(new Set(ids || [])).forEach(function (id) {
            var item = itemIn(part, job, id);
            if (!item || !item.imageData) return;
            var needsDescription = kind !== 'classify' && (!item.description || !item.description.trim() || overwrite);
            if (!needsDescription && kind !== 'classify' && !options.autoClassify) return;
            if (needsDescription) job.stats.descTarget++;
            if (kind === 'classify' || options.autoClassify) job.stats.classTarget++;
            job.items.push({ id: id, name: item.name || '未命名' });
        });
        if (!job.items.length) { if (done) done(null, 0, [], job.stats); job.apiConfig = null; return; }
        job.items.forEach(function (item) { queue.push({ job: job, item: item }); });
        pump();
    }).catch(function (error) { job.apiConfig = null; if (done) done(error.message || String(error), 0, [], job.stats); });
    return { cancel: function () { job.controller.abort(); } };
}
