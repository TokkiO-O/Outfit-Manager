// Outfit Manager · 二改版 | 存储状态与诊断数据
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { lazyCacheReason } from './partitions.js';
import { getWriteHeaders } from './server.js';
import { DB, IMAGE_URL_PREFIX, MIN_SERVER_PLUGIN_VERSION, SERVER_BASE } from './state.js';

//  图片相关（保留原接口不变）
// ══════════════════════════════════════════════════════════

export function isServerMode() { return DB.serverMode; }
export function getImageUrlPrefix() { return IMAGE_URL_PREFIX; }

export function getStorageHealth() {
    return {
        serverMode: DB.serverMode,
        serverVersion: DB.serverVersion,
        serverPluginVersion: DB.serverPluginVersion,
        minimumServerPluginVersion: MIN_SERVER_PLUGIN_VERSION,
        serverPluginUpdateRecommended: DB.serverPluginUpdateRecommended,
        serverSupportsPartitions: DB.serverSupportsPartitions,
        serverSupportsRecovery: DB.serverSupportsRecovery,
        serverSupportsPartitionTransactions: DB.serverSupportsPartitionTransactions,
        serverStorageState: DB.serverStorageState,
        serverRecoveryResult: DB.serverRecoveryResult,
        serverHydrated: DB.serverHydrated,
        serverInitFailed: DB.serverInitFailed,
        error: DB.lastInitializationError
    };
}

// 性能自检用：当前缓存里装了多少东西（不序列化，避免额外开销）
export function getCacheStats() {
    var parts = 0, outfits = 0, images = 0, chars = 0, known = 0;
    try {
        for (var kk in DB.knownPartKeys) {
            if (Object.prototype.hasOwnProperty.call(DB.knownPartKeys, kk)) known++;
        }
        for (var k in DB.partCache) {
            if (!Object.prototype.hasOwnProperty.call(DB.partCache, k)) continue;
            parts++;
            var p = DB.partCache[k];
            var list = (p && p.outfits) || [];
            outfits += list.length;
            for (var i = 0; i < list.length; i++) {
                if (list[i] && list[i].imageData) images++;
            }
            var accs = (p && p.accessories) || [];
            outfits += accs.length;
        }
        chars = ((DB.metaCache && DB.metaCache.charIndex) || []).length;
    } catch (e) {}
    return {
        partitions: parts,      // 驻留在内存里的分包数
        knownPartitions: known, // 已知分包总数（其余在 IndexedDB 里）
        outfits: outfits, images: images, chars: chars,
        lazy: lazyCacheReason() === 'on',
        lazyReason: lazyCacheReason()
    };
}

export function diagnoseServerRecovery(cb) {
    fetch(SERVER_BASE + '/recovery/diagnose', {
        method: 'GET',
        credentials: 'same-origin'
    }).then(function (r) {
        if (!r || !r.ok) {
            var err = new Error('恢复诊断接口不可用' + (r && r.status ? '（HTTP ' + r.status + '）' : ''));
            err.status = r && r.status ? r.status : 0;
            throw err;
        }
        return r.json();
    }).then(function (body) {
        if (!body || body.ok !== true) throw new Error('恢复诊断返回了无效结果');
        cb(null, body);
    }).catch(function (err) {
        cb(err, null);
    });
}

export function restoreServerSnapshot(snapshotId, cb) {
    if (!DB.serverMode || !DB.serverSupportsPartitions || !DB.serverInitFailed) {
        cb(new Error('当前状态不允许执行后端恢复'));
        return;
    }
    getWriteHeaders().then(function (headers) {
        return fetch(SERVER_BASE + '/recovery/restore', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ snapshotId: snapshotId || null })
        });
    }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
            if (!r.ok || !body || body.ok !== true) {
                var message = body && body.error ? body.error : ('恢复失败（HTTP ' + r.status + '）');
                var err = new Error(message);
                err.status = r.status;
                throw err;
            }
            cb(null, body);
        });
    }).catch(function (err) {
        cb(err, null);
    });
}
