// Outfit Manager · 二改版 | 衣柜工具的缩略图地址解析
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { state } from '../bridge.js';
import { getImageUrlPrefix, resolveImageForExternal } from '../db/index.js';
export function resolveOutfitThumbUrl(imageData, outfitId, cb) {
    if (!imageData || typeof imageData !== 'string') { cb(''); return; }
    if (imageData.indexOf('data:image/') === 0 || imageData.indexOf('blob:') === 0) {
        cb(imageData);
        return;
    }
    try {
        if (outfitId && state.resolvedImages && state.resolvedImages[outfitId] && state.resolvedImages[outfitId].dataUrl) {
            cb(state.resolvedImages[outfitId].dataUrl);
            return;
        }
    } catch (e) {}
    var prefix = '';
    try { prefix = getImageUrlPrefix() || ''; } catch (e2) {}
    var candidates = [imageData];
    if (prefix && imageData.indexOf(prefix) !== 0 && imageData.indexOf('http') !== 0) {
        candidates.push(prefix.replace(/\/?$/, '/') + String(imageData).replace(/^\//, ''));
    }
    var i = 0;
    function tryNext() {
        if (i >= candidates.length) { cb(candidates[0] || ''); return; }
        var cur = candidates[i++];
        resolveImageForExternal(cur, function (url) {
            if (url && String(url).indexOf('data:image/') === 0) {
                cb(url);
                return;
            }
            // 后端未转 dataURL 时，若返回可访问路径也用
            if (url && (String(url).indexOf('/api/') === 0 || String(url).indexOf('http') === 0)) {
                cb(url);
                return;
            }
            tryNext();
        });
    }
    tryNext();
}

