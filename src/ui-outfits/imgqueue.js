// Outfit Manager · 二改版 | 网格图片的分批解析
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { state } from '../bridge.js';
import { getImageUrlPrefix, loadCurrent, resolveImageForExternal } from '../db/index.js';
import { SH, OM_TRANSPARENT_PIXEL } from './core.js';
import { rememberGridSrc, isDirectImageUrl, thumbSrcFor } from './srccache.js';
import { isLocalImage, resolveLocalImageURL } from '../db/local-images.js';

export var GRID_IMG_CONCURRENCY = 12;
export var gridImgInFlight = 0;
export var gridImgQueue = [];

export function enqueueGridImg(task) {
    gridImgQueue.push(task);
    pumpGridImgQueue();
}
export function pumpGridImgQueue() {
    while (gridImgInFlight < GRID_IMG_CONCURRENCY && gridImgQueue.length) {
        var task = gridImgQueue.shift();
        gridImgInFlight++;
        try {
            task(function () {
                gridImgInFlight = Math.max(0, gridImgInFlight - 1);
                pumpGridImgQueue();
            });
        } catch (e) {
            gridImgInFlight = Math.max(0, gridImgInFlight - 1);
            pumpGridImgQueue();
        }
    }
}

export function resolveGridImageSrc(imageData, outfitId, cb) {
    if (!imageData || typeof imageData !== 'string') { cb(''); return; }
    if (isLocalImage(imageData)) { resolveLocalImageURL(imageData).then(cb).catch(function(){cb('');}); return; }
    if (imageData.indexOf('data:image/') === 0 || imageData.indexOf('blob:') === 0) {
        cb(imageData);
        return;
    }
    // 服务端模式：imageData 就是同源 URL，直接交给浏览器。
    // 不走 batch-fetch 换 base64 —— 那条路每次要搬 8MB JSON，且 base64 常驻 JS 堆。
    // 后端已对该 URL 返回 `Cache-Control: immutable`，浏览器缓存永不失效。
    // 万一直连失败（反向代理改路径 / 鉴权拦截），loadImg 的 onerror 会退回 base64。
    if (isDirectImageUrl(imageData)) { cb(imageData); return; }
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
    function next() {
        if (i >= candidates.length) { cb(candidates[0] || ''); return; }
        var cur = candidates[i++];
        resolveImageForExternal(cur, function (url) {
            if (url && (String(url).indexOf('data:image/') === 0 || String(url).indexOf('blob:') === 0 || String(url).indexOf('http') === 0 || String(url).indexOf('/api/') === 0)) {
                if (outfitId && String(url).indexOf('data:image/') === 0) {
                    try { state.resolvedImages[outfitId] = { url: imageData, dataUrl: url }; } catch (e3) {}
                }
                cb(url);
                return;
            }
            next();
        });
    }
    next();
}

// eager=true：虚拟网格路径，窗口里只有十几张卡，全部立即赋 src（还能省掉观察器）。
// eager=false：非虚拟路径（弹窗未显示时铺的前 60 张），必须靠 IntersectionObserver
//              控制加载量，否则一上来就并发解 60 张 800px 图。
// thumbWidth：网格格子需要多少物理像素（由 grid.js 按 列宽×DPR 算好）。
//              0 / 省略 = 不做缩略图，直接用原图。
export function setupGridLazyImages(area, outfitsList, eager, thumbWidth) {
    if (SH.gridImageObserver) { SH.gridImageObserver.disconnect(); SH.gridImageObserver = null; }
    var thumbW = Number(thumbWidth) || 0;

    // id -> imageData 一次建表，避免每张图 loadCurrent + 线性查找
    var imgMap = {};
    (outfitsList || []).forEach(function (o) {
        if (o && o.id && o.imageData) imgMap[o.id] = o.imageData;
    });

    var imgs = area.querySelectorAll('img.om-lazy-img[data-outfit-id]');
    if (!imgs.length) return;

    function loadImg(img) {
        if (!img || img.dataset.loaded === '1' || img.dataset.queued === '1') return;
        var id = img.getAttribute('data-outfit-id');
        if (!id) return;
        var cur = img.getAttribute('src') || '';
        if (img.classList.contains('om-loaded') && cur && cur.indexOf('data:image/gif') !== 0 && cur !== OM_TRANSPARENT_PIXEL) {
            img.dataset.loaded = '1';
            return;
        }
        // data/blob 图、以及同源图片 URL，都直接赋值：
        //   - data URL 是已经解码过的，浏览器命中缓存
        //   - 同源 URL 交给浏览器原生加载 + 原生缓存，不占 JS 堆、不需要 base64
        // 两者都不需要进并发队列（没有网络往返以外的异步工作）。
        var imageDataFast = imgMap[id];
        if (imageDataFast && (imageDataFast.indexOf('data:image/') === 0 ||
                              imageDataFast.indexOf('blob:') === 0 ||
                              isDirectImageUrl(imageDataFast))) {
            img.dataset.queued = '1';
            img.dataset.loaded = '1';
            // 同源图片 URL 且知道格子要多大 → 换成缩略图；其余（data/blob/本地模式）原样用
            var fastSrc = thumbSrcFor(imageDataFast, thumbW);
            img.onload = function () { img.classList.add('om-loaded'); };
            img.onerror = function () {
                // 分两级回退，任何一级失败都还能把图显示出来：
                //   1) 缩略图挂了（后端没装 sharp / 生成失败 / 路由被反代改了）→ 退回原图 URL
                //   2) 原图直连也挂了（鉴权拦截）→ 退回 base64 协议
                if (fastSrc !== imageDataFast && img.dataset.fallback !== 'orig') {
                    img.dataset.fallback = 'orig';
                    img.src = imageDataFast;
                    return;
                }
                if (img.dataset.fallback !== 'b64' && isDirectImageUrl(imageDataFast)) {
                    img.dataset.fallback = 'b64';
                    resolveImageForExternal(imageDataFast, function (dataUrl) {
                        if (dataUrl && String(dataUrl).indexOf('data:image/') === 0) {
                            rememberGridSrc(id, dataUrl);
                            img.src = dataUrl;
                        } else {
                            img.classList.add('om-img-error');
                            img.classList.add('om-loaded');
                        }
                    });
                    return;
                }
                img.classList.add('om-img-error');
                img.classList.add('om-loaded');
            };
            img.src = fastSrc;
            rememberGridSrc(id, fastSrc);
            if (img.complete) img.classList.add('om-loaded');
            return;
        }
        img.dataset.queued = '1';
        enqueueGridImg(function (done) {
            if (!img.isConnected) { done(); return; }
            var imageData = imgMap[id];
            if (!imageData) {
                img.dataset.loaded = '1';
                img.classList.add('om-loaded');
                done();
                return;
            }
            resolveGridImageSrc(imageData, id, function (url) {
                if (!img.isConnected) { done(); return; }
                img.dataset.loaded = '1';
                var finalSrc = thumbSrcFor(url, thumbW);
                img.onload = function () { img.classList.add('om-loaded'); };
                img.onerror = function () {
                    // 缩略图失败 → 退回原图一次
                    if (finalSrc && finalSrc !== url && img.dataset.fallback !== 'orig') {
                        img.dataset.fallback = 'orig';
                        img.src = url;
                        return;
                    }
                    img.classList.add('om-loaded');
                    img.classList.add('om-img-error');
                };
                if (finalSrc) {
                    rememberGridSrc(id, finalSrc);
                    if (img.src !== finalSrc && img.getAttribute('src') !== finalSrc) img.src = finalSrc;
                } else {
                    img.classList.add('om-loaded');
                }
                img.classList.add('om-loaded');
                img.removeAttribute('data-outfit-id');
                if (img.complete && img.naturalWidth) img.classList.add('om-loaded');
                done();
            });
        });
    }

    // 虚拟网格：窗口里本来就只有十几张卡，直接全赋。
    // src 都是已经解码过的 data URL，浏览器命中缓存不会闪白，
    // 也不用等 IntersectionObserver 下一帧才触发，还省掉一次 observe/unobserve。
    if (eager) {
        imgs.forEach(loadImg);
        return;
    }

    if (!('IntersectionObserver' in window)) {
        Array.prototype.slice.call(imgs, 0, 40).forEach(loadImg);
        return;
    }

    SH.gridImageObserver = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            loadImg(entry.target);
            observer.unobserve(entry.target);
        });
    }, { root: area, rootMargin: '200px 0px', threshold: 0.01 });

    imgs.forEach(function (img) { SH.gridImageObserver.observe(img); });
}
