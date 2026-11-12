// Outfit Manager · 二改版 | 历史记录的兼容入口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { currentPartKey, loadMeta, saveMeta } from '../db/index.js';

// ── 穿着历史 ────────────────────────────────────────────
export function todayStr() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

export function recordWearHistory(outfit) {
    if (!outfit || !outfit.id) return;
    try {
        var meta = loadMeta();
        if (!Array.isArray(meta.wearHistory)) meta.wearHistory = [];
        var entry = {
            date: todayStr(),
            partKey: currentPartKey(),
            outfitId: outfit.id,
            name: outfit.name || '穿搭',
            ts: Date.now()
        };
        // 同一天同一套不重复记
        var exists = meta.wearHistory.some(function (h) {
            return h.date === entry.date && h.outfitId === entry.outfitId && h.partKey === entry.partKey;
        });
        if (!exists) {
            meta.wearHistory.unshift(entry);
            // 保留约 120 条
            if (meta.wearHistory.length > 120) meta.wearHistory = meta.wearHistory.slice(0, 120);
            saveMeta(meta);
        }
    } catch (e) { /* ignore */ }
}
