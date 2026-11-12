// Outfit Manager · 二改版 | 可撤销衣柜修改的恢复规则
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { copyJson } from './json-data.js';
export function undoEntry(part,entry){
    var payload=entry.payload||{},count=0,left=[];
    if(entry.type==='delete_outfits'){
        part.outfits=part.outfits||[];(payload.outfits||[]).forEach(function(o){if(!o||!o.id)return;if(part.outfits.some(function(now){return now.id===o.id;})){left.push(o);return;}part.outfits.push(copyJson(o));count++;});
        return {count:count,remaining:left.length?Object.assign({},entry,{payload:Object.assign({},payload,{outfits:left})}):null};
    }
    if(['batch_tag','batch_cat','batch_acc_cat','repair_refs'].includes(entry.type)){
        (payload.items||[]).forEach(function(item){var o=(entry.type==='batch_acc_cat'?part.accessories||[]:part.outfits||[]).find(function(now){return now.id===item.id;});if(!o){left.push(item);return;}
            if(entry.type==='batch_tag'){o.sceneTag=item.prevTag||'';if(item.prevSource)o._omTagSource=copyJson(item.prevSource);else delete o._omTagSource;}
            else if(entry.type==='repair_refs'){o.kits=copyJson(item.kits||[]);o.activeKitId=item.activeKitId||null;}
            else{o.category=item.prevCategory||'';o.subCategory=item.prevSubCategory||'';}count++;
        });
        if(entry.type==='repair_refs'){part.categories=copyJson(payload.categories||[]);part.accCategories=copyJson(payload.accCategories||[]);count++;}
        return {count:count,remaining:left.length?Object.assign({},entry,{payload:Object.assign({},payload,{items:left})}):null};
    }
    return {count:0,remaining:entry};
}
