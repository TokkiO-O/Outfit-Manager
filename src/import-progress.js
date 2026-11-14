// Outfit Manager · 二改版 | 导入阶段进度
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { createSheet, closeSheet } from './ui-sheets/sheet-base.js';
import { toast } from './utils.js';
import { recordImportDiagnostic, diagnosticErrorKind } from './compatibility-journal.js';
var active=null, diagnosticSequence=0;
export function createImportProgress() {
    if(active){toast('已有导入正在处理，请先完成或取消');return null;}
    var controller=new AbortController(),last=0,diagnosticToken=++diagnosticSequence;
    function note(stage,fields){recordImportDiagnostic(diagnosticToken,stage,fields);}
    note('preparing');
    var sheet=createSheet('<div class="om-sheet-title">正在准备导入</div><div class="om-feature-content"><p id="om-import-phase" role="status">正在读取备份…</p><progress id="om-import-progress" max="100" value="0" style="width:100%"></progress><p class="om-hint" id="om-import-progress-detail">大备份会分块读取，请稍候。</p><button type="button" class="om-btn om-btn-outline" id="om-import-stop">取消导入</button></div>',{modal:true,medium:true,onClose:function(){note('cancelled');controller.abort();if(active===job)active=null;}});
    var job={signal:controller.signal,sheet:sheet,
        note:note,
        fail:function(error){note('failed',{category:diagnosticErrorKind(error)});},
        update:function(value){if(!sheet.isConnected)return;note(value.phase==='读取备份'?'reading':/图片/.test(value.phase||'')?'images':'preparing',{done:value.done,total:value.total});var now=Date.now();if(now-last<80&&value.done!==value.total)return;last=now;sheet.querySelector('#om-import-phase').textContent=value.phase||'正在整理';var progress=sheet.querySelector('#om-import-progress');if(value.total){progress.value=Math.floor(value.done/value.total*100);progress.max=100;}else progress.removeAttribute('value');sheet.querySelector('#om-import-progress-detail').textContent=value.total?(value.phase==='读取备份'?(value.done/1048576).toFixed(1)+' / '+(value.total/1048576).toFixed(1)+' MiB · 已整理 '+(value.images||0)+' 张图片':value.done+' / '+value.total):'请稍候，完成后会显示导入预览。';},
        close:function(){closeSheet(sheet);},
        release:function(){if(active===job)active=null;},
        finishPreparing:function(){note('preview');sheet._omOnClose=null;closeSheet(sheet);},
        cancel:function(){note('cancelled');controller.abort();closeSheet(sheet);if(active===job)active=null;}
    };
    sheet.querySelector('#om-import-stop').onclick=job.cancel;active=job;return job;
}
