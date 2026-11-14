// Outfit Manager · 二改版 | 只保留脚本归属与文件位置的诊断证据
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { safeExtensionId } from './compatibility-journal.js';

var root = null;
try { root = new URL('../', import.meta.url); } catch (ignored) {}
export function safeDiagnosticFile(value) {
    return typeof value === 'string' && value.length <= 140 && !value.split('/').some(function (part) { return !part || part === '.' || part === '..'; }) && /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs|css)$/.test(value) ? value : null;
}
function number(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1e7, Math.round(value))) : 0; }
export function sanitizeDiagnosticFrame(value) {
    if (!value || !['self', 'extension', 'server-plugin', 'host'].includes(value.scope)) return null;
    var file = safeDiagnosticFile(value.file), id = null;
    if (!file) return null;
    if (value.scope === 'extension') { id = safeExtensionId(value.id); if (!id) return null; }
    if (value.scope === 'server-plugin') { id = typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.id) ? value.id : null; if (!id) return null; }
    return { scope: value.scope, id: id, file: file, line: number(value.line), column: number(value.column) };
}
export function diagnosticLocation(raw, line, column) {
    if (!root || typeof raw !== 'string' || !raw) return null;
    try {
        var url = new URL(raw, root), file, match;
        if (url.protocol !== root.protocol || url.host !== root.host) return null;
        if (url.pathname.startsWith(root.pathname)) return sanitizeDiagnosticFrame({ scope: 'self', file: decodeURIComponent(url.pathname.slice(root.pathname.length)), line: line, column: column });
        match = url.pathname.match(/^\/scripts\/extensions\/((?:third-party\/)?[^/]+)\/(.+)$/);
        if (match) return sanitizeDiagnosticFrame({ scope: 'extension', id: decodeURIComponent(match[1]), file: decodeURIComponent(match[2]), line: line, column: column });
        match = url.pathname.match(/^\/api\/plugins\/([^/]+)\/v\d+\/(.+)$/);
        if (match) return sanitizeDiagnosticFrame({ scope: 'server-plugin', id: decodeURIComponent(match[1]), file: decodeURIComponent(match[2]), line: line, column: column });
        file = url.pathname.replace(/^\//, '');
        if (/^(?:scripts\/|lib\/|script\.js$)/.test(file)) return sanitizeDiagnosticFrame({ scope: 'host', file: file, line: line, column: column });
    } catch (ignored) {}
    return null;
}
export function diagnosticFrames(error, options) {
    options = options || {};
    var result = [], first = diagnosticLocation(options.filename, options.line, options.column), stack;
    if (first) result.push(first);
    try { stack = typeof error === 'string' ? error : error && error.stack; } catch (ignored) {}
    if (typeof stack !== 'string') return result;
    stack.slice(0, 16000).split('\n').slice(0, 35).forEach(function (line) {
        if (result.length >= 8 || !/^\s*at\s|@/.test(line)) return;
        var match = line.match(/((?:https?|tauri|asset):\/\/[^\s)]+|\/(?:scripts|api|client)\/[^\s)]+):(\d+):(\d+)\)?\s*$/);
        var frame = match && diagnosticLocation(match[1], Number(match[2]), Number(match[3]));
        if (frame && !result.some(function (item) { return JSON.stringify(item) === JSON.stringify(frame); })) result.push(frame);
    });
    return result;
}
export function diagnosticSourceLabel(frame) {
    return !frame ? '来源未定位' : frame.scope === 'extension' ? frame.id : frame.scope === 'server-plugin' ? '后端插件 / ' + frame.id : frame.scope === 'self' ? '穿搭管理器' : '酒馆宿主';
}
