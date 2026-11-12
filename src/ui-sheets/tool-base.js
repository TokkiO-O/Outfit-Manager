// Outfit Manager · 二改版 | 衣柜工具容器、分页与聊天归属检查
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { fn } from '../bridge.js';
import { currentPartKey, ensurePartitionLoaded } from '../db/index.js';
import { getChatIdentity, subscribeChat } from '../chat-state.js';
import { esc, toast } from '../utils.js';
import { currentPresetLabel } from '../preset-service.js';
import { createSheet, closeSheet } from './sheet-base.js';
export function toolButton(label,action,attrs,kind){return '<button type="button" class="om-btn '+(kind||'om-btn-outline')+'" data-tool="'+action+'" '+(attrs||'')+'>'+label+'</button>';}
export function pageBar(page,total,size){var last=Math.max(1,Math.ceil(total/size));return '<div class="om-tool-pagination"><span>共 '+total+' 项 · '+(page+1)+' / '+last+' 页</span>'+toolButton('上一页','prev',page<=0?'disabled':'')+toolButton('下一页','next',page>=last-1?'disabled':'')+'</div>';}
export function readPart(key){return new Promise(function(resolve,reject){ensurePartitionLoaded(key,function(part,error){if(part&&!part.__omCold)resolve(part);else reject(error||new Error('衣柜未能载入，请在设置 → 调试中查看保存状态'));});});}
export function refreshTools(){['renderCatbar','renderAccCatbar','renderGrid','renderBottomStatus','updateBtn'].forEach(function(name){if(fn[name])fn[name]();});}
export async function openTool(title,intro){
    if(fn.ensureChatPartitions)await fn.ensureChatPartitions();
    var identity=getChatIdentity(),key=currentPartKey(),part=await readPart(key);
    if(identity!==getChatIdentity()||key!==currentPartKey())throw new Error('聊天或衣柜已切换，请重新打开');
    var off=function(){},sheet=createSheet('<div class="om-sheet-title">'+esc(title)+'</div><p class="om-hint om-tool-intro">'+esc(intro)+'</p><div class="om-tool-context">当前预设 · '+esc(currentPresetLabel())+'</div><div class="om-tool-switched" hidden>聊天或衣柜已切换，请关闭后重新打开此页。</div><div class="om-tool-body"></div><div class="om-tool-footer">'+toolButton('完成','close')+'</div>',{modal:true,medium:true,onClose:function(){off();}});
    function valid(){return getChatIdentity()===identity&&currentPartKey()===key;}
    off=subscribeChat(function(){if(!valid()){sheet.querySelector('.om-tool-switched').hidden=false;sheet.querySelectorAll('.om-tool-body button,.om-tool-body input,.om-tool-body select').forEach(function(el){el.disabled=true;});}});
    sheet.addEventListener('click',function(event){if(event.target.closest('[data-tool="close"]'))closeSheet(sheet);});
    return {sheet:sheet,body:sheet.querySelector('.om-tool-body'),key:key,part:part,identity:identity,valid:valid,guard:function(){if(!valid())throw new Error('聊天或衣柜已切换，请重新打开');},fail:function(error){toast(error.message||String(error),true);},close:function(){closeSheet(sheet);}};
}
