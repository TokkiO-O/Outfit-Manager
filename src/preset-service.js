// Outfit Manager · 二改版 | 预设衣柜切换与管理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB, genId8 } from './db/state.js';
import { loadMeta, loadCurrent, ensurePartitionLoaded, deletePartition, saveMeta } from './db/index.js';
import { defPartition } from './data.js';
import { copyJson } from './json-data.js';
import { getChatIdentity, getChatState, setChatPreset, applyChatContext, notifyChat, getBoundPresetId } from './chat-state.js';
import { commitWardrobeChanges } from './library-mutations.js';
import { fn } from './bridge.js';
var ORIGINAL_KEY='user:__default__',ORIGINAL_ID='__default__';
export function presetLabel(id) {var entry=(loadMeta().presets||[]).find(function(item){return item.id===(id||ORIGINAL_ID);});return entry?entry.name:'未选择预设';}
export async function retainOriginalWardrobe() {
    var meta=loadMeta();if((meta.presets||[]).some(function(item){return item.partKey===ORIGINAL_KEY;}))return false;
    var part=await new Promise(function(resolve,reject){ensurePartitionLoaded(ORIGINAL_KEY,function(value,error){if(value)resolve(value);else reject(error||new Error('原有衣柜未能载入'));});});
    if(!(part.outfits||[]).length&&!(part.accessories||[]).length)return false;
    meta=copyJson(loadMeta());if(meta.presets.some(function(item){return item.partKey===ORIGINAL_KEY;}))return false;
    var name='原有衣柜',n=2;while(meta.presets.some(function(item){return item.name===name;}))name='原有衣柜 '+n++;
    meta.presets.unshift({id:ORIGINAL_ID,name:name,partKey:ORIGINAL_KEY});await commitWardrobeChanges({},meta);refresh();return true;
}
function refresh(){applyChatContext();if(fn.renderViewbar)fn.renderViewbar();if(fn.renderCatbar)fn.renderCatbar();if(fn.renderAccCatbar)fn.renderAccCatbar();notifyChat({grid:true});if(fn.updateBtn)fn.updateBtn();}
export async function choosePreset(id) {
    var identity=getChatIdentity(),meta=loadMeta(),entry=id&&(meta.presets||[]).find(function(item){return item.id===id;});
    if(id&&!entry)throw new Error('这个预设已不存在，请重新选择');
    var key=entry?entry.partKey:'user:__default__';
    var part=await new Promise(function(resolve,reject){ensurePartitionLoaded(key,function(value,error){if(value)resolve(value);else reject(error||new Error('衣柜未能载入'));});});
    if(getChatIdentity()!==identity)throw new Error('聊天已切换，请在当前聊天重新选择');
    if(getChatState())setChatPreset(id||null);else{meta.activePresetId=id||null;meta.currentView='user';meta.currentChar='';DB.libraryPresetId=id||null;saveMeta(meta);}
    refresh();return part;
}
export async function createPreset(name,fromCurrent) {
    name=String(name||'').trim();if(!name)throw new Error('请填写预设名称');
    var identity=getChatIdentity(),meta=copyJson(loadMeta()),id;do{id='p_'+genId8();}while(meta.presets.some(function(item){return item.id===id;}));
    var part=fromCurrent?copyJson(loadCurrent()):defPartition();if(part.__omCold)throw new Error('请等待当前衣柜载入后再保存');delete part.__omCold;part.activeIds=[];
    meta.presets.push({id:id,name:name,partKey:'user:'+id});var changes={};changes['user:'+id]=part;await commitWardrobeChanges(changes,meta);
    if(getChatIdentity()===identity)await choosePreset(id);return id;
}
export async function renamePreset(id,name) {var meta=copyJson(loadMeta()),entry=meta.presets.find(function(item){return item.id===id;});name=String(name||'').trim();if(!entry||!name)throw new Error('请填写有效名称');entry.name=name;await commitWardrobeChanges({},meta);refresh();}
export async function removePreset(id) {
    var meta=copyJson(loadMeta()),entry=meta.presets.find(function(item){return item.id===id;});if(!entry)throw new Error('预设已不存在');
    var active=getBoundPresetId()===id;meta.presets=meta.presets.filter(function(item){return item.id!==id;});delete meta.activePartitions[entry.partKey];
    if(meta.activePresetId===id)meta.activePresetId=null;
    if(entry.partKey===ORIGINAL_KEY){var changes={};changes[ORIGINAL_KEY]=defPartition();await commitWardrobeChanges(changes,meta);}
    else{await commitWardrobeChanges({},meta);deletePartition(entry.partKey);saveMeta(loadMeta());}
    if(active&&getChatState())setChatPreset(null);refresh();
}
export function currentPresetLabel(){return presetLabel(getBoundPresetId());}
