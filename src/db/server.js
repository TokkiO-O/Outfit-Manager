// Outfit Manager · 二改版 | 服务端探测与完整数据兼容接口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { defMeta, ensurePartDefaults } from '../data.js';
import { idbGet } from './idb.js';
import { fetchServerJson, reassembleFullData, retryServerRead, serverReadFailure } from './server-partitions.js';
import { DB, MIN_SERVER_PLUGIN_VERSION, SERVER_BASE, SERVER_DEBOUNCE_MS, SERVER_SEEN_KEY, isPluginVersionAtLeast } from './state.js';
import { currentUserPartKey } from './view.js';
import { inspectBackend } from './capabilities.js';
import { setSyncState } from './incremental.js';
import { prepareOutgoingImages } from './images.js';

//  Server 通信
// ══════════════════════════════════════════════════════════

export function getWriteHeaders() {
    function addRecoveryRevision(headers) {
        if (!headers || !DB.serverRecoveryRevision) return headers;
        if (typeof headers.set === 'function') headers.set('X-OM-Recovery-Revision', DB.serverRecoveryRevision);
        else headers['X-OM-Recovery-Revision'] = DB.serverRecoveryRevision;
        return headers;
    }
    try {
        if (typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function') {
            var h = window.getRequestHeaders();
            if (h) {
                if (typeof h.set === 'function') h.set('Content-Type', 'application/json');
                else h['Content-Type'] = 'application/json';
                return Promise.resolve(addRecoveryRevision(h));
            }
        }
    } catch (e) {}
    var base = { 'Content-Type': 'application/json' };
    if (DB.csrfToken) { base['X-CSRF-Token'] = DB.csrfToken; return Promise.resolve(addRecoveryRevision(base)); }
    return fetch('/csrf-token', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
            if (j && j.token) { DB.csrfToken = j.token; base['X-CSRF-Token'] = j.token; }
            return addRecoveryRevision(base);
        })
        .catch(function () { return addRecoveryRevision(base); });
}

export function createServerCheckpoint() {
    if (!DB.serverMode || !DB.serverSupportsPartitions || !DB.serverSupportsRecovery || !DB.serverHydrated || DB.serverInitFailed) return;
    getWriteHeaders().then(function (headers) {
        return fetch(SERVER_BASE + '/recovery/checkpoints', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({})
        });
    }).catch(function () {});
}

export function scheduleServerCheckpoint() {
    if (!DB.serverMode || !DB.serverSupportsPartitions || !DB.serverSupportsRecovery || !DB.serverHydrated || DB.serverInitFailed) return;
    if (DB.checkpointTimer) clearTimeout(DB.checkpointTimer);
    DB.checkpointTimer = setTimeout(function () {
        DB.checkpointTimer = null;
        createServerCheckpoint();
    }, SERVER_DEBOUNCE_MS);
}

export function detectServer(cb) {
    var serverWasConfirmed = wasServerPreviouslyConfirmed();
    retryServerRead('server status', function () {
        return fetchServerJson(SERVER_BASE + '/status').then(function (result) {
            if (!result.ok || !result.found) return result;
            var body = result.data;
            if (!body || typeof body !== 'object' || body.ok !== true) {
                return serverReadFailure('unexpected_response', result.status, 'Invalid status response', false);
            }
            return result;
        });
    }, function (result) {
        if (result.ok && !result.found) {
            DB.backendInfo = { installed: false, reachable: false };
            DB.serverSupportsIncremental = false;
            forgetConfirmedServer();
            DB.serverPluginVersion = null;
            DB.serverPluginUpdateRecommended = false;
            DB.serverRecoveryRevision = null;
            DB.serverSupportsRecovery = false;
            DB.serverSupportsPartitionTransactions = false;
            DB.serverStorageState = null;
            DB.serverRecoveryResult = null;
            cb({ installed: false, ok: true, status: 404, kind: 'not_installed', error: null, attempts: result.attempts });
            return;
        }
        if (!result.ok) {
            // 纯前端环境对不存在的插件路由不一定返回标准 404，也可能表现为网络、
            // 代理或 HTML 解析错误。只有曾成功识别过后端，才把这类失败升级为恢复锁定。
            if (!serverWasConfirmed) {
                DB.backendInfo = { installed: false, reachable: false };
                DB.serverSupportsIncremental = false;
                DB.serverPluginVersion = null;
                DB.serverPluginUpdateRecommended = false;
                DB.serverRecoveryRevision = null;
                DB.serverSupportsRecovery = false;
                try { console.warn('[outfit-manager] 未确认安装后端，已使用本地存储模式。', result); } catch (e) {}
                cb({
                    installed: false,
                    ok: true,
                    status: result.status,
                    kind: 'not_confirmed',
                    error: result.error,
                    attempts: result.attempts
                });
                return;
            }
            DB.backendInfo = { installed: true, reachable: false, pluginVersion: DB.serverPluginVersion };
            cb({
                installed: true,
                ok: false,
                status: result.status,
                kind: result.kind,
                error: result.error,
                attempts: result.attempts
            });
            return;
        }
        var body = result.data;
        DB.serverVersion = body.version || 1;
        DB.serverPluginVersion = typeof body.pluginVersion === 'string' ? body.pluginVersion : null;
        DB.serverPluginUpdateRecommended = !isPluginVersionAtLeast(DB.serverPluginVersion, MIN_SERVER_PLUGIN_VERSION);
        DB.serverSupportsPartitions = DB.serverVersion >= 2 && body.partitions === true;
        DB.serverSupportsRecovery = Number(body.recovery || 0) >= 1;
        DB.serverSupportsPartitionTransactions = body.partitionTransactions === true;
        DB.serverSupportsIncremental = body.incrementalTransactions === true && body.partitionRevisions === true;
        DB.serverRecoveryRevision = typeof body.recoveryRevision === 'string' ? body.recoveryRevision : null;
        DB.serverStorageState = typeof body.storageState === 'string' ? body.storageState : null;
        DB.serverRecoveryResult = body.recoveryResult && typeof body.recoveryResult === 'object' ? body.recoveryResult : null;
        inspectBackend(body).then(function (info) {
            DB.backendInfo = info;
            DB.serverSupportsIncremental = info.incremental;
            if (info.pluginVersion) DB.serverPluginVersion = info.pluginVersion;
            DB.serverPluginUpdateRecommended = !info.incremental && !isPluginVersionAtLeast(DB.serverPluginVersion, MIN_SERVER_PLUGIN_VERSION);
            rememberConfirmedServer();
            cb({ installed: true, ok: true, status: result.status, kind: null, error: null, attempts: result.attempts });
        });
    });
}

export function wasServerPreviouslyConfirmed() {
    try { return localStorage.getItem(SERVER_SEEN_KEY) === '1'; }
    catch (e) { return false; }
}

export function rememberConfirmedServer() {
    try { localStorage.setItem(SERVER_SEEN_KEY, '1'); } catch (e) {}
}

export function forgetConfirmedServer() {
    try { localStorage.removeItem(SERVER_SEEN_KEY); } catch (e) {}
}

export function serverGetData(cb) {
    fetch(SERVER_BASE + '/data', { method: 'GET', credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { cb((j && j.ok) ? (j.data || null) : null); })
        .catch(function () { cb(null); });
}

// Phase 1: server 仍然是完整 JSON 读写
// 确保所有 partition 都加载完再重组，防止未加载 partition 被空数组覆盖
export function serverPutFull() {
    if (DB.serverPutInFlight) { DB.serverDirty = true; return; }
    // 先收集所有需要的 partition key
    var meta = DB.metaCache || defMeta();
    var allKeys = ['user:__default__'];
    (meta.presets || []).forEach(function (pi) { if (allKeys.indexOf(pi.partKey) === -1) allKeys.push(pi.partKey); });
    (meta.charIndex || []).forEach(function (ci) { if (allKeys.indexOf(ci.partKey) === -1) allKeys.push(ci.partKey); });
    // 活跃预设
    var activePK = currentUserPartKey();
    if (allKeys.indexOf(activePK) === -1) allKeys.push(activePK);

    // 找出未加载的 partition
    var missing = allKeys.filter(function (k) { return !DB.partCache[k]; });
    if (missing.length === 0) {
        doServerPut();
        return;
    }
    // 加载缺失的 partition 再 PUT
    var pending = missing.length;
    missing.forEach(function (pk) {
        idbGet(pk, function (raw) {
            if (raw) DB.partCache[pk] = ensurePartDefaults(raw);
            pending--;
            if (pending === 0) doServerPut();
        });
    });
}

export async function doServerPut() {
    var full = reassembleFullData();
    DB.serverPutInFlight = true;
    var revisionAtDispatch = DB.serverRevision;
    var raw;
    try { raw = JSON.stringify(await prepareOutgoingImages(full)); }
    catch (err) { DB.serverPutInFlight = false;DB.serverDirty = true;setSyncState('error',err.message);scheduleServerPutRetry(); return; }
    setSyncState('saving');
    var succeeded = false;
    getWriteHeaders().then(function (headers) {
        return fetch(SERVER_BASE + '/data', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: headers,
            body: raw
        });
    }).then(function (r) {
        if (r && r.status === 403) { DB.csrfToken = null; }
        succeeded = !!(r && r.ok);
    }).catch(function () { succeeded = false; }).then(function () {
        DB.serverPutInFlight = false;
        if (!succeeded || revisionAtDispatch !== DB.serverRevision) DB.serverDirty = true;
        setSyncState(!succeeded ? 'error' : DB.serverDirty ? 'pending' : 'saved', !succeeded ? '后端保存失败，待保存修改仍在本机。' : null);
        if (DB.serverDirty) {
            scheduleServerPutRetry();
        }
    });
}

export function scheduleServerPutRetry() {
    if (DB.serverDebounceTimer) clearTimeout(DB.serverDebounceTimer);
    DB.serverDebounceTimer = setTimeout(function () {
        DB.serverDebounceTimer = null;
        if (DB.serverPutInFlight || !DB.serverDirty) return;
        DB.serverDirty = false;
        serverPutFull();
    }, SERVER_DEBOUNCE_MS);
}

export function scheduleServerPut() {
    if (!DB.serverMode) return;
    DB.serverRevision++;
    DB.serverDirty = true;
    setSyncState('pending');
    if (DB.serverDebounceTimer) clearTimeout(DB.serverDebounceTimer);
    scheduleServerPutRetry();
}

// ── 通用接口调用 ─────────────────────────────────────────
// 给「缩略图状态 / 图片瘦身」这类一次性接口用。
// 复用 getWriteHeaders()，所以 CSRF token 和 recovery revision 都会自动带上，
// 不用每个调用点各写一遍。
export function serverApi(path, method, body) {
    return getWriteHeaders().then(function (headers) {
        return fetch(SERVER_BASE + path, {
            method: method || 'GET',
            credentials: 'same-origin',
            headers: headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    }).then(function (r) {
        return r.text().then(function (t) {
            var data = null;
            try { data = t ? JSON.parse(t) : null; } catch (eParse) {}
            if (!r.ok) {
                var msg = (data && (data.error || data.message)) || ('HTTP ' + r.status);
                var err = new Error(msg);
                err.status = r.status;
                err.payload = data;
                throw err;
            }
            return data;
        });
    });
}
