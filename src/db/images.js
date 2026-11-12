// Outfit Manager · 二改版 | 服务器图片与外部调用前的图片解析
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getWriteHeaders } from './server.js';
import { DB, IMAGE_URL_PREFIX, SERVER_BASE } from './state.js';
import { fetchStorage } from './incremental.js';
import { isLocalImage, resolveLocalImageData } from './local-images.js';
import { copyJson } from '../json-data.js';
var remoteLocalImages=new Map();

// Local image references stay inside this app. A later switch to the optional
// server uploads their bytes before any wardrobe/index can reference them.
export async function prepareOutgoingImages(data) {
    var found=false;
    function contains(value){if(!value||typeof value!=='object')return;Object.keys(value).forEach(function(key){if((key==='imageData'||key==='fabImage')&&isLocalImage(value[key]))found=true;else if(value[key]&&typeof value[key]==='object')contains(value[key]);});}
    contains(data);if(!found)return data;
    var result=copyJson(data),fields=[];
    function collect(value){if(!value||typeof value!=='object')return;Object.keys(value).forEach(function(key){if((key==='imageData'||key==='fabImage')&&isLocalImage(value[key]))fields.push({owner:value,key:key,ref:value[key]});else if(value[key]&&typeof value[key]==='object')collect(value[key]);});}
    collect(result);var next=0;
    async function worker(){
        while(next<fields.length){
            var field=fields[next++],cacheKey=(DB.serverRecoveryRevision||'')+':'+field.ref,pending=remoteLocalImages.get(cacheKey);
            if(!pending){
                pending=resolveLocalImageData(field.ref).then(function(dataUrl){return new Promise(function(resolve,reject){uploadImage(dataUrl,function(error,url){if(error||!url||url.indexOf(IMAGE_URL_PREFIX)!==0)reject(new Error('本地图片尚未上传，已保留待同步修改'));else resolve(url);});});});
                remoteLocalImages.set(cacheKey,pending);
            }
            try{field.owner[field.key]=await pending;}catch(error){remoteLocalImages.delete(cacheKey);throw error;}
        }
    }
    await Promise.all([worker(),worker()]);return result;
}

function imageFetch(url, options) {
    return fetchStorage(url, options).then(function (result) { return { ok: result.response.ok, json: function () { return Promise.resolve(result.body); } }; });
}

export function resolveImageForExternal(imageData, cb) {
    if (!imageData || typeof imageData !== 'string') { cb(imageData); return; }
    if (isLocalImage(imageData)) { resolveLocalImageData(imageData).then(cb).catch(function () { cb(null); }); return; }
    if (imageData.indexOf('data:image/') === 0) { cb(imageData); return; }
    if (imageData.indexOf(IMAGE_URL_PREFIX) !== 0) { cb(imageData); return; }
    getWriteHeaders().then(function (headers) {
        return imageFetch(SERVER_BASE + '/images/batch-fetch', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ urls: [imageData] })
        });
    }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
        if (j && j.ok && j.images && j.images[imageData]) cb(j.images[imageData]);
        else cb(imageData);
    }).catch(function () { cb(imageData); });
}

export function batchResolveImages(urls, cb) {
    if (!urls || urls.length === 0) { cb({}); return; }
    var local=urls.filter(isLocalImage);
    if(local.length){
        var remaining=urls.filter(function(value){return !isLocalImage(value);});
        Promise.all(local.map(async function(ref){try{return [ref,await resolveLocalImageData(ref)];}catch(error){return [ref,null];}})).then(function(values){
            batchResolveImages(remaining,function(result){values.forEach(function(pair){result[pair[0]]=pair[1];});cb(result);});
        });return;
    }
    var needFetch = [];
    var results = {};
    urls.forEach(function (url) {
        if (!url || typeof url !== 'string') return;
        if (url.indexOf('data:image/') === 0) { results[url] = url; }
        else if (url.indexOf(IMAGE_URL_PREFIX) === 0) { needFetch.push(url); }
        else { results[url] = url; }
    });
    if (needFetch.length === 0) { cb(results); return; }
    var unique = []; var seen = {};
    needFetch.forEach(function (u) { if (!seen[u]) { seen[u] = true; unique.push(u); } });
    getWriteHeaders().then(function (headers) {
        return imageFetch(SERVER_BASE + '/images/batch-fetch', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ urls: unique })
        });
    }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
        if (j && j.ok && j.images) { for (var url in j.images) { results[url] = j.images[url]; } }
        needFetch.forEach(function (u) { if (!results[u]) results[u] = u; });
        cb(results);
    }).catch(function () {
        needFetch.forEach(function (u) { if (!results[u]) results[u] = u; });
        cb(results);
    });
}

export function uploadImage(dataUrl, cb) {
    if (!DB.serverMode) { cb(null, dataUrl); return; }
    getWriteHeaders().then(function (headers) {
        return imageFetch(SERVER_BASE + '/images', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ dataUrl: dataUrl })
        });
    }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
        if (j && j.ok && j.url) cb(null, j.url);
        else cb(null, dataUrl);
    }).catch(function () { cb(null, dataUrl); });
}

// ══════════════════════════════════════════════════════════
