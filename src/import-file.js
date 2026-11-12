// Outfit Manager · 二改版 | 备份文件分块解析
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { checkCancelled, yieldImport } from './json-data.js';
import { createLocalImageWriter } from './db/local-images.js';

// Incremental JSON reader: no file-sized string, including legacy .json backups.
export async function readImportFile(file, options) {
    options=options||{};var signal=options.signal, at=0, buffer='', offset=0, finished=false, tokens=0, lastYield=Date.now(), images=0;
    var decoder=new TextDecoder('utf-8',{fatal:true}), writer=options.local ? createLocalImageWriter(signal) : null;
    async function fill() {
        if(at<buffer.length)return true;
        checkCancelled(signal);
        if(finished)return false;
        if(offset>=file.size){buffer=decoder.decode();at=0;finished=true;return !!buffer.length;}
        var end=Math.min(file.size,offset+512*1024), raw=await file.slice(offset,end).arrayBuffer();offset=end;
        buffer=decoder.decode(raw,{stream:true});at=0;
        if(options.onProgress)options.onProgress({phase:'读取备份',done:offset,total:file.size,images:images});
        return buffer.length ? true : fill();
    }
    async function peek() { return await fill()?buffer.charAt(at):''; }
    async function char() { if(!await fill())throw new Error('备份文件意外结束');return buffer.charAt(at++); }
    async function ws() { while(await fill()){var m=/\S/g;m.lastIndex=at;var found=m.exec(buffer);if(found){at=found.index;return;}at=buffer.length;} }
    async function string() {
        if(await char()!=='"')throw new Error('备份字符串格式不正确');
        var parts=[], length=0;
        while(await fill()){
            var re=/["\\]/g;re.lastIndex=at;var match=re.exec(buffer);
            if(!match){var tail=buffer.slice(at);parts.push(tail);length+=tail.length;at=buffer.length;}
            else{
                var segment=buffer.slice(at,match.index);parts.push(segment);length+=segment.length;at=match.index+1;
                if(match[0]==='"')return JSON.parse('"'+parts.join('')+'"');
                parts.push('\\'+await char());length+=2;
            }
            if(length>64*1024*1024)throw new Error('备份中的单个字段超过 64 MiB，请先检查该字段');
        }
        throw new Error('备份中有未结束的字符串');
    }
    async function value(path,depth) {
        if(depth>64)throw new Error('备份嵌套过深');
        if(++tokens%100===0&&Date.now()-lastYield>12){await yieldImport();lastYield=Date.now();checkCancelled(signal);}
        await ws();var c=await peek();
        if(c==='"'){
            var text=await string();
            if(writer&&text.indexOf('data:image/')===0&&(path[path.length-1]==='imageData'||path[0]==='_assets')){
                text=await writer.write(text);images++;
            }
            return text;
        }
        if(c==='{'||c==='['){
            var array=c==='[',result=array?[]:{},end=array?']':'}';at++;await ws();
            if(await peek()===end){at++;return result;}
            while(true){
                var key=array?result.length:await string();
                if(!array){await ws();if(await char()!==':')throw new Error('备份属性缺少冒号');}
                var item=await value(path.concat(key),depth+1);
                if(array)result.push(item);else if(key!=='__proto__'&&key!=='constructor'&&key!=='prototype')result[key]=item;
                await ws();var next=await char();if(next===end)return result;if(next!==',')throw new Error('备份列表分隔符无效');await ws();
            }
        }
        var chars=[];
        while(await fill()){var next=buffer.charAt(at);if(/[\s,\]}]/.test(next))break;chars.push(next);at++;}
        if(!chars.length)throw new Error('备份内容不完整');
        return JSON.parse(chars.join(''));
    }
    var result=await value([],0);await ws();if(await peek())throw new Error('备份末尾有多余内容');
    if(writer)await writer.flush();checkCancelled(signal);
    if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('备份必须是一个对象');
    return result;
}
