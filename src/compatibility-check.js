// Outfit Manager · 二改版 | 手动兼容性检查，不对扩展作无证据归因
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, STORE_NAME, isPluginVersionAtLeast, MIN_SERVER_PLUGIN_VERSION } from './db/state.js';
import { getChatContext, getChatState, getWardrobeView, getBoundPresetId } from './chat-state.js';
import { OM_VERSION } from './version.js';
import { diagnosticErrorKind, getCompatibilityRecord, safeExtensionId } from './compatibility-journal.js';
import { getCompatibilityHookState, inspectCompatibilityFetch } from './compatibility-probe.js';
import { getRuntimeErrors } from './runtime-errors.js';
import { probeClickRoute, probeOcclusion, probeStyleImpact } from './compatibility-functional.js';
import { buildCompatibilityRelations, compareCompatibilityBaseline } from './compatibility-relations.js';
import { runInjectionSelfTest } from './inject.js';
import { explainRuntimeError } from './runtime-error-reasons.js';

function version(value) { return typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?$/.test(value) && value.length < 50 ? value : null; }
function count(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null; }
function row(id, status, title, detail, advice) { return { id: id, status: status, title: title, detail: detail, advice: advice || '' }; }
function timeout(promise, ms, fallback) {
    var timer;
    return Promise.race([Promise.resolve(promise), new Promise(function (resolve) { timer = setTimeout(function () { resolve(fallback); }, ms); })]).finally(function () { clearTimeout(timer); });
}
function scriptId(raw) {
    try { var url = new URL(raw, location.href), match = url.pathname.match(/^\/scripts\/extensions\/((?:third-party\/)?[^/]+)\//); return url.origin === location.origin && match ? safeExtensionId(decodeURIComponent(match[1])) : null; }
    catch (error) { return null; }
}
async function readJson(path, signal, ms) {
    var controller = new AbortController(), timer, abort = function () { controller.abort(); };
    try {
        if (signal && signal.aborted) return { ok: false, status: 0, reason: 'aborted' };
        if (signal) signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(abort, ms || 1800);
        var response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) return { ok: false, status: response.status };
        var text = '';
        if (response.body && response.body.getReader) {
            var reader = response.body.getReader(), decoder = new TextDecoder(), bytes = 0;
            try {
                while (true) {
                    var part = await reader.read(); if (part.done) break;
                    bytes += part.value.byteLength;
                    if (bytes > 65536) { await reader.cancel(); return { ok: false, status: response.status, reason: 'too-large' }; }
                    text += decoder.decode(part.value, { stream: true });
                }
                text += decoder.decode();
            } finally { reader.releaseLock(); }
        } else text = await response.text();
        if (text.length > 65536) return { ok: false, status: response.status, reason: 'too-large' };
        return { ok: true, status: response.status, data: JSON.parse(text) };
    } catch (error) { return { ok: false, status: 0, reason: diagnosticErrorKind(error) }; }
    finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); }
}

function environment() {
    var ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '', browser = 'unknown', major = null;
    var match = ua.match(/(Edg|Firefox|Chrome|Version)\/(\d+)/);
    if (match) { browser = { Edg: 'Edge', Firefox: 'Firefox', Chrome: 'Chrome', Version: 'Safari' }[match[1]]; major = Number(match[2]); }
    // Chromium's UA also contains Chrome before Edg.
    var edge = ua.match(/Edg(?:A|iOS)?\/(\d+)/); if (edge) { browser = 'Edge'; major = Number(edge[1]); }
    var platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'unknown';
    var result = { browser: browser, browserMajor: major, platform: platform, mobile: /Mobi|Android|iPhone|iPad/i.test(ua), deviceMemoryGiB: count(navigator.deviceMemory), hostVersion: null, heapMiB: null, heapLimitMiB: null };
    try { if (performance.memory) { result.heapMiB = count(performance.memory.usedJSHeapSize / 1048576); result.heapLimitMiB = count(performance.memory.jsHeapSizeLimit / 1048576); } } catch (error) {}
    return result;
}

export function probeCompatibilityStorage(signal) {
    return new Promise(function (resolve) {
        var tx, done = false, verified = false, timer;
        function finish(result) { if (done) return; done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); resolve(result); }
        function abort() { try { if (tx) tx.abort(); } catch (error) {} finish({ ok: false, reason: 'aborted' }); }
        if (signal && signal.aborted) { abort(); return; }
        if (signal) signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(function () { try { if (tx) tx.abort(); } catch (error) {} finish({ ok: false, reason: 'timeout' }); }, 1800);
        try {
            if (!DB.dbInstance) { finish({ ok: false, reason: 'not-open' }); return; }
            var key = 'om_compatibility_probe_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
            tx = DB.dbInstance.transaction(STORE_NAME, 'readwrite');
            tx.oncomplete = function () { finish({ ok: verified, reason: verified ? null : 'readback' }); };
            tx.onerror = tx.onabort = function () { finish({ ok: false, reason: diagnosticErrorKind(tx.error) }); };
            var store = tx.objectStore(STORE_NAME), put = store.put({ probe: true }, key);
            put.onsuccess = function () {
                var get = store.get(key);
                get.onsuccess = function () { verified = !!(get.result && get.result.probe === true); store.delete(key); };
            };
        } catch (error) { try { if (tx) tx.abort(); } catch (ignored) {} finish({ ok: false, reason: diagnosticErrorKind(error) }); }
    });
}

async function mutationProbe() {
    if (typeof MutationObserver !== 'function') return 'missing';
    var observer, timer;
    try {
        return await new Promise(function (resolve) {
            var node = document.createElement('div');
            observer = new MutationObserver(function () { resolve('observed'); });
            observer.observe(node, { childList: true });
            node.appendChild(document.createTextNode(''));
            timer = setTimeout(function () { resolve('timeout'); }, 250);
        });
    } catch (error) { return 'failed'; }
    finally { clearTimeout(timer); if (observer) observer.disconnect(); }
}

async function extensions(context, signal) {
    var loaded = new Map(), currentId = scriptId(import.meta.url), truncated = false;
    document.querySelectorAll('script[src]').forEach(function (script) {
        if (script.type && !['module', 'text/javascript', 'application/javascript'].includes(script.type.toLowerCase())) return;
        var id = scriptId(script.src); if (!id) return;
        var entry = loaded.get(id) || { count: 0, version: null }; entry.count++;
        try { entry.version = version(new URL(script.src).searchParams.get('ver')) || entry.version; } catch (error) {}
        loaded.set(id, entry);
    });
    if (currentId && !loaded.has(currentId)) loaded.set(currentId, { count: 1, version: OM_VERSION });
    var response = await readJson('/api/extensions/discover', signal), disabled = context && context.extensionSettings && context.extensionSettings.disabledExtensions;
    var discovered = response.ok && Array.isArray(response.data), list = discovered ? response.data : [];
    var rows = [], seen = new Set();
    list.slice(0, 200).forEach(function (item) {
        var id = item && safeExtensionId(item.name); if (!id || seen.has(id)) return; seen.add(id);
        rows.push({ id: id, version: loaded.get(id) && loaded.get(id).version || null, enabled: Array.isArray(disabled) ? disabled.indexOf(id) === -1 : null, scriptLoaded: loaded.has(id), outfitManager: id === currentId || /outfit.?manager/i.test(id), duplicateScriptTags: loaded.get(id) ? loaded.get(id).count : 0 });
    });
    loaded.forEach(function (entry, id) { if (!seen.has(id)) rows.push({ id: id, version: entry.version, enabled: null, scriptLoaded: true, outfitManager: id === currentId || /outfit.?manager/i.test(id), duplicateScriptTags: entry.count }); });
    truncated = list.length > 200;
    // Only loaded entry points: never load another extension's JS to inspect it.
    var targets = rows.filter(function (item) { return item.scriptLoaded; }).slice(0, 40), cursor = 0, deadline = Date.now() + 3500;
    await Promise.all([0, 1, 2, 3].map(async function () {
        while (cursor < targets.length && Date.now() < deadline && !(signal && signal.aborted)) {
            var item = targets[cursor++], path = '/scripts/extensions/' + item.id.split('/').map(encodeURIComponent).join('/') + '/manifest.json';
            var manifest = await readJson(path, signal, Math.min(1000, Math.max(1, deadline - Date.now())));
            if (manifest.ok && manifest.data && typeof manifest.data === 'object') {
                item.version = version(manifest.data.version) || item.version;
                if (/outfit.?manager|穿搭管理/i.test(String(manifest.data.display_name || '').slice(0, 100))) item.outfitManager = true;
            }
        }
    }));
    rows.forEach(function (item) { item.current = item.id === currentId; });
    return { items: rows, complete: discovered && !truncated && cursor >= targets.length, currentId: currentId };
}

function uiChecks(targetId) {
    var result = [], duplicate = document.querySelectorAll('#om-fab-main').length > 1 || document.querySelectorAll('.om-overlay').length > 1;
    result.push(row('ui-duplicates', duplicate ? 'attention' : 'pass', '界面入口', duplicate ? '发现重复的穿搭入口或主界面。' : '没有发现重复的穿搭入口或主界面。', duplicate ? '检查是否同时启用了多个穿搭副本，保留一个后完整刷新。' : ''));
    var target = targetId && document.getElementById(targetId);
    if (!target) { result.push(row('popup', 'unknown', '弹窗可操作性', '当前没有可供检测的诊断按钮。')); return result; }
    var rect = target.getBoundingClientRect(), style = getComputedStyle(target), visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (!visible) result.push(row('popup', 'attention', '弹窗可操作性', '诊断按钮被样式隐藏或没有有效尺寸。', '检查当前美化或其他扩展对弹窗、按钮的全局样式。'));
    else if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) result.push(row('popup', 'unknown', '弹窗可操作性', '诊断按钮当前不在可视区域，未判断遮挡。'));
    else {
        var top = document.elementFromPoint(x, y), hit = top && (top === target || target.contains(top));
        result.push(row('popup', hit && style.pointerEvents !== 'none' ? 'pass' : 'attention', '弹窗可操作性', hit && style.pointerEvents !== 'none' ? '诊断按钮可见，未被其他层遮挡。' : '诊断按钮当前被遮挡或不能接收点击。', hit ? '' : '关闭其他弹窗后重试；若只在某扩展开启时发生，可分别停用对照。'));
    }
    var sheet = target.closest('.om-sheet'), box = sheet && sheet.getBoundingClientRect();
    if (box) result.push(row('popup-width', box.left < -2 || box.right > innerWidth + 2 ? 'attention' : 'pass', '窗口宽度', box.left < -2 || box.right > innerWidth + 2 ? '诊断窗口超出当前屏幕宽度。' : '诊断窗口适配当前屏幕宽度。'));
    return result;
}

async function settledUiChecks(targetId, signal) {
    var initial = uiChecks(targetId);
    // The main panel briefly shields clicks while opening. A single delayed
    // recheck avoids reporting that transition as a persistent obstruction.
    if (initial.some(function (item) { return item.id === 'popup' && item.status === 'attention'; }) && !(signal && signal.aborted)) {
        await new Promise(function (resolve) { setTimeout(resolve, 450); });
        return uiChecks(targetId);
    }
    return initial;
}

export async function collectCompatibilityReport(options) {
    options = options || {};
    var context = getChatContext(), signal = options.signal, checks = [], hooks = getCompatibilityHookState();
    var report = { schemaVersion: 1, extensionVersion: OM_VERSION, generatedAt: new Date().toISOString(), environment: environment(), checks: checks, extensions: [], inventoryComplete: false,
        runtime: { fetchProbe: 'unknown', hooks: hooks }, storage: {}, recording: null, summary: { pass: 0, attention: 0, unknown: 0 },
        scope: '把可验证的干扰归属到本次离线、合成交互或样式测试；不能识别所有真实功能冲突。调用栈与停用对照只作线索，不单独证明根因。报告不包含衣柜内容、聊天正文、API 配置、原始错误正文或完整访问地址。' };
    var required = [['fetch', typeof window.fetch === 'function'], ['IndexedDB', typeof indexedDB !== 'undefined'], ['MutationObserver', typeof MutationObserver === 'function'], ['AbortController', typeof AbortController === 'function'], ['Response', typeof Response === 'function']];
    var missing = required.filter(function (item) { return !item[1]; }).map(function (item) { return item[0]; });
    checks.push(row('browser-apis', missing.length ? 'attention' : 'pass', '浏览器能力', missing.length ? '缺少能力：' + missing.join('、') : '关键浏览器能力可用。'));
    checks.push(row('chat-events', context && context.eventSource && typeof context.eventSource.on === 'function' ? 'pass' : 'unknown', '宿主聊天事件', context && context.eventSource && typeof context.eventSource.on === 'function' ? '可访问宿主的聊天事件接口。' : '当前没有可确认的聊天事件接口；可进入聊天后重试。'));
    var jobs = await Promise.allSettled([
        extensions(context, signal), probeCompatibilityStorage(signal), inspectCompatibilityFetch(), mutationProbe(), readJson('/version', signal), readJson('/api/plugins/outfit-manager/status', signal),
        timeout(navigator.storage && typeof navigator.storage.estimate === 'function' ? navigator.storage.estimate() : Promise.resolve(null), 1800, null)
    ]);
    function value(index, fallback) { return jobs[index].status === 'fulfilled' ? jobs[index].value : fallback; }
    var fetchInspection = value(2, { outer: { status: 'blocked', trace: [] }, direct: { status: 'unavailable', trace: [] }, outerDiffers: false });
    var inventory = value(0, { items: [], complete: false }), local = value(1, { ok: false, reason: 'unknown' }), probe = fetchInspection.outer.status, mutations = value(3, 'failed'), host = value(4, { ok: false }), server = value(5, { ok: false }), estimate = value(6, null);
    report.extensions = inventory.items; report.inventoryComplete = !!inventory.complete; report.runtime.fetchProbe = probe;
    report.observations = { fetch: fetchInspection };
    var overlay = document.querySelector('.om-overlay'), theme = ['sakura', 'y2k', 'dopamine', 'memphis', 'minimal'].find(function (name) { return overlay && overlay.classList.contains('om-theme-' + name); });
    report.appearance = { theme: theme || 'unknown', dark: !!(overlay && overlay.classList.contains('om-dark')), layout: innerWidth <= 600 ? 'mobile' : 'desktop' };
    var copies = inventory.items.filter(function (item) { return item.outfitManager && item.enabled !== false && item.scriptLoaded; });
    checks.push(row('extension-copies', copies.length > 1 ? 'attention' : inventory.complete ? 'pass' : 'unknown', '穿搭副本', copies.length > 1 ? '发现多个已加载的穿搭副本。' : inventory.complete ? '未发现多个已加载的穿搭副本。' : '扩展清单不完整，不能排除重复副本。', copies.length > 1 ? '在扩展管理中保留一个穿搭副本后完整刷新；本检查不会自动停用扩展。' : ''));
    var current = inventory.items.find(function (item) { return item.id === inventory.currentId; });
    checks.push(row('frontend-version', current && current.version ? current.version === OM_VERSION ? 'pass' : 'attention' : 'unknown', '前端版本', current && current.version ? current.version === OM_VERSION ? '页面运行版本与安装文件版本一致。' : '页面运行版本与安装文件版本不同。' : '未能读取安装文件的版本。', current && current.version !== OM_VERSION ? '完整刷新或重启宿主，避免更新后仍运行缓存旧文件。' : ''));
    var fetchStatus = probe === 'observed' ? 'pass' : fetchInspection.outerDiffers || probe === 'unavailable' || probe === 'not-observed' ? 'attention' : 'unknown';
    checks.push(row('fetch-chain', fetchStatus, '请求处理链', probe === 'observed' ? '无联网探针已到达穿搭处理器，没有调用生成接口。' : probe === 'not-observed' ? '本次探针未到达穿搭处理器；可能被覆盖，也可能是外层处理器未透传检测参数。' : probe === 'blocked' && fetchInspection.outerDiffers ? '全局入口的离线探针抛错，直接调用穿搭处理器则通过。可查看首个外部脚本位置；结论限于本次探针。' : '探针不可用、超时或受浏览器策略限制，未确认请求链。', fetchStatus === 'attention' ? '先完整刷新，再开启复现记录；仅凭此项不能确定真实生成请求是否失效。' : ''));
    var transport = fetchInspection.transport || { status: 'unavailable', trace: [], errorTrace: [] };
    checks.push(row('fetch-transport', transport.status === 'pass' ? 'pass' : transport.status === 'modified' ? 'attention' : 'unknown', '完整离线请求读回', transport.status === 'pass' ? '数据 URL 经过当前请求链后能正确读回；参数读取时出现的组件会记为参与来源，没有访问模型接口。' : transport.status === 'modified' ? '离线数据经过请求链后与原值不同；可能被改写或替换，需要对照排查。' : '离线读回受阻或超时，可能是浏览器策略或请求处理器行为，无法单独归因。'));
    checks.push(row('xhr-hooks', hooks.xhrCurrent ? 'pass' : 'unknown', '旧式请求处理器', hooks.xhrCurrent ? '当前旧式请求入口仍是本实例安装的处理器。' : '入口外层可能有其他处理器，静态检查无法确认串联关系。'));
    checks.push(row('completion-hook', hooks.completion ? 'pass' : 'unknown', '聊天参数事件', hooks.completion ? '穿搭已注册参数准备事件；本检查不会触发真实聊天事件。' : '没有确认到本实例的参数事件注册。'));
    checks.push(row('mutation-observer', mutations === 'observed' ? 'pass' : mutations === 'failed' || mutations === 'missing' ? 'attention' : 'unknown', '页面变化监听', mutations === 'observed' ? '离屏测试节点的变化能正常传达。' : '未确认到页面变化通知；不代表已确认扩展冲突。'));
    report.storage.localProbe = local;
    checks.push(row('local-storage', local.ok ? 'pass' : local.reason === 'not-open' || local.reason === 'aborted' || local.reason === 'timeout' ? 'unknown' : 'attention', '本地保存', local.ok ? '独立临时键的读写与删除已在同一事务完成，没有修改衣柜。' : '本地小型读写测试未完成。', local.ok ? '小型测试通过不保证大备份有足够空间。' : '留意浏览器存储权限、可用空间和保存状态；异常也可能来自环境或配额。'));
    if (estimate && typeof estimate.quota === 'number' && typeof estimate.usage === 'number') {
        var free = Math.max(0, estimate.quota - estimate.usage); report.storage.quotaMiB = count(estimate.quota / 1048576); report.storage.usedMiB = count(estimate.usage / 1048576); report.storage.availableMiB = count(free / 1048576);
        checks.push(row('storage-space', free < 64 * 1048576 || estimate.usage > estimate.quota * 0.95 ? 'attention' : 'pass', '存储余量', '浏览器估算可用约 ' + report.storage.availableMiB + ' MiB；这不是系统剩余内存。'));
    } else checks.push(row('storage-space', 'unknown', '存储余量', '当前浏览器没有提供可用的存储配额估计。'));
    if (host.ok && host.data) report.environment.hostVersion = version(host.data.pkgVersion) || version(host.data.version);
    report.storage.mode = DB.serverMode ? 'server' : 'local'; report.storage.backendVersion = server.ok && server.data ? version(server.data.pluginVersion) : null;
    checks.push(row('backend', DB.serverMode ? server.ok && server.data && server.data.ok === true ? 'pass' : 'attention' : 'pass', '配套后端连接', DB.serverMode ? server.ok && server.data && server.data.ok === true ? '当前后端状态接口可访问。' : '页面处于后端模式，但当前后端状态未能确认。' : '当前使用浏览器本地存储；没有配套后端不属于扩展冲突。'));
    if (DB.serverMode && report.storage.backendVersion) checks.push(row('backend-version', isPluginVersionAtLeast(report.storage.backendVersion, MIN_SERVER_PLUGIN_VERSION) ? 'pass' : 'attention', '后端版本', '当前后端 ' + report.storage.backendVersion + '，前端要求至少 ' + MIN_SERVER_PLUGIN_VERSION + '。'));
    var badSave = DB.serverInitFailed || ['error', 'conflict'].includes(DB.syncState), pending = Object.keys(DB.dirtyPartKeys || {}).length;
    report.storage.pendingPartitions = pending; report.storage.syncState = ['idle', 'pending', 'saving', 'saved', 'error', 'conflict'].includes(DB.syncState) ? DB.syncState : 'unknown';
    checks.push(row('save-state', badSave ? 'attention' : 'pass', '保存状态', badSave ? '存在初始化、保存失败或版本冲突。' : pending ? '当前仍有 ' + pending + ' 个衣柜等待同步。' : '当前没有记录到保存失败或版本冲突。', badSave ? '到设置 → 调试 → 保存状态查看；保存错误不能直接归因于另一个扩展。' : ''));
    var chat = getChatState(), meta = DB.metaCache || {}, view = getWardrobeView(), bound = getBoundPresetId();
    if (!chat) checks.push(row('chat-view', 'unknown', '聊天与衣柜归属', '当前没有打开可识别的聊天。'));
    else {
        var key = view.kind === 'char' ? 'char:' + view.characterId : bound ? 'user:' + bound : 'user:__default__', part = DB.partCache[key];
        var mismatch = meta.currentView !== view.kind || (view.kind === 'char' && meta.currentChar !== view.characterId), invalid = false;
        if (part) invalid = (chat.active[key] || []).some(function (id) { return !(part.outfits || []).some(function (item) { return item.id === id; }); });
        checks.push(row('chat-view', mismatch || invalid ? 'attention' : part ? 'pass' : 'unknown', '聊天与衣柜归属', mismatch || invalid ? '浏览归属或勾选引用存在不一致。' : part ? '当前聊天的浏览归属与勾选引用一致。' : '当前衣柜尚未载入，跳过勾选引用检查。', mismatch || invalid ? '等待聊天切换结束后再查一次；可用数据体检检查失效引用。' : ''));
    }
    checks.push.apply(checks, await settledUiChecks(options.targetId, signal));
    if (!(signal && signal.aborted)) {
        var control = options.targetId && document.getElementById(options.targetId), click = probeClickRoute(control), style = probeStyleImpact(control), occlusion = probeOcclusion(control, report.extensions), injection = runInjectionSelfTest();
        report.observations.click = click; report.observations.style = style; report.observations.occlusion = occlusion; report.observations.injection = injection;
        checks.push(row('click-route', click.status, '穿搭点击传递', click.reached ? '合成点击已到达穿搭测试按钮；这项测试不等同于全部真实用户手势。' : click.status === 'attention' ? '合成点击没有到达穿搭测试按钮，已记录可观察的阻止传播位置。' : '未能完成交互测试。', click.status === 'attention' ? '查看下方按组件归属的证据，并在保留聊天后逐一停用对照。' : ''));
        checks.push(row('css-impact', style.status, '穿搭样式干扰', style.status === 'pass' ? '检测按钮的尺寸、可见性和点击样式正常。' : style.verified.length ? '通过即时移除／还原声明，验证了 ' + style.verified.length + ' 条使检测按钮受限的样式；已还原。' : '按钮存在样式限制，但本次未确认单条样式来源。', style.status === 'attention' ? '查看样式归属证据；无法读取的跨域样式和多条叠加限制仍可能需要对照。' : ''));
        var selfNames = { currentOutfit: '当前穿搭筛选', chatIsolation: '空聊天隔离', budget: '内容预算', textPayload: '文字写入', imagePayload: '图片写入', contextPayload: '上下文写入', promptPayload: '旧式提示词写入' };
        checks.push(row('injection-selftest', injection.status, '穿搭注入功能自检', injection.status === 'pass' ? '使用合成衣服验证了筛选、隔离、预算及请求内容写入；未发送请求或修改真实衣柜。' : '本地合成数据测试未通过：' + Object.keys(selfNames).filter(function (name) { return !injection.checks[name]; }).map(function (name) { return selfNames[name]; }).join('、'), injection.status === 'attention' ? '这说明本地功能异常，单靠此项无法判断是穿搭自身问题还是外部修改。' : ''));
    }
    report.recording = getCompatibilityRecord();
    var runtimeErrors = getRuntimeErrors(), errorEntries = runtimeErrors.data.entries;
    report.runtime.errorLog = { enabled: runtimeErrors.data.enabled, persistence: runtimeErrors.persistence, stored: errorEntries.length, suppressed: runtimeErrors.data.suppressed, recent: errorEntries.slice(-20).map(function (entry) { return Object.assign({}, entry, { analysis: explainRuntimeError(entry) }); }) };
    checks.push(row('runtime-error-log', errorEntries.length || !runtimeErrors.persistence ? 'attention' : runtimeErrors.data.enabled ? 'pass' : 'unknown', '运行错误日志',
        errorEntries.length ? '最近 7 天保留 ' + errorEntries.length + ' 条穿搭错误记录（重复合并），不代表当前存在扩展冲突。' : runtimeErrors.data.enabled ? '暂未记录到可归属穿搭的运行错误。' : '日常错误记录已暂停，不能据此判断运行正常。',
        !runtimeErrors.persistence ? '本机日志保存不可用，刷新后可能丢失；可在运行错误日志中直接导出。' : errorEntries.length ? '到设置 → 调试 → 运行错误日志查看分类与文件位置。' : ''));
    if (!report.recording.persistence) checks.push(row('record-persistence', 'attention', '复现记录保存', '本机记录存储不可用或写入失败，刷新后记录可能丢失。', '检查浏览器存储限制；这与衣柜数据库的小型读写检查是不同的存储位置。'));
    var journal = report.recording.data, imported = journal && journal.import, incomplete = imported && !['complete', 'cancelled', 'failed'].includes(imported.stage);
    if (journal && journal.status === 'interrupted' && incomplete) checks.push(row('last-import', 'attention', '上次导入记录', '记录期间页面重新载入，上次导入停在“' + compatibilityStageLabel(imported.stage) + '”。', '只能确认没有记录到完成，无法区分手动刷新、关闭、崩溃或系统回收。'));
    else if (imported && imported.stage === 'failed') checks.push(row('last-import', 'attention', '上次导入记录', '上次导入记录为失败，错误分类：' + compatibilityErrorLabel(imported.category) + '。', '导出报告并保留原始分享文件，以便针对同一文件复现。'));
    var errors = journal ? journal.events.filter(function (event) { return event.type === 'error' || event.type === 'resource-error'; }).reduce(function (sum, event) { return sum + event.count; }, 0) : 0;
    if (errors) checks.push(row('recorded-errors', 'attention', '复现期间错误', '记录到 ' + errors + ' 次脚本或资源错误；报告仅保留分类和扩展来源标签。', '来源标签不能证明错误由该扩展造成，也不能证明它与导入失败有关。'));
    if (report.environment.heapMiB != null && report.environment.heapLimitMiB) checks.push(row('memory', report.environment.heapMiB > report.environment.heapLimitMiB * 0.8 ? 'attention' : 'pass', '脚本内存', '当前脚本堆约 ' + report.environment.heapMiB + ' / ' + report.environment.heapLimitMiB + ' MiB；不包含全部图片与系统内存。'));
    checks.forEach(function (item) { report.summary[item.status]++; });
    report.relations = buildCompatibilityRelations(report);
    report.comparison = compareCompatibilityBaseline(report);
    return report;
}

export function compatibilityStageLabel(stage) { return { preparing: '整理数据', reading: '读取文件', images: '处理图片', preview: '等待确认', saving: '保存数据', complete: '本地提交完成', cancelled: '已取消', failed: '失败' }[stage] || '未记录'; }
export function compatibilityErrorLabel(kind) { return { quota: '存储配额', storage: '本地存储', network: '网络或连接', syntax: '文件解析', type: '类型错误', reference: '引用错误', range: '大小或内存限制', aborted: '操作中止', changed: '预览期间数据有修改', unknown: '未分类' }[kind] || '未分类'; }
