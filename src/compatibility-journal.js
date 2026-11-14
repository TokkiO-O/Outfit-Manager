// Outfit Manager · 二改版 | 手动复现记录与隐私字段白名单
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var COMPATIBILITY_RECORD_KEY = 'om_compatibility_record_v1';
var DURATION = 10 * 60 * 1000;
var stages = ['preparing', 'reading', 'images', 'preview', 'saving', 'complete', 'cancelled', 'failed'];
var categories = ['quota', 'storage', 'network', 'syntax', 'type', 'reference', 'range', 'aborted', 'changed', 'unknown'];
var eventTypes = ['started', 'stopped', 'page-exited', 'page-reopened', 'error', 'resource-error', 'import-phase', 'request-handler'];
var initialized = false, record = null, timer = null, handlers = null, currentImport = null, lastImportWrite = 0;
var persistence = true, listeners = [];

function number(value, max) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max || 1e13, Math.round(value))) : 0; }
function oneOf(value, allowed, fallback) { return allowed.indexOf(value) !== -1 ? value : fallback; }

export function safeExtensionId(value) {
    if (typeof value !== 'string' || value.length > 120) return null;
    var parts = value.split('/');
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'third-party')) return null;
    return parts.every(function (part) { return part && part !== '.' && part !== '..' && /^[A-Za-z0-9_. \-\u4e00-\u9fff]+$/.test(part); }) ? value : null;
}

export function diagnosticErrorKind(error) {
    var text = '';
    try { text = String(error && error.name || '') + ' ' + String(typeof error === 'string' ? error : error && error.message || '').slice(0, 500); } catch (ignored) {}
    if (/quota|配额|空间不足/i.test(text)) return 'quota';
    if (/abort|取消/i.test(text)) return 'aborted';
    if (/发生了修改|concurrent/i.test(text)) return 'changed';
    if (/indexeddb|transaction|存储|本地保存|写入|database|invalidstate/i.test(text)) return 'storage';
    if (/network|fetch|连接|网络|上传/i.test(text)) return 'network';
    if (/range|invalid string length|内存|memory|嵌套过深|字段超过/i.test(text)) return 'range';
    if (/syntax|json|备份|字符串|分隔符/i.test(text)) return 'syntax';
    if (/reference/i.test(text)) return 'reference';
    if (/type/i.test(text)) return 'type';
    return 'unknown';
}

function safeSource(value) {
    if (['host', 'external', 'unknown'].indexOf(value) !== -1) return value;
    return safeExtensionId(value) || 'unknown';
}
function sourceOf(url) {
    try {
        var parsed = new URL(url, location.href);
        if (parsed.origin !== location.origin) return 'external';
        var match = parsed.pathname.match(/^\/scripts\/extensions\/((?:third-party\/)?[^/]+)\//);
        return match ? safeSource(decodeURIComponent(match[1])) : 'host';
    } catch (error) { return 'unknown'; }
}
function heap() {
    try { return performance.memory ? number(performance.memory.usedJSHeapSize / 1048576, 1048576) : null; } catch (error) { return null; }
}

// Never persist error messages, stacks, file names, URLs, prompts or wardrobe objects.
export function sanitizeCompatibilityRecord(value) {
    if (!value || value.schemaVersion !== 1 || !['recording', 'stopped', 'expired', 'interrupted'].includes(value.status)) return null;
    var clean = { schemaVersion: 1, status: value.status, startedAt: number(value.startedAt), updatedAt: number(value.updatedAt), endedAt: number(value.endedAt), events: [], import: null };
    (Array.isArray(value.events) ? value.events : []).slice(-30).forEach(function (event) {
        if (!event || eventTypes.indexOf(event.type) === -1) return;
        var row = { type: event.type, at: number(event.at), source: safeSource(event.source), count: number(event.count || 1, 1000) };
        if (event.category) row.category = oneOf(event.category, categories, 'unknown');
        if (event.stage) row.stage = oneOf(event.stage, stages, 'preparing');
        if (event.channel) row.channel = oneOf(event.channel, ['normal', 'background', 'xhr'], 'normal');
        clean.events.push(row);
    });
    if (value.import && stages.indexOf(value.import.stage) !== -1) {
        var item = value.import;
        clean.import = { stage: item.stage, fileBytes: number(item.fileBytes), done: number(item.done), total: number(item.total), at: number(item.at), heapMiB: item.heapMiB == null ? null : number(item.heapMiB, 1048576) };
        if (item.category) clean.import.category = oneOf(item.category, categories, 'unknown');
    }
    return clean;
}
function notify() { listeners.slice().forEach(function (fn) { try { fn(); } catch (error) {} }); }
function persist() {
    if (!record) return;
    record.updatedAt = Date.now();
    try { localStorage.setItem(COMPATIBILITY_RECORD_KEY, JSON.stringify(sanitizeCompatibilityRecord(record))); persistence = true; } catch (error) { persistence = false; }
    notify();
}
function append(event) {
    event.at = Date.now(); event.source = safeSource(event.source || 'unknown'); event.count = 1;
    var previous = record.events[record.events.length - 1];
    if (previous && previous.type === event.type && previous.source === event.source && previous.category === event.category && previous.channel === event.channel && previous.stage === event.stage && event.at - previous.at < 1000) {
        previous.count = Math.min(1000, previous.count + 1); previous.at = event.at;
    } else record.events.push(event);
    record.events = record.events.slice(-30);
}
function detach() {
    if (timer) clearTimeout(timer); timer = null;
    if (!handlers || typeof window === 'undefined') return;
    window.removeEventListener('error', handlers.error, true);
    window.removeEventListener('unhandledrejection', handlers.rejection);
    window.removeEventListener('pagehide', handlers.exit, true);
    handlers = null;
}
export function initializeCompatibilityJournal() {
    if (initialized) return; initialized = true;
    try {
        var raw = localStorage.getItem(COMPATIBILITY_RECORD_KEY);
        if (raw && raw.length < 20000) record = sanitizeCompatibilityRecord(JSON.parse(raw));
    } catch (error) { persistence = false; }
    if (record && record.status === 'recording') {
        record.status = 'interrupted'; record.endedAt = Date.now();
        append({ type: 'page-reopened', source: 'host' }); persist();
    }
}
export function getCompatibilityRecord() {
    initializeCompatibilityJournal();
    return { active: !!(record && record.status === 'recording'), persistence: persistence, data: sanitizeCompatibilityRecord(record) };
}
export function subscribeCompatibilityRecord(fn) {
    listeners.push(fn); return function () { listeners = listeners.filter(function (item) { return item !== fn; }); };
}
function active() {
    initializeCompatibilityJournal();
    if (!record || record.status !== 'recording') return false;
    if (Date.now() - record.startedAt >= DURATION) { stopCompatibilityRecording('expired'); return false; }
    return true;
}
export function startCompatibilityRecording() {
    initializeCompatibilityJournal(); detach(); currentImport = null; lastImportWrite = 0;
    record = { schemaVersion: 1, status: 'recording', startedAt: Date.now(), updatedAt: Date.now(), endedAt: 0, events: [], import: null };
    append({ type: 'started', source: 'host' });
    handlers = {
        error: function (event) {
            if (!active()) return;
            var target = event.target;
            if (target && target !== window) {
                if (!['SCRIPT', 'LINK'].includes(target.tagName)) return;
                append({ type: 'resource-error', source: sourceOf(target.src || target.href || ''), category: 'network' });
            } else append({ type: 'error', source: sourceOf(event.filename || ''), category: diagnosticErrorKind(event.error || event.message) });
            persist();
        },
        rejection: function (event) { if (active()) { append({ type: 'error', source: 'unknown', category: diagnosticErrorKind(event.reason) }); persist(); } },
        exit: function () { if (active()) { append({ type: 'page-exited', source: 'host' }); persist(); } }
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('error', handlers.error, true);
        window.addEventListener('unhandledrejection', handlers.rejection);
        window.addEventListener('pagehide', handlers.exit, true);
    }
    timer = setTimeout(function () { stopCompatibilityRecording('expired'); }, DURATION);
    persist(); return getCompatibilityRecord();
}
export function stopCompatibilityRecording(reason) {
    initializeCompatibilityJournal(); detach();
    if (record && record.status === 'recording') {
        record.status = reason === 'expired' ? 'expired' : 'stopped'; record.endedAt = Date.now();
        append({ type: 'stopped', source: 'host' }); persist();
    }
    return getCompatibilityRecord();
}
export function clearCompatibilityRecord() {
    detach(); initialized = true; record = null; currentImport = null;
    try { localStorage.removeItem(COMPATIBILITY_RECORD_KEY); persistence = true; } catch (error) { persistence = false; }
    notify();
}
export function recordImportDiagnostic(token, stage, fields) {
    if (!active() || stages.indexOf(stage) === -1) return;
    fields = fields || {};
    if (typeof token === 'number' && typeof currentImport === 'number' && token < currentImport) return;
    if (currentImport !== token) { currentImport = token; record.import = null; lastImportWrite = 0; }
    var previous = record.import;
    if (stage === 'failed' && fields.category === 'aborted' && previous && previous.stage === 'cancelled') return;
    if (stage === 'cancelled' && previous && ['complete', 'failed'].includes(previous.stage)) return;
    var phaseChanged = !previous || previous.stage !== stage;
    if (!phaseChanged && !fields.fileBytes && Date.now() - lastImportWrite < 1000 && fields.done !== fields.total) return;
    record.import = { stage: stage, fileBytes: number(fields.fileBytes || previous && previous.fileBytes), done: number(fields.done), total: number(fields.total), at: Date.now(), heapMiB: heap() };
    if (fields.category) record.import.category = oneOf(fields.category, categories, 'unknown');
    if (phaseChanged) append({ type: 'import-phase', source: 'host', stage: stage });
    lastImportWrite = Date.now(); persist();
}
export function recordCompatibilityRequest(channel) {
    if (!active()) return;
    append({ type: 'request-handler', source: 'host', channel: oneOf(channel, ['normal', 'background', 'xhr'], 'normal') }); persist();
}
