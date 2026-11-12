// Outfit Manager · 二改版 | 导入计划的后台计算入口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { buildImportPlan } from './import-plan.js';
self.onmessage=function(event){
    try{
        var value=event.data,options=Object.assign({},value.options,{onProgress:function(done,total){self.postMessage({progress:{phase:'比较与整理穿搭',done:done,total:total}});}});
        self.postMessage({plan:buildImportPlan(value.meta,value.parts,value.source,value.mode,options)});
    }catch(error){self.postMessage({error:error.message||'备份格式不正确'});}
};
