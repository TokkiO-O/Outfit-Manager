// Outfit Manager · 二改版 | 导入计划调度与取消
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { buildImportPlan } from './import-plan.js';
import { checkCancelled, yieldImport } from './json-data.js';
export async function planImportAsync(meta,parts,source,mode,options,job){
    checkCancelled(job.signal);
    if(typeof Worker==='undefined'){await yieldImport();return buildImportPlan(meta,parts,source,mode,options);}
    return new Promise(function(resolve,reject){
        var worker;
        function abort(){if(worker)worker.terminate();reject(new Error('已取消导入'));}
        function finish(){if(worker)worker.terminate();job.signal.removeEventListener('abort',abort);}
        try{
            worker=new Worker(new URL('./import-plan-worker.js',import.meta.url),{type:'module'});
            job.signal.addEventListener('abort',abort,{once:true});
            worker.onmessage=function(event){var value=event.data;if(value.progress){job.update(value.progress);return;}finish();if(value.error)reject(new Error(value.error));else resolve(value.plan);};
            worker.onerror=async function(){finish();try{checkCancelled(job.signal);await yieldImport();resolve(buildImportPlan(meta,parts,source,mode,options));}catch(error){reject(error);}};
            worker.postMessage({meta:meta,parts:parts,source:source,mode:mode,options:options});
        }catch(error){finish();if(job.signal.aborted)reject(new Error('已取消导入'));else{try{resolve(buildImportPlan(meta,parts,source,mode,options));}catch(failure){reject(failure);}}}
    });
}
