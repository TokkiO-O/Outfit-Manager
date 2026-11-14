// Outfit Manager · 二改版 | 分轮排查状态、恢复计划与结果白名单
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { safeExtensionId } from './compatibility-journal.js';
export { safeExtensionId } from './compatibility-journal.js';

export var DIAGNOSTIC_JOB_KEY = 'om_diagnostic_wizard_v1';
export var DIAGNOSTIC_CANCEL_KEY = 'om_diagnostic_cancel_v1';
export var DIAGNOSTIC_TAB_KEY = 'om_diagnostic_tab_v1';
export var DIAGNOSTIC_PHASES = ['preparing', 'switching', 'boot-round', 'running', 'verify-pending', 'evaluating', 'restoring', 'restored'];
export var DIAGNOSTIC_PURPOSES = ['baseline', 'group-off', 'enable-step', 'confirm-off', 'confirm-on'];
var outcomes = ['pass', 'fail', 'interrupted', 'blocked', 'no-change'];
var kinds = ['unknown', 'quota', 'storage', 'network', 'syntax', 'type', 'reference', 'range', 'aborted', 'changed'];
export function diagnosticId(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) ? value : null; }
function number(value, max) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max || 1e13, Math.round(value))) : 0; }
function ids(value, max) { return Array.from(new Set((Array.isArray(value) ? value : []).map(safeExtensionId).filter(Boolean))).slice(0, max || 300); }
function version(value) { return typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?$/.test(value) && value.length < 50 ? value : null; }
function counts(value) { var out = {}; ['outfits', 'accessories', 'added', 'updated', 'skipped', 'removed'].forEach(function (key) { out[key] = number(value && value[key], 1e7); }); return out; }
function cleanRound(value, targets) {
    if (!value || !diagnosticId(value.id) || !DIAGNOSTIC_PURPOSES.includes(value.purpose)) return null;
    return { id: value.id, purpose: value.purpose, enabled: ids(value.enabled, 8).filter(function (id) { return targets.includes(id); }), index: number(value.index, 8), startedAt: number(value.startedAt),
        stage: ['preparing', 'loading', 'reading', 'images', 'planning', 'preview', 'saving', 'verify', 'manual', 'complete'].includes(value.stage) ? value.stage : 'preparing',
        expectedDigest: typeof value.expectedDigest === 'string' && /^[a-f0-9]{64}$/.test(value.expectedDigest) ? value.expectedDigest : null, counts: counts(value.counts),
        loaded: ids(value.loaded), collateral: ids(value.collateral), blockedRequests: number(value.blockedRequests, 1e5) };
}
function cleanResult(value, targets) {
    if (!value || !DIAGNOSTIC_PURPOSES.includes(value.purpose) || !outcomes.includes(value.outcome)) return null;
    return { purpose: value.purpose, enabled: ids(value.enabled, 8).filter(function (id) { return targets.includes(id); }), outcome: value.outcome,
        kind: kinds.includes(value.kind) ? value.kind : 'unknown', stage: ['loading', 'reading', 'images', 'planning', 'preview', 'saving', 'verify', 'manual', 'complete'].includes(value.stage) ? value.stage : 'loading',
        code: ['IMPORT_FAILED', 'INIT_FAILED', 'SAVE_FAILED', 'VERIFY_FAILED', 'UNEXPECTED_RELOAD', 'MANUAL_FAILURE', 'MODEL_BLOCKED', 'SOURCE_MISSING', 'HOST_CHANGED', 'NO_CHANGE', 'SUCCESS', 'USER_CONFIRMED_RELOAD', 'UNKNOWN'].includes(value.code) ? value.code : 'UNKNOWN',
        startedAt: number(value.startedAt), finishedAt: number(value.finishedAt), durationMs: number(value.durationMs, 1e10), counts: counts(value.counts),
        loaded: ids(value.loaded), collateral: ids(value.collateral), userConfirmed: value.userConfirmed === true };
}
export function sanitizeDiagnosticJob(value) {
    if (!value || value.schemaVersion !== 1 || !diagnosticId(value.id) || !diagnosticId(value.owner) || !DIAGNOSTIC_PHASES.includes(value.phase) || !['local', 'server'].includes(value.storage) || !['import', 'manual'].includes(value.mode)) return null;
    var targets = ids(value.targets, 8); if (!targets.length) return null;
    var versions = Object.create(null);
    Object.keys(value.versions || {}).slice(0, 300).forEach(function (id) { if (safeExtensionId(id)) versions[id] = version(value.versions[id]); });
    var job = { schemaVersion: 1, id: value.id, owner: value.owner, phase: value.phase, mode: value.mode, storage: value.storage, targets: targets,
        originalDisabled: ids(value.originalDisabled, 500), originalLoaded: ids(value.originalLoaded), versions: versions, appVersion: version(value.appVersion),
        createdAt: number(value.createdAt), updatedAt: number(value.updatedAt), heartbeatAt: number(value.heartbeatAt), phaseAt: number(value.phaseAt), fileBytes: number(value.fileBytes),
        targetUserKey: typeof value.targetUserKey === 'string' && /^user:(__default__|[A-Za-z0-9_-]+)$/.test(value.targetUserKey) ? value.targetUserKey : 'user:__default__',
        serverSession: diagnosticId(value.serverSession), roundIds: (Array.isArray(value.roundIds) ? value.roundIds : []).map(diagnosticId).filter(Boolean).slice(-40), round: null, results: [], step: number(value.step, 8), suspect: safeExtensionId(value.suspect),
        conclusion: ['none', 'not-reproduced', 'outside-selection', 'reproduced', 'combination', 'unstable', 'interrupted', 'blocked', 'cancelled', 'failed'].includes(value.conclusion) ? value.conclusion : 'none',
        finalStatus: ['none', 'complete', 'paused', 'cancelled', 'failed'].includes(value.finalStatus) ? value.finalStatus : 'none',
        continuePurpose: DIAGNOSTIC_PURPOSES.includes(value.continuePurpose) ? value.continuePurpose : null, continueEnabled: ids(value.continueEnabled, 8).filter(function (id) { return targets.includes(id); }),
        restoreDone: value.restoreDone === true, cleanupPending: value.cleanupPending === true, cancelRequested: value.cancelRequested === true, manualHost: value.manualHost === true };
    job.round = cleanRound(value.round, targets);
    (Array.isArray(value.results) ? value.results : []).slice(-40).forEach(function (result) { var clean = cleanResult(result, targets); if (clean) job.results.push(clean); });
    return job;
}
export function isDiagnosticActive(job) { return !!(job && job.phase !== 'restored'); }
export function desiredDisabled(job, enabled) {
    var result = job.originalDisabled.filter(function (id) { return !job.targets.includes(id); });
    job.targets.forEach(function (id) { if (!enabled.includes(id)) result.push(id); });
    return ids(result, 500).sort();
}
export function restoreDisabled(job, current) {
    var original = new Set(job.originalDisabled), result = ids(current, 500).filter(function (id) { return !job.targets.includes(id); });
    job.targets.forEach(function (id) { if (original.has(id)) result.push(id); });
    return ids(result, 500).sort();
}
export function uncontrolledSwitchChanges(job, current) {
    var before = job.originalDisabled.filter(function (id) { return !job.targets.includes(id); }).sort(), after = ids(current, 500).filter(function (id) { return !job.targets.includes(id); }).sort();
    return JSON.stringify(before) !== JSON.stringify(after);
}
// Original state -> all selected off -> restore one at a time -> off/on confirmation.
// A failure with several selected extensions enabled is reported as a combination.
export function nextDiagnosticStep(job) {
    var last = job.results[job.results.length - 1];
    if (!last) return { purpose: 'baseline', enabled: job.targets.slice(), index: 0 };
    if (last.outcome === 'interrupted' && !last.userConfirmed) return { pause: true, conclusion: 'interrupted' };
    if (last.outcome === 'blocked' || last.outcome === 'no-change') return { done: true, conclusion: last.outcome === 'blocked' ? 'blocked' : 'not-reproduced' };
    var failed = last.outcome === 'fail' || last.outcome === 'interrupted' && last.userConfirmed;
    if (last.purpose === 'baseline') return failed ? { purpose: 'group-off', enabled: [], index: 0 } : { done: true, conclusion: 'not-reproduced' };
    if (last.purpose === 'group-off') return failed ? { done: true, conclusion: 'outside-selection' } : { purpose: 'enable-step', enabled: job.targets.slice(0, 1), index: 0 };
    if (last.purpose === 'enable-step') {
        var index = Math.max(0, last.enabled.length - 1);
        if (failed) return { purpose: 'confirm-off', enabled: job.targets.slice(0, index), index: index, suspect: job.targets[index] };
        if (last.enabled.length >= job.targets.length) return { done: true, conclusion: 'unstable' };
        return { purpose: 'enable-step', enabled: job.targets.slice(0, last.enabled.length + 1), index: index + 1 };
    }
    if (last.purpose === 'confirm-off') return failed ? { done: true, conclusion: 'unstable' } : { purpose: 'confirm-on', enabled: job.targets.slice(0, job.step + 1), index: job.step, suspect: job.suspect };
    if (last.purpose === 'confirm-on') {
        var first = job.results.slice().reverse().find(function (item) { return item.purpose === 'enable-step' && (item.outcome === 'fail' || item.outcome === 'interrupted' && item.userConfirmed); });
        var sameFailure = first && first.kind === last.kind && first.stage === last.stage && (first.code === last.code || first.userConfirmed && last.userConfirmed);
        return failed && sameFailure ? { done: true, conclusion: last.enabled.length > 1 || last.collateral.length ? 'combination' : 'reproduced' } : { done: true, conclusion: 'unstable' };
    }
    return { done: true, conclusion: 'unstable' };
}
export function diagnosticConclusion(job) {
    var labels = {
        none: '正在排查', 'not-reproduced': '本轮未复现原问题，不能据此认定没有冲突',
        'outside-selection': '所选扩展全部停用后问题仍存在，当前范围未排除故障',
        reproduced: '启用／停用／再启用复测支持所选扩展参与此问题',
        combination: '复测支持扩展组合或连带依赖参与此问题，不能单独归因',
        unstable: '多轮结果不稳定或症状不同，未形成可靠关联',
        interrupted: '页面中断，没有记录到完成；需要你确认是否复现了原问题',
        blocked: '本轮检测条件不完整，未据此判断扩展冲突', cancelled: '已取消排查', failed: '排查没有完成'
    };
    return labels[job.conclusion] || labels.none;
}
export function diagnosticPublicReport(job) {
    var clean = sanitizeDiagnosticJob(job); if (!clean) return null;
    return { schemaVersion: 1, extensionVersion: clean.appVersion, generatedAt: new Date().toISOString(), mode: clean.mode, storage: clean.storage,
        fileBytes: clean.fileBytes, targets: clean.targets, versions: clean.versions, conclusion: clean.conclusion, explanation: diagnosticConclusion(clean),
        suspect: clean.suspect, results: clean.results, restored: clean.restoreDone, cleanupPending: clean.cleanupPending,
        scope: '逐轮开关与同一启动副本下的实际复现结果。仅对本次文件、版本、操作及组合提供关联证据；不包含衣柜正文、图片、聊天、API 配置、文件名或恢复令牌。' };
}
