// Outfit Manager · 二改版 | 后端能力与版本检测
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, SERVER_BASE, isPluginVersionAtLeast } from './state.js';

async function readFresh(path) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 5000);
    try {
        var response = await fetch(SERVER_BASE + path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller ? controller.signal : undefined });
        if (!response.ok) return { ok: false, status: response.status };
        var body = await response.json();
        return { ok: !!(body && body.ok === true), status: response.status, body: body };
    } catch (error) { return { ok: false, status: 0, error: error.message }; }
    finally { clearTimeout(timer); }
}

export async function inspectBackend(initialStatus) {
    var status = initialStatus ? { ok: true, body: initialStatus } : await readFresh('/status');
    if (!status.ok) return { installed: status.status !== 404, reachable: false, pluginVersion: null, incremental: false, source: 'unavailable', checkedAt: Date.now(), error: status.error || ('HTTP ' + status.status) };
    var body = status.body;
    var info = { installed: true, reachable: true, pluginVersion: typeof body.pluginVersion === 'string' ? body.pluginVersion : null,
        incremental: body.incrementalTransactions === true && body.partitionRevisions === true, source: 'status', checkedAt: Date.now() };
    if (info.incremental) return info;
    // Versions alone never enable writes. A cache-free, read-only interface
    // check handles older /status shapes without inventing backend support.
    if (info.pluginVersion && !isPluginVersionAtLeast(info.pluginVersion, '2.2.0')) { info.source = 'older-process'; return info; }
    var capabilities = await readFresh('/capabilities');
    if (capabilities.ok && capabilities.body.incrementalTransactions === true && capabilities.body.partitionRevisions === true) {
        info.incremental = true; info.source = 'capabilities';
        if (typeof capabilities.body.pluginVersion === 'string') info.pluginVersion = capabilities.body.pluginVersion;
        return info;
    }
    var manifest = await readFresh('/partitions/manifest');
    if (manifest.ok && manifest.body.validated === true && Array.isArray(manifest.body.keys) && manifest.body.revisions &&
        manifest.body.keys.every(function (key) { return /^(meta|user:(__default__|[A-Za-z0-9_-]+)|char:(__shared__|c_[A-Za-z0-9]{8}))$/.test(key) && /^[a-f0-9]{64}$/.test(manifest.body.revisions[key] || ''); })) {
        info.incremental = true; info.source = 'manifest';
    } else { info.source = 'not-confirmed'; info.probeStatus = manifest.status; }
    return info;
}

export function describeBackend(info) {
    info = info || DB.backendInfo;
    if (!DB.serverMode && (!info || !info.installed)) return '当前使用浏览器本地存储。';
    if (!info || !info.reachable) return '暂时无法连接后端；待保存的修改会继续保留在本机。';
    var version = info.pluginVersion ? 'v' + info.pluginVersion : '版本未报告';
    if (info.incremental && DB.serverSupportsIncremental) return '已连接后端 ' + version + '，增量保存和版本检查已启用。';
    if (info.incremental) return '后端 ' + version + ' 的增量接口已确认；本页面仍在兼容模式，刷新页面后启用。';
    if (info.source === 'older-process') return '当前连接的后端进程报告为 ' + version + '。如已替换后端文件，请重启 SillyTavern 后重新检测。';
    return '已连接后端 ' + version + '，但尚未确认增量接口。可重新检测；如刚替换后端文件，请重启 SillyTavern。';
}

export async function recheckBackend() {
    DB.backendInfo = await inspectBackend();
    return DB.backendInfo;
}
