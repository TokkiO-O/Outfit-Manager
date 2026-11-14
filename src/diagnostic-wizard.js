// Outfit Manager · 二改版 | 手动启动、跨刷新续测、取消及开关恢复
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DIAGNOSTIC_JOB_KEY, DIAGNOSTIC_CANCEL_KEY, sanitizeDiagnosticJob, isDiagnosticActive, nextDiagnosticStep, safeExtensionId } from './diagnostic-job.js';
import { diagnosticBoot, diagnosticTabId, newDiagnosticId, readDiagnosticJob, refreshDiagnosticPolicy, subscribeDiagnosticPolicy, setDiagnosticShadow, setDiagnosticOwnerPermission } from './diagnostic-policy.js';
import { diagnosticStoreGet, checkDiagnosticRoundSeed } from './diagnostic-store.js';
import { loadDiagnosticHost, restoreDiagnosticHost, readDiagnosticDisabled } from './diagnostic-host.js';
import { prepareDiagnosticData, prepareDiagnosticRound, diagnosticFlush, diagnosticSelection, diagnosticReadback, cleanupDiagnosticData, diagnosticServer, diagnosticOwns, diagnosticPause } from './diagnostic-data.js';
import { installDiagnosticNetworkGuard, diagnosticBlockedRequests, subscribeDiagnosticNetwork } from './diagnostic-network.js';
import { diagnosticErrorKind } from './compatibility-journal.js';
import { DB } from './db/state.js';
import { currentUserPartKey } from './db/view.js';
import { OM_VERSION } from './version.js';
import { fn } from './bridge.js';
import { mountPopup } from './utils.js';

var heartbeat = null, controller = null, restoring = null, readyPromise = null, lease = false, releaseLease = null, storageReady = false, ending = false;
var stages = ['preparing', 'loading', 'reading', 'images', 'planning', 'preview', 'saving', 'verify', 'manual', 'complete'];
export function diagnosticRecoveryUrl() { return new URL('../diagnostic-recovery.html', import.meta.url).href; }
function persist(value) {
    var clean = sanitizeDiagnosticJob(value); if (!clean) throw new Error('DIAGNOSTIC_STATE_INVALID');
    clean.updatedAt = Date.now();
    localStorage.setItem(DIAGNOSTIC_JOB_KEY, JSON.stringify(clean));
    if (localStorage.getItem(DIAGNOSTIC_JOB_KEY) !== JSON.stringify(clean)) throw new Error('DIAGNOSTIC_JOURNAL_FAILED');
    refreshDiagnosticPolicy(); return clean;
}
function change(job, values) {
    var latest = readDiagnosticJob();
    if (!latest || latest.id !== job.id || latest.owner !== diagnosticTabId || !lease) throw new Error('DIAGNOSTIC_NOT_OWNER');
    return persist(Object.assign(latest, values));
}
function owned(job) { return lease && !ending && diagnosticOwns(job); }
function phase(job, name, values) { return change(job, Object.assign({ phase: name, phaseAt: Date.now() }, values || {})); }
async function acquireLease() {
    if (lease) return true;
    if (!navigator.locks || typeof navigator.locks.request !== 'function') { lease = true; return true; }
    return new Promise(function(resolve) {
        navigator.locks.request('outfit-diagnostic-runner-v1', { ifAvailable: true }, async function(lock) {
            if (!lock) { setDiagnosticOwnerPermission(false); resolve(false); return; }
            lease = true; setDiagnosticOwnerPermission(true); resolve(true);
            await new Promise(function(release) { releaseLease = release; }); lease = false;
        }).catch(function() { resolve(false); });
    });
}
function releaseIdleLease() { var release=releaseLease;releaseLease=null;lease=false;if(release)release(); }
function stopHeartbeat() { if (heartbeat) clearInterval(heartbeat); heartbeat = null; }
function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(function() {
        var job = readDiagnosticJob();
        if (!job || job.owner !== diagnosticTabId || !isDiagnosticActive(job) || !lease) { stopHeartbeat(); return; }
        try { change(job, { heartbeatAt: Date.now() }); } catch (ignored) { if (controller) controller.abort(); stopHeartbeat(); }
    }, 5000);
}
function reload() { location.reload(); }
export function diagnosticLoadedExtensions() {
    var ids = [];
    document.querySelectorAll('script[src]').forEach(function(script) {
        try { var path = decodeURIComponent(new URL(script.src).pathname), match = path.match(/\/scripts\/extensions\/(.+)\/(?:[^/]+\.js)$/); var id = match && safeExtensionId(match[1]); if (id) ids.push(id); } catch (ignored) {}
    });
    var self = decodeURIComponent(new URL(import.meta.url).pathname).match(/\/scripts\/extensions\/(.+)\/src\/diagnostic-wizard\.js$/);
    if (self && safeExtensionId(self[1])) ids.push(self[1]);
    return Array.from(new Set(ids)).sort();
}
function appReady() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(function(resolve, reject) {
        var ctx; try { ctx = SillyTavern.getContext(); } catch (ignored) {}
        if (!ctx || !ctx.eventSource || !ctx.event_types || !ctx.event_types.APP_READY) { resolve(); return; }
        var timer = setTimeout(function() { reject(new Error('DIAGNOSTIC_HOST_READY_TIMEOUT')); }, 45000);
        ctx.eventSource.once(ctx.event_types.APP_READY, function() { clearTimeout(timer); resolve(); });
    });
    return readyPromise;
}
async function show() { var ui = await import('./ui-sheets/diagnostic-wizard.js'); return ui.openDiagnosticWizard(); }
export { show as openDiagnosticWizard };
function result(job, outcome, error, code, counts) {
    var r = job.round, finished = Date.now();
    return { purpose: r.purpose, enabled: r.enabled, outcome: outcome, kind: error ? diagnosticErrorKind(error) : 'unknown', stage: r.stage, code: code || 'UNKNOWN',
        startedAt: r.startedAt, finishedAt: finished, durationMs: finished - r.startedAt, counts: counts || r.counts, loaded: r.loaded, collateral: r.collateral, userConfirmed: false };
}
async function restore(job, conclusion, status, keep) {
    if (restoring) return restoring;
    ending = true;
    restoring = Promise.resolve().then(async function() {
        if (controller) controller.abort();
        var restoreValues={phase:'restoring',phaseAt:Date.now(),conclusion:conclusion,finalStatus:status,cancelRequested:!keep,restoreDone:false};
        try { job = change(job, restoreValues); } catch(ignored) { job=Object.assign({},job,restoreValues); }
        var clean = false, restored = false;
        try { clean = !await cleanupDiagnosticData(job, keep); } catch (ignored) {}
        try { restored = await restoreDiagnosticHost(job); } catch (ignored) {}
        job=Object.assign({},job,{cleanupPending:!clean,restoreDone:restored});
        try { job=change(job,{cleanupPending:!clean,restoreDone:restored}); } catch(ignored) {}
        if (!restored) { await show(); return; }
        var recorded=false;
        try { job=phase(job,'restored'); recorded=true; } catch(ignored) {
            try { job=persist(Object.assign({},job,{phase:'restored',results:[],versions:{}})); recorded=true; } catch(ignoredAgain) {}
        }
        stopHeartbeat();
        if(!recorded){await show();return;}
        try { sessionStorage.setItem('om_diagnostic_show_result', job.id); } catch (ignored) {}
        reload();
    });
    try { await restoring; } finally { restoring = null; }
}
async function nextRound(job, step) {
    if (!owned(job)) return;
    var id = await prepareDiagnosticRound(job);
    if (!owned(job)) return;
    var round = { id: id, purpose: step.purpose, enabled: step.enabled, index: step.index, stage: 'loading', startedAt: Date.now(), loaded: [], collateral: [], blockedRequests: 0 };
    job = phase(job, 'switching', { round: round, roundIds: (job.roundIds || []).concat(id), step: step.index, suspect: step.suspect || job.suspect });
    var host = await loadDiagnosticHost();
    await host.apply(job, step.enabled, function() { return owned(job); });
    if (!owned(job)) return;
    phase(job, 'boot-round'); reload();
}
async function evaluate(job, value) {
    if (!owned(job)) return;
    job = phase(job, 'evaluating', { results: job.results.concat(value) });
    var step = nextDiagnosticStep(job);
    if (step.pause) return restore(job, step.conclusion, 'paused', true);
    if (step.done) return restore(job, step.conclusion, 'complete', false);
    await diagnosticPause(350);
    if (owned(job)) await nextRound(job, step);
}
function setStage(stage) {
    var job = readDiagnosticJob();
    if (!job || !owned(job) || !job.round || !stages.includes(stage) || job.round.stage === stage) return;
    job.round.stage = stage; change(job, { round: job.round });
}
async function finishImport(job, value) {
    if (!owned(job)) return;
    job = readDiagnosticJob();
    if (value.cancelled) return cancelDiagnosticWizard();
    if (value.blocked || job.round.blockedRequests) return evaluate(job, result(job, 'blocked', null, 'MODEL_BLOCKED'));
    if (!value.ok) return evaluate(job, result(job, 'fail', value.error, 'IMPORT_FAILED'));
    if (!(value.counts.added || value.counts.updated || value.counts.removed)) return evaluate(job, result(job, 'no-change', null, 'NO_CHANGE', value.counts));
    job.round.counts = value.counts; change(job,{round:job.round});
    setStage('saving'); await diagnosticFlush(controller.signal);
    if (!owned(job)) return;
    setStage('verify');
    var readback = await diagnosticReadback();
    if (!owned(job)) return;
    job = readDiagnosticJob(); job.round.expectedDigest = readback.digest; job.round.counts = Object.assign({}, readback.counts, value.counts);
    phase(job, 'verify-pending', { round: job.round }); reload();
}
async function runRound(job) {
    try {
        var host = await loadDiagnosticHost();
        if (!await host.matches(job, job.round.enabled)) throw new Error('DIAGNOSTIC_HOST_CHANGED');
        if (!owned(job)) return;
        var loaded = diagnosticLoadedExtensions();
        job.round.loaded = loaded;
        job.round.collateral = Array.from(new Set(job.originalLoaded.concat(loaded))).filter(function(id) { return !job.targets.includes(id) && job.originalLoaded.includes(id) !== loaded.includes(id); });
        // Expected enabled entry points must actually load. A dependency that
        // prevents loading makes this round inconclusive rather than a pass.
        if (job.round.enabled.some(function(id) { return job.originalLoaded.includes(id) && !loaded.includes(id); })) throw new Error('DIAGNOSTIC_HOST_CHANGED');
        job = change(job, { round: job.round });
        installDiagnosticNetworkGuard();
        if (job.phase === 'verify-pending') {
            await diagnosticFlush(controller.signal);
            var readback = await diagnosticReadback();
            if (!owned(job)) return;
            if (readback.digest !== job.round.expectedDigest) return evaluate(job, result(job, 'fail', new Error('本地存储读回不一致'), 'VERIFY_FAILED'));
            return evaluate(job, result(job, job.round.blockedRequests ? 'blocked' : 'pass', null, job.round.blockedRequests ? 'MODEL_BLOCKED' : 'SUCCESS'));
        }
        if (job.mode === 'manual') { setStage('manual'); if (fn.openPopup) fn.openPopup(); await show(); return; }
        var module = await import('./diagnostic-import.js');
        var value = await module.runDiagnosticImport(job, controller.signal, setStage);
        if (owned(job)) await finishImport(job, value);
    } catch(error) {
        if (!owned(job)) return;
        if (error.message === 'DIAGNOSTIC_CANCELLED') return cancelDiagnosticWizard();
        job = readDiagnosticJob();
        var blocked = /^DIAGNOSTIC_|SOURCE_MISSING/.test(error.message || '');
        await evaluate(job, result(job, blocked ? 'blocked' : 'fail', error, blocked ? error.message === 'SOURCE_MISSING' ? 'SOURCE_MISSING' : 'HOST_CHANGED' : job.round.stage === 'verify' ? 'VERIFY_FAILED' : job.round.stage === 'saving' ? 'SAVE_FAILED' : 'IMPORT_FAILED'));
    }
}
export async function startDiagnosticWizard(options) {
    var active = readDiagnosticJob(); if (isDiagnosticActive(active)) throw new Error('已有排查进行中，请先取消或恢复');
    if (!diagnosticTabId) throw new Error('当前窗口无法保存刷新续测身份');
    if (document.querySelector('#send_textarea') && document.querySelector('#send_textarea').value.trim()) throw new Error('请先保留或发送输入框中的草稿，再开始排查');
    var stop = document.querySelector('#mes_stop'); if (stop && getComputedStyle(stop).display !== 'none' && stop.getBoundingClientRect().height > 0) throw new Error('请先停止当前回复生成');
    if (document.querySelector('.om-import-review') || document.querySelector('#om-import-stop')) throw new Error('请先完成当前导入');
    var inventory = options.inventory || [], targets = Array.from(new Set(options.targets || []));
    if (!targets.length || targets.length > 8 || targets.some(function(id) { return !inventory.some(function(item) { return item.id === id && !item.outfitManager && item.enabled === true; }); })) throw new Error('请选择 1–8 个正在启用的可疑扩展');
    if (inventory.filter(function(item) { return item.outfitManager && item.scriptLoaded; }).length > 1) throw new Error('检测到多个穿搭副本，请先保留一个');
    if (options.mode !== 'manual' && !(options.file instanceof Blob)) throw new Error('请先选择用于复现的 JSON 文件');
    await diagnosticFlush();
    var host = await loadDiagnosticHost(), selection = diagnosticSelection();
    if (targets.some(function(id) { return host.disabled.includes(id); })) throw new Error('扩展开关刚刚有变化，请重新打开排查窗口');
    if (DB.serverMode) {
        var response = await fetch('/api/plugins/outfit-manager/status', { cache: 'no-store' }), status = await response.json();
        if (!response.ok || !status.diagnosticSessions) throw new Error('后端模式的隔离排查需要配套后端 2.3.0，请更新并重启酒馆');
    }
    if(!await acquireLease())throw new Error('另一个窗口正在进行排查');
    if(isDiagnosticActive(readDiagnosticJob())){releaseIdleLease();throw new Error('已有排查进行中，请先取消或恢复');}
    var versions = Object.create(null); inventory.forEach(function(item) { versions[item.id] = item.version; });
    ending=false;
    var now = Date.now(), job;
    try { job = persist({ schemaVersion: 1, id: newDiagnosticId(), owner: diagnosticTabId, phase: 'preparing', storage: DB.serverMode ? 'server' : 'local', mode: options.mode === 'manual' ? 'manual' : 'import',
        targets: targets, originalDisabled: host.disabled, originalLoaded: diagnosticLoadedExtensions(), versions: versions, appVersion: OM_VERSION, createdAt: now, phaseAt: now, heartbeatAt: now,
        targetUserKey: currentUserPartKey(), fileBytes: options.file ? options.file.size : 0, results: [], roundIds: [] }); } catch(error) {releaseIdleLease();throw error;}
    controller = new AbortController(); startHeartbeat(); installDiagnosticNetworkGuard();
    try {
        var token = await prepareDiagnosticData(job, options.file, selection);
        if (!owned(job)) return;
        job = change(job, { serverSession: token });
        await nextRound(job, nextDiagnosticStep(job));
    } catch(error) { if (owned(job)) { await restore(job, 'failed', 'failed', false); throw error; } }
}
export async function cancelDiagnosticWizard() {
    var job = readDiagnosticJob(); if (!job) return;
    if (job.phase === 'restored') {
        if (!await acquireLease()) throw new Error('另一个窗口正在操作测试副本');
        var pending = await cleanupDiagnosticData(job, false);
        persist(Object.assign(job, { owner: diagnosticTabId, cleanupPending: pending, finalStatus: 'cancelled', conclusion: 'cancelled' })); releaseIdleLease();return;
    }
    if (job.owner !== diagnosticTabId || !lease) {
        localStorage.setItem(DIAGNOSTIC_CANCEL_KEY, JSON.stringify({ id: job.id, at: Date.now() })); refreshDiagnosticPolicy();
        return;
    }
    return restore(job, 'cancelled', 'cancelled', false);
}
export async function retryDiagnosticRestore() {
    var job = readDiagnosticJob(); if (!job) return;
    if (job.owner !== diagnosticTabId && Date.now() - job.heartbeatAt < 30000) throw new Error('排查仍在另一个窗口运行，可先请求取消');
    if (!await acquireLease()) throw new Error('另一个窗口仍在排查，请在那里取消');
    job = persist(Object.assign(job, { owner: diagnosticTabId }));
    return restore(job, job.conclusion === 'none' ? 'cancelled' : job.conclusion, job.finalStatus === 'none' ? 'cancelled' : job.finalStatus, job.finalStatus === 'paused');
}
export async function continueDiagnosticWizard(confirmReload) {
    var job = readDiagnosticJob();
    if (!job || job.phase !== 'restored' || job.finalStatus !== 'paused' || job.owner !== diagnosticTabId || !await acquireLease()) throw new Error('请在原排查窗口继续，或清理临时副本后重新开始');
    if (confirmReload) {
        var last = job.results[job.results.length - 1];
        if (last && last.outcome === 'interrupted') { last.userConfirmed = true; last.code = 'USER_CONFIRMED_RELOAD'; }
    }
    var step = nextDiagnosticStep(job);
    if (step.pause) throw new Error('只有确认这次中断就是原来的问题，才会将它计入复测；否则请结束排查');
    localStorage.removeItem(DIAGNOSTIC_CANCEL_KEY);
    ending=false;
    job = persist(Object.assign(job, { phase: 'preparing', phaseAt: Date.now(), cancelRequested: false, conclusion: 'none', finalStatus: 'none', restoreDone: false }));
    controller = new AbortController(); startHeartbeat(); installDiagnosticNetworkGuard();
    try {
        if (job.storage === 'server') await diagnosticServer('sessions/' + job.serverSession + '/resume', 'POST', {});
        if (step.done) await restore(job, step.conclusion, 'complete', false); else await nextRound(job, step);
    } catch(error) { if (owned(job)) await restore(job, 'failed', 'failed', false); throw error; }
}
export async function manualDiagnosticResult(failed) {
    var job = readDiagnosticJob(); if (!job || !owned(job) || job.phase !== 'running' || job.mode !== 'manual') return;
    if (job.round.blockedRequests) return evaluate(job, result(job, 'blocked', null, 'MODEL_BLOCKED'));
    if (failed) { var value = result(job, 'fail', null, 'MANUAL_FAILURE'); value.userConfirmed = true; return evaluate(job, value); }
    return finishImport(job, { ok: true, counts: { updated: 1 } });
}
// Called synchronously at extension registration so APP_READY cannot be missed.
// The idle path neither opens the test DB nor starts a timer or a request.
export function initializeDiagnosticWizard() {
    var job = readDiagnosticJob();
    subscribeDiagnosticPolicy(function(latest) {
        var request; try { request = JSON.parse(localStorage.getItem(DIAGNOSTIC_CANCEL_KEY)); } catch (ignored) {}
        if (latest && isDiagnosticActive(latest) && latest.phase !== 'restoring' && latest.owner === diagnosticTabId && lease && request && request.id === latest.id && request.at >= latest.createdAt && !restoring) cancelDiagnosticWizard();
        if (latest && (!isDiagnosticActive(latest) || latest.owner !== diagnosticTabId) && controller) controller.abort();
    });
    subscribeDiagnosticNetwork(function(count) {
        var latest = readDiagnosticJob(); if (latest && owned(latest) && latest.round) { latest.round.blockedRequests = Math.max(latest.round.blockedRequests, count); change(latest, { round: latest.round }); }
    });
    if (job && isDiagnosticActive(job) && job.owner === diagnosticTabId) { appReady(); installDiagnosticNetworkGuard(); }
}
export async function beforeDiagnosticStorage() {
    var job = readDiagnosticJob();
    if (!isDiagnosticActive(job)) return true;
    if (job.owner !== diagnosticTabId || !await acquireLease()) { setDiagnosticOwnerPermission(false); setTimeout(show, 500); return false; }
    controller = new AbortController(); startHeartbeat();
    if (!['boot-round', 'verify-pending'].includes(job.phase) || !diagnosticBoot.sandbox) {
        if (job.phase === 'running' && job.round) job = change(job, { results: job.results.concat(result(job, 'interrupted', null, 'UNEXPECTED_RELOAD')) });
        await restore(job, job.phase === 'restoring' ? job.conclusion : job.phase === 'preparing' ? 'failed' : 'interrupted', job.phase === 'restoring' ? job.finalStatus : job.phase === 'preparing' ? 'failed' : 'paused', job.phase === 'restoring' ? job.finalStatus === 'paused' : job.phase !== 'preparing'); return false;
    }
    try {
        await appReady();
        if (!owned(job)) return false;
        if (!await checkDiagnosticRoundSeed()) throw new Error('DIAGNOSTIC_SEED_MISSING');
        setDiagnosticShadow(await diagnosticStoreGet(job.id, 'selection'), SillyTavern.getContext());
        if (job.phase === 'boot-round') phase(job, 'running');
        installDiagnosticNetworkGuard(); return true;
    } catch(error) { if (owned(job)) await restore(job, 'blocked', 'failed', false); return false; }
}
export function afterDiagnosticStorage(error) {
    storageReady = !error;
    var job = readDiagnosticJob();
    if(!diagnosticBoot.sandbox && job && job.owner===diagnosticTabId && job.phase==='restored' && job.cleanupPending && job.finalStatus!=='paused')cleanupDiagnosticData(job,false).then(function(pending){var latest=readDiagnosticJob();if(latest&&latest.id===job.id&&latest.phase==='restored')persist(Object.assign(latest,{cleanupPending:pending}));}).catch(function(){});
    if (diagnosticBoot.sandbox && job && owned(job)) {
        var banner=document.createElement('div');banner.id='om-diagnostic-banner';banner.style.cssText='position:fixed;top:6px;left:50%;transform:translateX(-50%);max-width:95vw;pointer-events:auto;background:#38274a;color:white;padding:5px 10px;border-radius:12px;text-align:center;font:13px sans-serif';
        banner.textContent='排查测试副本 ';var button=document.createElement('button');button.textContent='查看进度 / 取消';button.onclick=show;banner.appendChild(button);mountPopup(banner);
        if (error) { evaluate(job, result(job, 'fail', error, 'INIT_FAILED')).catch(function() { show(); }); return; }
        setTimeout(function() { runRound(readDiagnosticJob()).catch(function() { show(); }); }, 250); show(); return;
    }
    try { if (job && sessionStorage.getItem('om_diagnostic_show_result') === job.id) { sessionStorage.removeItem('om_diagnostic_show_result'); setTimeout(show, 400); } } catch (ignored) {}
}
export function diagnosticStorageReady() { return storageReady; }
