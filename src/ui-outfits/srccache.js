// Outfit Manager · 二改版 | 缩略图地址与图片来源缓存
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { state } from '../bridge.js';
import { getImageUrlPrefix } from '../db/index.js';
import { isLocalImage, peekLocalImageURL } from '../db/local-images.js';

// 图片来源缓存保留稳定引用，避免让完整图片编码长期驻留内存。
export function isDirectImageUrl(u) {
    if (!u || typeof u !== 'string') return false;
    if (u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return false;
    var prefix = '';
    try { prefix = getImageUrlPrefix() || ''; } catch (e) { return false; }
    return !!prefix && u.indexOf(prefix) === 0;
}

// ── 网格缩略图 ────────────────────────────────────────────
// 网格一张卡只有 120~200 CSS px 宽，但原图是 800×1067。
// 浏览器解码原图要 3.4MB 位图（17 张可见 = 58MB），降采样成本按**原图像素量**算，
// 不会因为显示得小而变便宜。换成后端按需生成的 320~1280 档 webp 后，
// 解码量和 paint 面积都降到 1/7 左右。
//
// 档位必须**向上取**：需要的物理像素是 N，就给不小于 N 的那一档。
// 宁可多下载几十 KB，也不能让格子显示一张比它自己还小的图——那就是糊。
export var THUMB_STEPS = [320, 480, 640, 960, 1280];

// DPR 封顶 3：超过 3 的屏幕（4K 手机）再往上加肉眼已经分辨不出，
// 只是白白多下几倍的数据量。
export var THUMB_MAX_DPR = 3;

export function pickThumbWidth(cssWidth, dpr) {
    var w = Number(cssWidth) || 0;
    if (w <= 0) return 0;
    var d = Number(dpr) || 1;
    if (d > THUMB_MAX_DPR) d = THUMB_MAX_DPR;
    if (d < 1) d = 1;
    var need = Math.ceil(w * d);
    for (var i = 0; i < THUMB_STEPS.length; i++) {
        if (THUMB_STEPS[i] >= need) return THUMB_STEPS[i];
    }
    // 比最大档还大：仍然给最大档（后端不会放大，会直接回原图）
    return THUMB_STEPS[THUMB_STEPS.length - 1];
}

/** 把同源图片 URL 换成缩略图 URL；不是同源图片、或没有宽度信息时原样返回。 */
export function thumbSrcFor(src, width) {
    if (!src || !width || typeof src !== 'string') return src;
    if (src.indexOf('data:') === 0 || src.indexOf('blob:') === 0) return src;
    if (!isDirectImageUrl(src)) return src;
    if (src.indexOf('/images/thumb/') !== -1) return src;   // 已经是缩略图，别套娃
    var prefix = '';
    try { prefix = getImageUrlPrefix() || ''; } catch (e) { return src; }
    if (!prefix) return src;
    var cut = src.indexOf('?');
    var clean = cut === -1 ? src : src.slice(0, cut);
    var slash = clean.lastIndexOf('/');
    var name = slash === -1 ? clean : clean.slice(slash + 1);
    if (!name) return src;
    return prefix.replace(/\/?$/, '/') + 'thumb/' + name + '?w=' + width;
}

export function getOutfitImgSrc(o) {
    if (!o || !o.imageData || typeof o.imageData !== 'string') return null;
    if (isDirectImageUrl(o.imageData)) return o.imageData;
    var r = state.resolvedImages && state.resolvedImages[o.id];
    if (r && r.url === o.imageData && r.dataUrl) return r.dataUrl;
    return o.imageData;
}

/** 网格展示用：优先已解码缓存，避免切分类闪白 */
export function getCachedGridSrc(o) {
    if (!o || !o.imageData || typeof o.imageData !== 'string') return null;
    if (isLocalImage(o.imageData)) return peekLocalImageURL(o.imageData);
    if (state.gridSrcCache && state.gridSrcCache[o.id]) { touchGridSrc(o.id); return state.gridSrcCache[o.id]; }
    // 同源 URL 直接交给浏览器，不进 base64 缓存（也不需要缓存，浏览器自己会存）
    if (isDirectImageUrl(o.imageData)) return o.imageData;
    if (o.imageData.indexOf('data:image/') === 0 || o.imageData.indexOf('blob:') === 0) {
        rememberGridSrc(o.id, o.imageData);
        return o.imageData;
    }
    var r = state.resolvedImages && state.resolvedImages[o.id];
    if (r && r.dataUrl) {
        rememberGridSrc(o.id, r.dataUrl);
        return r.dataUrl;
    }
    return null;
}

// 缓存上限：手机上一路翻衣柜，缓存会把看过的每张图都留在内存里，
// 翻过 3000 套 = 几百 MB 字符串。改成 LRU，只保留最近看过的那些。
export function touchGridSrc(id) {
    var i = gridSrcOrder.indexOf(id);
    if (i !== -1) gridSrcOrder.splice(i, 1);
    gridSrcOrder.push(id);
    while (gridSrcOrder.length > GRID_SRC_CACHE_MAX) {
        var old = gridSrcOrder.shift();
        if (old && old !== id) {
            try { delete state.gridSrcCache[old]; } catch (eDel) {}
        }
    }
}

export function rememberGridSrc(id, url) {
    if (!id || !url) return;
    if (!state.gridSrcCache) state.gridSrcCache = {};
    state.gridSrcCache[id] = url;
    touchGridSrc(id);
}

export var GRID_SRC_CACHE_MAX = 160;
export var gridSrcOrder = [];
