// Outfit Manager · 二改版 | 有界运行错误日志，仅保存诊断白名单
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { diagnosticErrorKind } from './compatibility-journal.js';
import { OM_VERSION } from './version.js';

export var RUNTIME_ERROR_KEY = 'om_runtime_errors_v1';
var LIMIT = 200, MAX_AGE = 7 * 86400000, initialized = false, state, persistence = true;
var flushTimer = null, handlers = null, subscribers = [], burstAt = 0, burstCount = 0;
var kinds = ['handled', 'uncaught', 'rejection', 'resource'];
var operations = { runtime: '脚本运行', startup: '启动', interface: '界面', import: '导入', save: '保存', load: '读取衣柜', api: 'API 调用', models: '获取模型', description: '解析描述', vision: '图片批处理', injection: '聊天注入' };
var categories = ['quota', 'storage', 'network', 'syntax', 'type', 'reference', 'range', 'aborted', 'changed', 'unknown'];
var errorNames = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError', 'QuotaExceededError', 'SecurityError', 'InvalidStateError', 'TransactionInactiveError', 'DataCloneError', 'NetworkError', 'TimeoutError', 'OperationError', 'VersionError', 'ConstraintError', 'UnknownError', 'NotFoundError', 'EvalError', 'URIError'];
var codes = {
    HTTP_ERROR: '接口返回错误状态', QUOTA_EXCEEDED: '浏览器存储配额不足', REQUEST_TIMEOUT: '请求超时', NETWORK_FAILED: '网络请求失败',
    INVALID_STRING_LENGTH: '数据字符串超过浏览器限制', OUT_OF_MEMORY: '可用内存不足', INVALID_JSON: '数据无法解析为 JSON',
    CIRCULAR_JSON: '数据包含循环引用，无法序列化', UNDEFINED_PROPERTY: '读取了未定义对象的属性', NULL_PROPERTY: '读取了空对象的属性',
    NOT_FUNCTION: '调用的值不是函数', NOT_DEFINED: '引用的变量未定义', SAVE_CONFLICT: '保存时发现版本冲突',
    DB_TRANSACTION_FAILED: '本地存储或事务失败', IMAGE_READ_FAILED: '图片读取失败', PARTITION_READ_FAILED: '衣柜读取失败',
    API_EMPTY_RESULT: 'API 返回空内容', API_RESULT_INVALID: 'API 返回内容无法用于服装描述', SCRIPT_LOAD_FAILED: '扩展脚本或样式加载失败',
    UNCLASSIFIED: '运行过程中发生错误'
};
var ownRoot = null;
try { ownRoot = new URL('../', import.meta.url); } catch (ignored) {}

function number(value, max) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max || 1e13, Math.round(value))) : 0; }
function property(value, key) { try { return value && value[key]; } catch (ignored) { return null; } }
function safeFile(value) { return typeof value === 'string' && value.length <= 100 && /^(?:[A-Za-z0-9_-]+\.(?:js|css)|src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:js|css))$/.test(value) ? value : null; }
function safeVersion(value) { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) && value.length < 30 ? value : null; }
function locationOf(raw, line, column) {
    if (!ownRoot || typeof raw !== 'string' || !raw) return null;
    try {
        var url = new URL(raw, ownRoot);
        if (url.origin !== ownRoot.origin || !url.pathname.startsWith(ownRoot.pathname)) return null;
        var file = safeFile(decodeURIComponent(url.pathname.slice(ownRoot.pathname.length)));
        return file ? { file: file, line: number(line, 1e7), column: number(column, 1e7) } : null;
    } catch (ignored) { return null; }
}
function framesOf(error, options) {
    var frames = [], filename = locationOf(options.filename, options.line, options.column);
    if (filename) frames.push(filename);
    var stack = property(error, 'stack');
    if (typeof stack === 'string') stack.slice(0, 12000).split('\n').slice(0, 25).forEach(function (line) {
        if (frames.length >= 4) return;
        var match = line.match(/((?:https?|tauri|asset):\/\/[^\s)]+|\/(?:scripts|client)\/[^\s)]+):(\d+):(\d+)\)?\s*$/);
        var frame = match && locationOf(match[1], Number(match[2]), Number(match[3]));
        if (frame && !frames.some(function (item) { return item.file === frame.file && item.line === frame.line && item.column === frame.column; })) frames.push(frame);
    });
    if (!frames.length && safeFile(options.source)) frames.push({ file: options.source, line: 0, column: 0 });
    return frames;
}
function describe(error, options) {
    var text = '';
    try { text = (typeof error === 'string' ? error : String(property(error, 'name') || '') + ' ' + String(property(error, 'message') || '')).slice(0, 1200); } catch (ignored) {}
    var status = number(options.httpStatus, 599), match;
    if (status < 400) { match = text.match(/\bHTTP\s*[:：]?\s*([45]\d\d)\b/i); status = match ? Number(match[1]) : 0; }
    var code = 'UNCLASSIFIED', category = diagnosticErrorKind(error);
    if (status) { code = 'HTTP_ERROR'; category = 'network'; }
    else if (/quota|配额|空间不足/i.test(text)) code = 'QUOTA_EXCEEDED';
    else if (/timeout|timed out|超时/i.test(text)) { code = 'REQUEST_TIMEOUT'; category = 'network'; }
    else if (/invalid string length/i.test(text)) code = 'INVALID_STRING_LENGTH';
    else if (/out of memory|内存不足/i.test(text)) code = 'OUT_OF_MEMORY';
    else if (/circular|循环引用/i.test(text)) code = 'CIRCULAR_JSON';
    else if (/syntax|json|备份内容不完整/i.test(text)) code = 'INVALID_JSON';
    else if (/undefined.*(?:properties|property)|(?:properties|property).*undefined/i.test(text)) code = 'UNDEFINED_PROPERTY';
    else if (/null.*(?:properties|property)|(?:properties|property).*null/i.test(text)) code = 'NULL_PROPERTY';
    else if (/not a function/i.test(text)) code = 'NOT_FUNCTION';
    else if (/not defined/i.test(text)) code = 'NOT_DEFINED';
    else if (/EDIT_CONFLICT|STALE_CLIENT_REVISION|版本冲突/i.test(text)) { code = 'SAVE_CONFLICT'; category = 'changed'; }
    else if (/未返回可用的服装描述/i.test(text)) code = 'API_RESULT_INVALID';
    else if (/API.*空内容/i.test(text)) code = 'API_EMPTY_RESULT';
    else if (/图片.*(?:读取|编码).*(?:失败|不完整)/i.test(text)) code = 'IMAGE_READ_FAILED';
    else if (/衣柜.*(?:载入|读取).*(?:失败|无法|未能)|衣柜未能载入/i.test(text)) code = 'PARTITION_READ_FAILED';
    else if (category === 'storage') code = 'DB_TRANSACTION_FAILED';
    else if (category === 'network') code = 'NETWORK_FAILED';
    if (options.kind === 'resource') { code = 'SCRIPT_LOAD_FAILED'; category = 'network'; }
    return { code: code, category: category, httpStatus: status };
}
export function sanitizeRuntimeErrors(value, now) {
    now = now || Date.now();
    var result = { schemaVersion: 1, enabled: !value || value.enabled !== false, entries: [], suppressed: number(value && value.suppressed, 1e7) };
    if (!value || value.schemaVersion !== 1) return result;
    (Array.isArray(value.entries) ? value.entries : []).slice(-LIMIT).forEach(function (item) {
        if (!item || !kinds.includes(item.kind) || !Object.prototype.hasOwnProperty.call(operations, item.operation) || !Object.prototype.hasOwnProperty.call(codes, item.code)) return;
        var lastAt = number(item.lastAt), firstAt = number(item.firstAt);
        if (lastAt < now - MAX_AGE || lastAt > now + 60000) return;
        var entry = { kind: item.kind, operation: item.operation, name: errorNames.includes(item.name) ? item.name : 'Error', code: item.code,
            category: categories.includes(item.category) ? item.category : 'unknown', httpStatus: number(item.httpStatus, 599), firstAt: Math.min(firstAt, lastAt), lastAt: lastAt,
            count: Math.max(1, number(item.count, 1e7)), version: safeVersion(item.version), frames: [] };
        (Array.isArray(item.frames) ? item.frames : []).slice(0, 4).forEach(function (frame) { var file = frame && safeFile(frame.file); if (file) entry.frames.push({ file: file, line: number(frame.line, 1e7), column: number(frame.column, 1e7) }); });
        result.entries.push(entry);
    });
    return result;
}
function notify() { subscribers.slice().forEach(function (fn) { try { fn(); } catch (ignored) {} }); }
export function flushRuntimeErrors() {
    if (flushTimer) clearTimeout(flushTimer); flushTimer = null;
    if (!state) return;
    try { state = sanitizeRuntimeErrors(state); localStorage.setItem(RUNTIME_ERROR_KEY, JSON.stringify(state)); persistence = true; } catch (ignored) { persistence = false; }
    notify();
}
function scheduleFlush() { if (!flushTimer) flushTimer = setTimeout(flushRuntimeErrors, 500); }
function detach() {
    if (!handlers || typeof window === 'undefined' || typeof window.removeEventListener !== 'function') return;
    window.removeEventListener('error', handlers.error, true); window.removeEventListener('unhandledrejection', handlers.rejection); window.removeEventListener('pagehide', handlers.exit, true); handlers = null;
}
function attach() {
    if (handlers || !state.enabled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    handlers = {
        error: function (event) {
            var target = event.target;
            if (target && target !== window) {
                if (['SCRIPT', 'LINK'].includes(target.tagName) && locationOf(target.src || target.href)) captureRuntimeError(null, { kind: 'resource', filename: target.src || target.href });
                return;
            }
            if (locationOf(event.filename) || framesOf(event.error, {}).length) captureRuntimeError(event.error || event.message, { kind: 'uncaught', filename: event.filename, line: event.lineno, column: event.colno });
        },
        rejection: function (event) { if (framesOf(event.reason, {}).length) captureRuntimeError(event.reason, { kind: 'rejection' }); },
        exit: function () { if (flushTimer) flushRuntimeErrors(); }
    };
    window.addEventListener('error', handlers.error, true); window.addEventListener('unhandledrejection', handlers.rejection); window.addEventListener('pagehide', handlers.exit, true);
}
export function initializeRuntimeErrors() {
    if (initialized) return; initialized = true; state = sanitizeRuntimeErrors(null);
    try { var raw = localStorage.getItem(RUNTIME_ERROR_KEY); if (raw && raw.length <= 262144) state = sanitizeRuntimeErrors(JSON.parse(raw)); } catch (ignored) { persistence = false; }
    attach();
}
export function captureRuntimeError(error, options) {
    // Logging must never change the success/failure path of the original action.
    try {
        initializeRuntimeErrors(); if (!state.enabled) return;
        options = options || {};
        if (property(error, 'name') === 'AbortError' || error === '已取消' || error === '请求已取消') return;
        var now = Date.now(); if (now - burstAt >= 1000) { burstAt = now; burstCount = 0; }
        if (++burstCount > 40) { state.suppressed = Math.min(1e7, state.suppressed + 1); scheduleFlush(); return; }
        var info = describe(error, options), entry = { kind: kinds.includes(options.kind) ? options.kind : 'handled', operation: Object.prototype.hasOwnProperty.call(operations, options.operation) ? options.operation : 'runtime',
            name: errorNames.includes(property(error, 'name')) ? property(error, 'name') : 'Error', code: info.code, category: info.category, httpStatus: info.httpStatus,
            firstAt: now, lastAt: now, count: 1, version: OM_VERSION, frames: framesOf(error, options) };
        var signature = function (row) { return JSON.stringify([row.kind, row.operation, row.name, row.code, row.category, row.httpStatus, row.version, row.frames]); }, key = signature(entry);
        state.entries = state.entries.filter(function (row) { return row.lastAt >= now - MAX_AGE; });
        var index = state.entries.findIndex(function (row) { return signature(row) === key; });
        if (index !== -1) { var old = state.entries.splice(index, 1)[0]; entry.firstAt = old.firstAt; entry.count = Math.min(1e7, old.count + 1); }
        state.entries.push(entry); state.entries = state.entries.slice(-LIMIT); scheduleFlush();
    } catch (ignored) {}
}
export function getRuntimeErrors() {
    initializeRuntimeErrors();
    return { persistence: persistence, data: sanitizeRuntimeErrors(state) };
}
export function setRuntimeErrorsEnabled(enabled) { initializeRuntimeErrors(); state.enabled = !!enabled; if (state.enabled) attach(); else detach(); flushRuntimeErrors(); }
export function clearRuntimeErrors() { initializeRuntimeErrors(); state.entries = []; state.suppressed = 0; burstAt = 0; burstCount = 0; flushRuntimeErrors(); }
export function subscribeRuntimeErrors(fn) { subscribers.push(fn); return function () { subscribers = subscribers.filter(function (item) { return item !== fn; }); }; }
export function runtimeErrorOperation(value) { return Object.prototype.hasOwnProperty.call(operations, value) ? operations[value] : operations.runtime; }
export function runtimeErrorSummary(entry) { return (entry.code === 'HTTP_ERROR' ? codes.HTTP_ERROR + ' · HTTP ' + entry.httpStatus : codes[entry.code] || codes.UNCLASSIFIED); }
export function exportRuntimeErrors() {
    flushRuntimeErrors(); var log = getRuntimeErrors();
    return { schemaVersion: 1, extensionVersion: OM_VERSION, generatedAt: new Date().toISOString(), scope: '仅保留穿搭自身的异常及已接入的功能失败。包含错误分类、次数和扩展内文件位置；不保存原始报错正文、函数名、完整地址、API 配置或衣柜与聊天内容。没有调用栈的拒绝和其他扩展异常可能无法归属。', log: log };
}
