// Outfit Manager · 二改版 | 本地图片独立持久存储与缓存
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { idbGet, idbGetAllKeys, idbPutBatch } from './idb.js';

export var LOCAL_IMAGE_PREFIX = 'om-image:';
var IMAGE_KEY = 'image:', known = null, loading = null, urls = new Map(), inFlight = new Map();
export function isLocalImage(value) { return typeof value === 'string' && /^om-image:[a-f0-9]{64}\.(png|jpg|webp|gif|bmp|avif)$/.test(value); }
function key(ref) { return IMAGE_KEY + ref.slice(LOCAL_IMAGE_PREFIX.length); }
async function knownImages() {
    if (!loading) loading = new Promise(function (resolve) { idbGetAllKeys(function (keys) { known = new Set(keys.filter(function (item) { return typeof item === 'string' && item.indexOf(IMAGE_KEY) === 0; })); resolve(known); }); });
    return loading;
}
function cancelled(signal) { if (signal && signal.aborted) throw new Error('已取消导入'); }
// SHA-256 fallback for ordinary HTTP origins without SubtleCrypto.
function sha256(bytes) {
    var k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], len = bytes.length;
    var padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64); padded.set(bytes); padded[len] = 128;
    var view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(len / 0x20000000)); view.setUint32(padded.length - 4, len * 8 >>> 0);
    function r(x,n) { return x >>> n | x << 32-n; }
    var w = new Uint32Array(64);
    for (var offset = 0; offset < padded.length; offset += 64) {
        for (var i=0;i<16;i++) w[i]=view.getUint32(offset+i*4);
        for (i=16;i<64;i++) { var x=w[i-15],y=w[i-2]; w[i]=(w[i-16]+(r(x,7)^r(x,18)^x>>>3)+w[i-7]+(r(y,17)^r(y,19)^y>>>10))>>>0; }
        var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],j=h[7];
        for (i=0;i<64;i++) { var t=(j+(r(e,6)^r(e,11)^r(e,25))+(e&f^~e&g)+k[i]+w[i])>>>0, u=((r(a,2)^r(a,13)^r(a,22))+(a&b^a&c^b&c))>>>0; j=g;g=f;f=e;e=(d+t)>>>0;d=c;c=b;b=a;a=(t+u)>>>0; }
        [a,b,c,d,e,f,g,j].forEach(function(v,n){h[n]=(h[n]+v)>>>0;});
    }
    return h.map(function(v){return v.toString(16).padStart(8,'0');}).join('');
}
export async function imageBlobAndRef(data) {
    var match = /^data:image\/(png|jpe?g|webp|gif|bmp|avif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(data || '');
    if (!match) throw new Error('备份中有无法读取的图片');
    var raw; try { raw = atob(match[2].replace(/\s/g,'')); } catch (e) { throw new Error('备份图片编码不完整'); }
    var bytes = new Uint8Array(raw.length);
    for (var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    var type=match[1].toLowerCase().replace('jpeg','jpg'), digest;
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(function(v){return v.toString(16).padStart(2,'0');}).join('');
    } else digest=sha256(bytes);
    return { ref: LOCAL_IMAGE_PREFIX + digest + '.' + type, blob: new Blob([bytes],{type:'image/'+(type==='jpg'?'jpeg':type)}) };
}
export function createLocalImageWriter(signal) {
    var entries=[], added=[], bytes=0, seen=new Set();
    async function flush() {
        cancelled(signal); if (!entries.length) return;
        var batch=entries;entries=[];bytes=0;
        var ok=await new Promise(function(resolve){idbPutBatch(batch,resolve);});
        if(!ok)throw new Error('图片未能保存到本机，请检查可用存储空间；原衣柜未被替换');
        batch.forEach(function(entry){known.add(entry.key);});
    }
    return {
        write: async function(data) {
            cancelled(signal); var set=await knownImages(), image=await imageBlobAndRef(data); cancelled(signal);
            var assetKey=key(image.ref);
            if(!set.has(assetKey)&&!seen.has(assetKey)){seen.add(assetKey);added.push(image.ref);entries.push({key:assetKey,value:image.blob});bytes+=image.blob.size;}
            if(entries.length>=8||bytes>=2*1024*1024)await flush();
            return image.ref;
        },
        flush: flush,
        get added(){return added.length;}
    };
}
export function getLocalImageBlob(ref) {
    if(!isLocalImage(ref))return Promise.reject(new Error('本地图片引用无效'));
    return new Promise(function(resolve,reject){idbGet(key(ref),function(value){if(value instanceof Blob)resolve(value);else reject(new Error('本地图片缺失，请重新导入完整备份'));});});
}
export async function hasLocalImage(ref) { return isLocalImage(ref) && (await knownImages()).has(key(ref)); }
export function peekLocalImageURL(ref) {
    var value=urls.get(ref); if(!value)return null;urls.delete(ref);urls.set(ref,value);return value;
}
export function resolveLocalImageURL(ref) {
    var cached=peekLocalImageURL(ref);if(cached)return Promise.resolve(cached);
    if(inFlight.has(ref))return inFlight.get(ref);
    var task=getLocalImageBlob(ref).then(function(blob){
        var url=URL.createObjectURL(blob);urls.set(ref,url);
        while(urls.size>192){var old=urls.keys().next().value;URL.revokeObjectURL(urls.get(old));urls.delete(old);}
        return url;
    }).finally(function(){inFlight.delete(ref);});
    inFlight.set(ref,task);return task;
}
export function resolveLocalImageData(ref) {
    return getLocalImageBlob(ref).then(function(blob){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){reject(new Error('本地图片读取失败'));};reader.readAsDataURL(blob);});});
}
// Popup images retain the persistent reference; blob URLs are display-only.
export function hydrateLocalImages(root) {
    if(!root||!root.querySelectorAll)return;
    root.querySelectorAll('img').forEach(function(img){
        var ref=img.getAttribute('src');if(!isLocalImage(ref))return;
        img.setAttribute('data-om-local-image',ref);img.removeAttribute('src');
        resolveLocalImageURL(ref).then(function(url){if(img.isConnected&&img.getAttribute('data-om-local-image')===ref)img.src=url;}).catch(function(){img.alt=img.alt||'图片暂未读取';});
    });
}
