// Outfit Manager · 二改版 | 穿搭界面共享状态与内部连接
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getChatState } from '../chat-state.js';
import { isLocalImage } from '../db/local-images.js';
// 这里放各子模块都要用的东西。重点是把「会被重新赋值」的模块级变量收进 SH，
// 因为 ES module 的 import 是只读的：A 模块不能给 B 模块导出的变量赋值。
import { state } from '../bridge.js';
import { fn } from '../bridge.js';
import { loadActivePartitions, resolveImageForExternal, getImageUrlPrefix, isServerMode, loadMeta } from '../db/index.js';
import { partGetById } from '../data.js';

export var OM_TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

// 跨模块共享的可变状态
export var SH = {
    detailPanelOpen: false,
    gridImageObserver: null
};

export function clearKitDraft() {
    fn.outfitsInternalClearKitDraft();
}

export function isCurrentKitFocus(partKey, outfitId) {
    return fn.outfitsInternalIsCurrentKitFocus(partKey, outfitId);
}

export function setKitFocus(partKey, outfitId) {
    return fn.outfitsInternalSetKitFocus(partKey, outfitId);
}

// ── 预解析活跃穿搭图片（server模式下）──────────────────
export function preResolveActiveImages() {
    if (!isServerMode()) return;
    var meta = loadMeta();
    if (meta.mode === 'text') { state.resolvedImages = {}; return; }
    var limit = Math.max(0, Math.min(12, Number((meta.injectionBudget || {}).maxImages === undefined ? 4 : meta.injectionBudget.maxImages) || 0));
    var chat = getChatState(), parts = loadActivePartitions(), selected = [], keep = {};
    Object.keys(parts).forEach(function (key) {
        var part = parts[key], current = chat && chat.current[key];
        var ids = current ? [current.outfitId] : part.activeIds || [];
        ids.forEach(function (id) {
            var outfit = partGetById(part, id);
            if (outfit && outfit.imageData && selected.length < limit) { selected.push(outfit); keep[id] = true; }
        });
    });
    Object.keys(state.resolvedImages).forEach(function (id) { if (!keep[id]) delete state.resolvedImages[id]; });
    var index = 0;
    function next() {
        if (index >= selected.length) return;
        var outfit = selected[index++], url = outfit.imageData;
        if ((!isLocalImage(url) && url.indexOf(getImageUrlPrefix()) !== 0) || (state.resolvedImages[outfit.id] && state.resolvedImages[outfit.id].url === url && /^(data:image\/|https?:)/.test(state.resolvedImages[outfit.id].dataUrl || ''))) { next(); return; }
        resolveImageForExternal(url, function (dataUrl) {
            // Ignore a late callback after the chat/selection has changed.
            var latest = getChatState();
            if ((!chat || latest === chat) && keep[outfit.id] && /^(data:image\/|https?:)/.test(dataUrl || '')) state.resolvedImages[outfit.id] = { url: url, dataUrl: dataUrl };
            next();
        });
    }
    next();
}
