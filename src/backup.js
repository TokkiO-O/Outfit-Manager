// Outfit Manager · 二改版 | 便携衣柜备份与图片打包
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { copyJson, yieldImport } from './json-data.js';
import { isLocalImage, LOCAL_IMAGE_PREFIX } from './db/local-images.js';
import { wardrobeContentOnly } from './wardrobe-transfer.js';
export function collectBackupImageUrls(data, prefix) {
    var urls = new Set();
    function items(list) { (list || []).forEach(function (item) { if (item && typeof item.imageData === 'string' && (isLocalImage(item.imageData) || item.imageData.indexOf(prefix) === 0)) urls.add(item.imageData); }); }
    function part(value) { if (value) { items(value.outfits); items(value.accessories); } }
    part(data);
    part(data.preset);
    Object.keys(data.chars || {}).forEach(function (name) { part(data.chars[name]); });
    (data.presets || []).forEach(part);
    return Array.from(urls);
}

export async function prepareBackup(data, prefix, resolver, onProgress) {
    data = wardrobeContentOnly(data, false);
    var urls = collectBackupImageUrls(data, prefix);
    var assets = {}, missing = [];
    for (var start = 0; start < urls.length; start += 8) {
        var chunk = urls.slice(start, start + 8);
        var resolved;
        try { resolved = await new Promise(function (resolve) { resolver(chunk, resolve); }); }
        catch (error) { resolved = {}; }
        chunk.forEach(function (url) {
            var value = resolved && resolved[url];
            if (typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(value)) assets[assetName(url,prefix)] = value;
            else missing.push(url);
        });
        if (onProgress) onProgress(Math.min(start + 8, urls.length), urls.length);
    }
    if (missing.length) {
        var error = new Error('有 ' + missing.length + ' 张图片未能打包，已停止导出完整备份。');
        error.missingImages = missing; throw error;
    }
    var result = portableMetadata(data,prefix);
    if (urls.length) result._assets = assets;
    result._backupManifest = { version: 1, images: urls.map(function (url) { return assetName(url,prefix); }), imageCount: urls.length, createdAt: new Date().toISOString() };
    return result;
}
function assetName(url,prefix) { return isLocalImage(url)?url.slice(LOCAL_IMAGE_PREFIX.length):url.slice(prefix.length); }
function portableMetadata(data,prefix) {
    var result=copyJson(data);
    function part(value){if(!value)return;['outfits','accessories'].forEach(function(kind){(value[kind]||[]).forEach(function(item){if(item&&isLocalImage(item.imageData))item.imageData=prefix+assetName(item.imageData,prefix);});});}
    part(result);part(result.preset);Object.keys(result.chars||{}).forEach(function(key){part(result.chars[key]);});(result.presets||[]).forEach(part);
    if(isLocalImage(result.fabImage))result.fabImage=prefix+assetName(result.fabImage,prefix);
    delete result._assets;delete result._backupManifest;return result;
}
function* jsonTokens(value) {
    if(value===null||typeof value!=='object'){yield JSON.stringify(value===undefined?null:value);return;}
    if(Array.isArray(value)){yield '[';for(var i=0;i<value.length;i++){if(i)yield ',';yield* jsonTokens(value[i]);}yield ']';return;}
    yield '{';var first=true;
    for(var key of Object.keys(value)){if(value[key]===undefined)continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* jsonTokens(value[key]);}
    yield '}';
}
// A JSON Blob is assembled from bounded pieces. Images never expand into the
// metadata, and exporting thousands of images needs no file-sized JS string.
export async function buildBackupBlob(data,prefix,resolver,onProgress) {
    data=wardrobeContentOnly(data,false);
    var urls=collectBackupImageUrls(data,prefix),portable=portableMetadata(data,prefix),chunks=[],buffer=[],length=0,last=Date.now(),tokens=0;
    function flush(){if(buffer.length){chunks.push(new Blob(buffer));buffer=[];length=0;}}
    function append(text){buffer.push(text);length+=text.length;if(length>=256*1024)flush();}
    append('{');var first=true;
    for(var key of Object.keys(portable)){
        if(portable[key]===undefined)continue;if(!first)append(',');first=false;append(JSON.stringify(key)+':');
        for(var token of jsonTokens(portable[key])){append(token);if(++tokens%512===0&&Date.now()-last>12){await yieldImport();last=Date.now();}}
    }
    if(!first)append(',');append('"_assets":{');
    var missing=[],written=0;
    for(var start=0;start<urls.length;start+=8){
        var batch=urls.slice(start,start+8),resolved=await new Promise(function(resolve){resolver(batch,resolve);});
        batch.forEach(function(url){
            var value=resolved&&resolved[url];
            if(typeof value!=='string'||!/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(value)){missing.push(url);return;}
            if(written++)append(',');append(JSON.stringify(assetName(url,prefix))+':');append(JSON.stringify(value));flush();
        });
        if(onProgress)onProgress(Math.min(start+8,urls.length),urls.length);await yieldImport();
    }
    if(missing.length){var error=new Error('有 '+missing.length+' 张图片未能打包，已停止导出完整备份。');error.missingImages=missing;throw error;}
    var manifest={version:1,images:urls.map(function(url){return assetName(url,prefix);}),imageCount:urls.length,createdAt:new Date().toISOString()};
    append('},"_backupManifest":');for(var token of jsonTokens(manifest))append(token);append('}');flush();
    return {blob:new Blob(chunks,{type:'application/json'}),manifest:manifest};
}

export function validateBackup(data) {
    var manifest = data && data._backupManifest;
    if (!manifest) return [];
    if (manifest.version !== 1 || !Array.isArray(manifest.images) || manifest.images.length !== manifest.imageCount) return ['备份图片清单无效'];
    return manifest.images.filter(function (name) { return !data._assets || !/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(data._assets[name] || ''); });
}
