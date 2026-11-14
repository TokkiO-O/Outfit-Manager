// Outfit Manager · 二改版 | 不依赖酒馆扩展脚本的恢复页面
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。
import { DIAGNOSTIC_JOB_KEY, DIAGNOSTIC_CANCEL_KEY, sanitizeDiagnosticJob } from './diagnostic-job.js';
import { restoreDiagnosticHost, diagnosticRequestHeaders } from './diagnostic-host.js';

var status=document.getElementById('status'),details=document.getElementById('details'),button=document.getElementById('restore');
function read(){try{return sanitizeDiagnosticJob(JSON.parse(localStorage.getItem(DIAGNOSTIC_JOB_KEY)));}catch(ignored){return null;}}
function paint(){var job=read();button.disabled=!job;status.textContent=job?(job.restoreDone?'原开关已确认恢复。':'发现排查记录，可恢复所选开关。'):'没有可用的排查记录。若记录已被手动清除，请到酒馆扩展页手动恢复开关。';details.textContent=job?'此次所选扩展：\n'+job.targets.join('\n'):'';}
async function clean(job){
    var pending=false;
    if(job.storage==='server')try{var response=await fetch('/api/plugins/outfit-manager/diagnostics/clients/'+job.id,{method:'DELETE',headers:await diagnosticRequestHeaders(),credentials:'same-origin'}),value=await response.json();pending=!response.ok||!value.ok||value.cleanupPending;}catch(ignored){pending=true;}
    for(var round of job.roundIds||[])await new Promise(function(resolve){var req=indexedDB.deleteDatabase('outfit_mgr_diagnostic_'+job.id+'_'+round);req.onsuccess=resolve;req.onerror=req.onblocked=function(){pending=true;resolve();};});
    await new Promise(function(resolve){var req=indexedDB.open('outfit_mgr_diagnostic_jobs_v1',1);req.onupgradeneeded=function(){req.result.createObjectStore('data');};req.onerror=function(){pending=true;resolve();};req.onsuccess=function(){var db=req.result,tx=db.transaction('data','readwrite'),prefix=job.id+':',cursor=tx.objectStore('data').openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));cursor.onsuccess=function(){if(cursor.result){cursor.result.delete();cursor.result.continue();}};tx.oncomplete=function(){db.close();resolve();};tx.onerror=tx.onabort=function(){pending=true;db.close();resolve();};};});
    for(var i=localStorage.length-1;i>=0;i--){var key=localStorage.key(i);if(key&&(key.startsWith('om_diagnostic_chat:'+job.id+':')||key.startsWith('outfit_mgr_diagnostic_seen:'+job.id+':')||key==='outfit_mgr_diagnostic_legacy:'+job.id))localStorage.removeItem(key);}
    return pending;
}
button.onclick=async function(){
    var job=read();if(!job)return;button.disabled=true;
    try{
        if(job.phase!=='restored'&&Date.now()-job.heartbeatAt<30000){localStorage.setItem(DIAGNOSTIC_CANCEL_KEY,JSON.stringify({id:job.id,at:Date.now()}));status.textContent='已请求正在运行的窗口取消。请先关闭或取消原排查；原窗口已退出时，等待约 30 秒再点恢复。';return;}
        job.cancelRequested=true;job.phase='restoring';localStorage.setItem(DIAGNOSTIC_JOB_KEY,JSON.stringify(job));
        status.textContent='正在恢复并核对开关…';
        var ok=await restoreDiagnosticHost(job);if(!ok)throw new Error('未确认保存成功');
        job.restoreDone=true;job.cleanupPending=await clean(job);job.phase='restored';job.finalStatus='cancelled';job.conclusion='cancelled';job.updatedAt=Date.now();localStorage.setItem(DIAGNOSTIC_JOB_KEY,JSON.stringify(job));
        status.textContent=job.cleanupPending?'原开关已恢复，部分临时数据仍被窗口占用。关闭测试窗口后，可再次清理。':'原开关已恢复，临时测试数据已清理。请重新加载酒馆。';
    }catch(error){status.textContent='恢复未完成：宿主接口或本机存储不可用。请保留此页面，恢复连接后重试；也可到宿主扩展页手动恢复上列开关。';}finally{button.disabled=false;}
};
document.getElementById('refresh').onclick=paint;paint();
