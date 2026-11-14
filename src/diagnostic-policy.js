// Outfit Manager · 二改版 | 启动时选择测试命名空间与原数据写入保护
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DIAGNOSTIC_JOB_KEY, DIAGNOSTIC_CANCEL_KEY, DIAGNOSTIC_TAB_KEY, sanitizeDiagnosticJob, diagnosticId, isDiagnosticActive } from './diagnostic-job.js';

export function newDiagnosticId() {
    var bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
}
export function readDiagnosticJob() {
    try { var raw = localStorage.getItem(DIAGNOSTIC_JOB_KEY); return raw && raw.length < 131072 ? sanitizeDiagnosticJob(JSON.parse(raw)) : null; } catch (ignored) { return null; }
}
var tab = null;
try { tab = diagnosticId(sessionStorage.getItem(DIAGNOSTIC_TAB_KEY)); if (!tab) { tab = newDiagnosticId(); sessionStorage.setItem(DIAGNOSTIC_TAB_KEY, tab); } } catch (ignored) {}
export var diagnosticTabId = tab;
var observed = readDiagnosticJob(), listeners = [], shadow = null, permitted = true;
export function setDiagnosticOwnerPermission(value) { permitted = value === true; }
var bootJob = observed, sandbox = !!(bootJob && bootJob.owner === tab && bootJob.round && ['boot-round', 'running', 'verify-pending'].includes(bootJob.phase));
export var diagnosticBoot = Object.freeze({ sandbox: sandbox, jobId: sandbox ? bootJob.id : null, roundId: sandbox ? bootJob.round.id : null,
    serverSession: sandbox ? bootJob.serverSession : null, storage: sandbox ? bootJob.storage : null,
    dbName: sandbox ? 'outfit_mgr_diagnostic_' + bootJob.id + '_' + bootJob.round.id : 'outfit_mgr_db',
    serverBase: sandbox ? bootJob.storage === 'server' && diagnosticId(bootJob.serverSession) ? '/api/plugins/outfit-manager/diagnostics/sessions/' + bootJob.serverSession + '/rounds/' + bootJob.round.id : '/api/plugins/outfit-manager/diagnostics/local-only' : '/api/plugins/outfit-manager' });
export function refreshDiagnosticPolicy() { observed = readDiagnosticJob(); listeners.slice().forEach(function (fn) { try { fn(observed); } catch (ignored) {} }); return observed; }
export function currentDiagnosticPolicy() { return observed; }
export function subscribeDiagnosticPolicy(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (item) { return item !== fn; }); }; }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('storage', function (event) { if (event.key === DIAGNOSTIC_JOB_KEY || event.key === DIAGNOSTIC_CANCEL_KEY) refreshDiagnosticPolicy(); });
export function diagnosticWritesAllowed() {
    if (!diagnosticBoot.sandbox) return !isDiagnosticActive(observed);
    return !!(permitted && observed && observed.owner === tab && observed.id === diagnosticBoot.jobId && observed.round && observed.round.id === diagnosticBoot.roundId && ['boot-round', 'running', 'verify-pending'].includes(observed.phase) && !observed.cancelRequested);
}
export function setDiagnosticShadow(selection, realContext) {
    if (!diagnosticBoot.sandbox) return;
    var original = realContext || {}, identity = JSON.stringify(['character:om-diagnostic', diagnosticBoot.jobId]);
    var metadata = { outfitManagerChatV3: Object.assign({ version: 3, presetBindingVersion: 1, chatKey: identity, updatedAt: 0, active: {}, current: {}, modes: {}, view: { kind: 'user', characterId: '' } }, selection || {}, { chatKey: identity }) };
    shadow = Object.assign({}, original, { chatId: diagnosticBoot.jobId, groupId: null, characterId: 0, characters: [{ avatar: 'om-diagnostic', name: original.name2 || '测试角色' }],
        chatMetadata: metadata, chat: [], name2: original.name2 || '测试角色', getCurrentChatId: function () { return diagnosticBoot.jobId; }, saveMetadata: function () { return Promise.resolve(); }, saveMetadataDebounced: function () {} });
}
export function diagnosticChatContext(realContext) { return diagnosticBoot.sandbox ? shadow : isDiagnosticActive(observed) ? null : realContext; }
export function diagnosticChatPrefix() { return diagnosticBoot.sandbox ? 'om_diagnostic_chat:' + diagnosticBoot.jobId + ':' : 'om_chat_state_v4:'; }
export function diagnosticRestoreRequired() { return !!(bootJob && bootJob.owner === tab && ['preparing', 'switching', 'running', 'evaluating', 'restoring'].includes(bootJob.phase)); }
