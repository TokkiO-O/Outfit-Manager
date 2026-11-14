// Outfit Manager · 二改版 | 检测期间阻止穿搭模型请求和正式衣柜写入
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { readDiagnosticJob, currentDiagnosticPolicy, diagnosticTabId, diagnosticBoot } from './diagnostic-policy.js';
import { isDiagnosticActive } from './diagnostic-job.js';

var installed = false, count = 0, listeners = [], lastFetch = null;
export function diagnosticBlockedRequests() { return count; }
export function recordDiagnosticModelBlock() { count++; listeners.slice().forEach(function(fn){try{fn(count);}catch(ignored){}}); }
export function subscribeDiagnosticNetwork(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (item) { return item !== fn; }); }; }
function blocked(input, method) {
    var job = currentDiagnosticPolicy();
    if ((!isDiagnosticActive(job) || job.owner !== diagnosticTabId) && !diagnosticBoot.sandbox) return false;
    var url; try { url = new URL(typeof input === 'string' ? input : input && input.url || '', location.href); } catch (ignored) { return false; }
    var path = url.pathname;
    var generation = /\/api\/backends\/[^/]+\/generate\/?$|\/api\/novelai\/generate\/?$|\/api\/plugins\/baibaoku\/v1\/chats\/save-generate\/?$|\/chat\/completions\/?$|\/responses\/?$|:generateContent$|:streamGenerateContent$/.test(path);
    var write = url.origin === location.origin && path.startsWith('/api/plugins/outfit-manager/') && !path.startsWith('/api/plugins/outfit-manager/diagnostics/') && !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase()) && path !== '/api/plugins/outfit-manager/images/batch-fetch';
    if (!generation && !write) return false;
    if (generation) recordDiagnosticModelBlock();
    return true;
}
function error() { var result = new Error('隔离排查已阻止真实生成或正式衣柜写入'); result.code = 'DIAGNOSTIC_REQUEST_BLOCKED'; return result; }
export function installDiagnosticNetworkGuard() {
    var job = readDiagnosticJob();
    if (typeof window === 'undefined' || !isDiagnosticActive(job) || !diagnosticTabId || job.owner !== diagnosticTabId) return;
    if (window.fetch !== lastFetch) {
        var original = window.fetch;
        lastFetch = function (input, init) { if (blocked(input, init && init.method || input && input.method)) return Promise.reject(error()); return original.apply(this, arguments); };
        window.fetch = lastFetch;
    }
    if (installed || typeof XMLHttpRequest === 'undefined') return; installed = true;
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this.__omDiagnosticRequest = { method: method, url: url }; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () { var value = this.__omDiagnosticRequest; if (value && blocked(value.url, value.method)) throw error(); return send.apply(this, arguments); };
}
