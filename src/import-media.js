// Outfit Manager · 二改版 | 导入图片的持久化与引用处理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, IMAGE_URL_PREFIX } from './db/state.js';
import { uploadImage } from './db/images.js';
import { createLocalImageWriter, isLocalImage, hasLocalImage, resolveLocalImageData } from './db/local-images.js';
import { checkCancelled, yieldImport } from './json-data.js';

export async function prepareImportMedia(source, base, options) {
    options=options||{};var signal=options.signal, local=!DB.serverMode, writer=local?createLocalImageWriter(signal):null;
    var assets=source._assets||{}, manifest=source._backupManifest, names=Object.keys(assets), done=0;
    if(manifest&&(manifest.version!==1||!Array.isArray(manifest.images)||manifest.images.length!==manifest.imageCount))throw new Error('备份图片清单无效');
    if(manifest&&manifest.images.some(function(name){return !Object.prototype.hasOwnProperty.call(assets,name);}))throw new Error('备份缺少图片，请从原酒馆重新完整导出');
    async function store(value) {
        checkCancelled(signal);
        if(isLocalImage(value)){
            if(!await hasLocalImage(value))throw new Error('备份引用的本地图片缺失，请重新导入包含图片的完整备份');
            if(local)return value;value=await resolveLocalImageData(value);
        }
        if(typeof value!=='string'||value.indexOf('data:image/')!==0)throw new Error('备份图片格式不完整');
        if(local)return writer.write(value);
        var result=await new Promise(function(resolve,reject){uploadImage(value,function(error,url){if(error)reject(new Error(error));else resolve(url);});});
        if(!result||result.indexOf(IMAGE_URL_PREFIX)!==0)throw new Error('图片上传未完成，已停止导入；原衣柜保持原样');
        return result;
    }
    // Bounded batches rather than thousands of simultaneous upload requests.
    for(var n=0;n<names.length;n+=4){
        await Promise.all(names.slice(n,n+4).map(async function(name){assets[name]=await store(assets[name]);done++;}));
        if(options.onProgress)options.onProgress({phase:local?'核对本地图片':'保存备份图片',done:done,total:names.length});
        if(writer)await writer.flush();await yieldImport();checkCancelled(signal);
    }
    var fields=[];
    function part(value,existing){
        if(!value)return;
        ['outfits','accessories'].forEach(function(kind){(value[kind]||[]).forEach(function(item){if(item&&item.imageData)fields.push({item:item,key:'imageData',existing:existing});});});
    }
    part(source,false);part(source.preset,false);Object.keys(source.chars||{}).forEach(function(name){part(source.chars[name],false);});(source.presets||[]).forEach(function(p){part(p,false);});
    Object.keys(base.parts).forEach(function(key){part(base.parts[key],true);});
    for(var i=0;i<fields.length;i++){
        checkCancelled(signal);var field=fields[i],value=field.item[field.key];
        if(typeof value!=='string')continue;
        if(value.indexOf(IMAGE_URL_PREFIX)===0){
            var name=value.slice(IMAGE_URL_PREFIX.length);
            if(assets[name])field.item[field.key]=assets[name];
            else if(local&&!field.existing)throw new Error('备份有图片地址但缺少对应图片，请重新完整导出后导入');
        }else if(value.indexOf('data:image/')===0||isLocalImage(value))field.item[field.key]=await store(value);
        if(i%32===0){if(writer)await writer.flush();if(options.onProgress)options.onProgress({phase:'整理衣柜图片引用',done:i,total:fields.length});await yieldImport();}
    }
    if(writer)await writer.flush();
    // A custom floating-ball image is small and uses a CSS background.
    for(var item of [source,base.meta]){
        var fab=item.fabImage;
        if(typeof fab==='string'&&fab.indexOf(IMAGE_URL_PREFIX)===0&&assets[fab.slice(IMAGE_URL_PREFIX.length)])fab=assets[fab.slice(IMAGE_URL_PREFIX.length)];
        if(isLocalImage(fab))item.fabImage=await resolveLocalImageData(fab);
    }
    delete source._assets;delete source._backupManifest;checkCancelled(signal);
}
