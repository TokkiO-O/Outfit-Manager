// Outfit Manager · 二改版 | 按干扰证据归属组件，保存停用前后的对照
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { safeExtensionId } from './compatibility-journal.js';

export var COMPATIBILITY_BASELINE_KEY = 'om_compatibility_baseline_v1';
var comparable = ['extension-copies', 'fetch-chain', 'fetch-transport', 'click-route', 'css-impact', 'popup', 'injection-selftest', 'mutation-observer', 'local-storage'];

export function buildCompatibilityRelations(report) {
    var items = new Map(), observations = report.observations || {};
    (report.extensions || []).forEach(function (entry) { items.set('extension/' + entry.id, { scope: 'extension', id: entry.id, version: entry.version, enabled: entry.enabled, loaded: entry.scriptLoaded, self: entry.current === true, status: entry.enabled === false ? 'inactive' : 'uncovered', evidence: [] }); });
    function add(source, effect, check, detail) {
        if (!source || !['extension', 'server-plugin'].includes(source.scope) || !source.id) return;
        var key = source.scope + '/' + source.id, item = items.get(key);
        if (!item) { item = { scope: source.scope, id: source.id, version: null, enabled: null, loaded: true, self: false, status: 'uncovered', evidence: [] }; items.set(key, item); }
        if (item.evidence.length >= 8) return;
        var evidence = { effect: effect, check: check, detail: detail, file: source.file || null, line: source.line || 0, column: source.column || 0 };
        if (!item.evidence.some(function (old) { return JSON.stringify(old) === JSON.stringify(evidence); })) item.evidence.push(evidence);
        if (effect === 'blocks') item.status = 'interference';
        else if (effect === 'candidate' && item.status !== 'interference') item.status = 'related';
        else if (effect === 'participates' && !['interference', 'related'].includes(item.status)) item.status = 'observed';
    }
    var fetch = observations.fetch;
    if (fetch) {
        if (fetch.transport) {
            fetch.transport.trace.forEach(function (source) { add(source, fetch.transport.status === 'pass' ? 'participates' : 'candidate', 'fetch-transport', fetch.transport.status === 'pass' ? '完整离线数据请求读回正确，参数读取调用栈中出现了此组件。' : '参与了未完成或被改写的离线请求；当前不能证明是哪一层造成。'); });
            fetch.transport.errorTrace.forEach(function (source) { add(source, 'candidate', 'fetch-transport', '出现在失败的完整离线请求调用栈中；可能只是透传了浏览器错误。'); });
        }
        if (fetch.outer.status === 'observed') fetch.outer.trace.forEach(function (source) { add(source, 'participates', 'fetch-chain', '离线请求探针经过了此组件，并成功到达穿搭处理器。仅代表这条测试链正常。'); });
        else if (fetch.outer.status === 'blocked' && fetch.direct.status === 'observed') {
            var origin = fetch.outer.trace.find(function (frame) { return frame.scope !== 'self'; });
            add(origin, origin && ['extension', 'server-plugin'].includes(origin.scope) ? 'blocks' : 'candidate', 'fetch-chain', '全局离线请求测试抛错，直接调用穿搭处理器则通过；抛错的第一处外部脚本位置属于此组件。尚不能据此推断真实生成请求也会失败。');
            fetch.outer.trace.filter(function (source) { return source !== origin; }).forEach(function (source) { add(source, 'candidate', 'fetch-chain', '出现在失败的离线请求调用栈中，需要停用前后对照确认作用。'); });
        }
    }
    var click = observations.click;
    if (click && !click.reached) click.interceptors.filter(function (item) { return item.action !== 'preventDefault'; }).forEach(function (item) {
        var origin = item.trace.find(function (frame) { return frame.scope !== 'self'; });
        add(origin, 'blocks', 'click-route', '合成点击未到达穿搭测试按钮；此处脚本调用了 ' + item.action + ' 阻止传播。该结论限于本次交互测试。');
        item.trace.filter(function (frame) { return frame !== origin; }).forEach(function (source) { add(source, 'candidate', 'click-route', '参与了被阻止的点击调用，需要结合第一处拦截位置判断。'); });
    });
    var style = observations.style;
    if (style) {
        style.verified.forEach(function (item) { add(item.owner, 'blocks', 'css-impact', '临时移除该来源的一条 ' + item.property + ' 声明后按钮恢复可操作，还原后再次受限；声明已立即还原。'); });
        style.candidates.forEach(function (item) { add(item.owner, 'candidate', 'css-impact', '存在匹配穿搭按钮／祖先的限制性 ' + item.property + ' 声明；单项对照尚未证明它是唯一原因。'); });
    }
    var covered = observations.occlusion;
    if (covered && covered.status === 'attention') add(covered.owner, 'candidate', 'popup', '穿搭按钮被另一层挡住，覆盖元素声明属于此扩展；元素声明不能证明实际创建者。');
    var copies = (report.extensions || []).filter(function (item) { return item.outfitManager && item.scriptLoaded && item.enabled !== false; });
    if (copies.length > 1) copies.forEach(function (item) { add({ scope: 'extension', id: item.id }, 'candidate', 'extension-copies', '检测到多个已加载穿搭副本，它们可能共用界面 ID 与注入标识。'); });
    var logs = report.runtime && report.runtime.errorLog && report.runtime.errorLog.recent || [];
    logs.forEach(function (entry) { (entry.related || []).forEach(function (source) { add(source, 'candidate', 'runtime-error-log', '出现在已记录错误的关联调用栈中；这属于历史关联，不能单独确认冲突。'); }); });
    return Array.from(items.values()).map(function (item) {
        var priority = { blocks: 0, participates: 1, candidate: 2 };
        item.evidence.sort(function (a, b) { return priority[a.effect] - priority[b.effect]; });
        if (item.self && !item.evidence.length) item.status = 'self'; return item;
    });
}

function snapshot(report) {
    return { schemaVersion: 1, savedAt: Date.now(), version: report.extensionVersion, hostVersion: report.environment.hostVersion, mode: report.storage.mode,
        appearance: report.appearance, inventoryComplete: report.inventoryComplete === true, extensions: report.extensions.slice(0, 200).map(function (item) { return { id: item.id, version: item.version, active: item.scriptLoaded && item.enabled !== false }; }),
        checks: report.checks.filter(function (item) { return comparable.includes(item.id); }).map(function (item) { return { id: item.id, status: item.status }; }) };
}
function cleanSnapshot(value) {
    if (!value || value.schemaVersion !== 1 || typeof value.savedAt !== 'number' || !['local', 'server'].includes(value.mode)) return null;
    function version(value) { return typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(value) && value.length < 30 ? value : null; }
    var theme = value.appearance && value.appearance.theme, layout = value.appearance && value.appearance.layout;
    return { schemaVersion: 1, savedAt: Math.max(0, Math.min(1e13, value.savedAt)), version: version(value.version), hostVersion: version(value.hostVersion), mode: value.mode,
        appearance: { theme: ['sakura', 'y2k', 'dopamine', 'memphis', 'minimal'].includes(theme) ? theme : 'unknown', dark: !!(value.appearance && value.appearance.dark), layout: ['mobile', 'desktop'].includes(layout) ? layout : 'unknown' }, inventoryComplete: value.inventoryComplete === true,
        extensions: (Array.isArray(value.extensions) ? value.extensions : []).slice(0, 200).map(function (item) { var id = item && safeExtensionId(item.id); return id ? { id: id, version: version(item.version), active: item.active === true } : null; }).filter(Boolean),
        checks: (Array.isArray(value.checks) ? value.checks : []).slice(0, 20).filter(function (item) { return item && comparable.includes(item.id) && ['pass', 'attention', 'unknown'].includes(item.status); }).map(function (item) { return { id: item.id, status: item.status }; }) };
}
export function getCompatibilityBaseline() {
    try { var raw = localStorage.getItem(COMPATIBILITY_BASELINE_KEY); return { persistence: true, data: raw && raw.length < 65536 ? cleanSnapshot(JSON.parse(raw)) : null }; }
    catch (ignored) { return { persistence: false, data: null }; }
}
export function saveCompatibilityBaseline(report) {
    try { var clean = cleanSnapshot(snapshot(report)); if (!clean) return false; localStorage.setItem(COMPATIBILITY_BASELINE_KEY, JSON.stringify(clean)); return true; } catch (ignored) { return false; }
}
export function clearCompatibilityBaseline() { try { localStorage.removeItem(COMPATIBILITY_BASELINE_KEY); return true; } catch (ignored) { return false; } }
export function compareCompatibilityBaseline(report) {
    var baseline = getCompatibilityBaseline(), result = { available: !!baseline.data, persistence: baseline.persistence, savedAt: baseline.data && baseline.data.savedAt, removed: [], added: [], changes: [], warnings: [], candidate: null };
    if (!baseline.data) return result;
    var before = baseline.data, after = cleanSnapshot(snapshot(report)), oldActive = before.extensions.filter(function (item) { return item.active; }), newActive = after.extensions.filter(function (item) { return item.active; });
    result.removed = oldActive.filter(function (item) { return !newActive.some(function (now) { return now.id === item.id; }); }).map(function (item) { return item.id; });
    result.added = newActive.filter(function (item) { return !oldActive.some(function (old) { return old.id === item.id; }); }).map(function (item) { return item.id; });
    if (before.version !== after.version || before.hostVersion !== after.hostVersion) result.warnings.push('穿搭或酒馆版本不同。');
    if (!before.inventoryComplete || !after.inventoryComplete) result.warnings.push('扩展清单不完整，不能确定是否只改变了一个扩展。');
    if (before.mode !== after.mode || JSON.stringify(before.appearance) !== JSON.stringify(after.appearance)) result.warnings.push('存储模式、主题、明暗或窗口类型不同。');
    if (oldActive.some(function (item) { return newActive.some(function (now) { return now.id === item.id && now.version !== item.version; }); })) result.warnings.push('至少一个仍启用扩展的版本改变。');
    before.checks.forEach(function (old) { var now = after.checks.find(function (item) { return item.id === old.id; }); if (now && old.status !== now.status) result.changes.push({ id: old.id, before: old.status, after: now.status }); });
    if (!result.warnings.length && result.removed.length === 1 && !result.added.length && result.changes.some(function (item) { return item.before === 'attention' && item.after === 'pass'; })) result.candidate = result.removed[0];
    return result;
}
