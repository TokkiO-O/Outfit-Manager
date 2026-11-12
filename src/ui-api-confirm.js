// Outfit Manager · 二改版 | 批量调用用量与修改范围确认
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { createSheet, closeSheet } from './ui-sheets/sheet-base.js';
import { esc } from './utils.js';

export function confirmApiBatch(options) {
    return new Promise(function (resolve) {
        var settled=false,unlockTimer=null;
        function finish(value){if(settled)return;settled=true;clearTimeout(unlockTimer);closeSheet(sheet);resolve(value);}
        var sheet=createSheet('<div class="om-sheet-title">确认本次 API 调用</div><div class="om-feature-content">'+
            '<p class="om-api-confirm-count"><strong>'+options.count+'</strong> '+esc(options.unit||'套穿搭')+'</p>'+
            '<p>即将'+esc(options.action||'识图分类')+'，预计最多 <strong>'+options.count+' 次 API 请求</strong>，将使用接口额度。</p>'+
            '<p class="om-hint">'+esc(options.note||'只处理刚才确认的范围。开始后可停止后续请求；已发出的请求可能已经计费。')+'</p>'+
            '<div class="om-edit-foot"><button type="button" class="om-btn om-btn-outline" id="om-api-confirm-cancel">返回，不调用</button><button type="button" class="om-btn om-btn-safe" id="om-api-confirm-start">确认开始 · '+options.count+'</button></div></div>',
            {modal:true,medium:true,onClose:function(){clearTimeout(unlockTimer);if(!settled){settled=true;resolve(false);}}});
        sheet.querySelector('#om-api-confirm-cancel').onclick=function(){finish(false);};
        var start=sheet.querySelector('#om-api-confirm-start');start.disabled=true;
        start.onclick=function(){finish(true);};
        // Ignore a double tap that opened this new dialog at the same location.
        unlockTimer=setTimeout(function(){if(sheet.isConnected)start.disabled=false;},450);
        sheet.querySelector('#om-api-confirm-cancel').focus({preventScroll:true});
    });
}

export function confirmCategoryChange(count, target, unit) {
    return new Promise(function(resolve){
        var settled=false;function finish(value){if(settled)return;settled=true;closeSheet(sheet);resolve(value);}
        var sheet=createSheet('<div class="om-sheet-title">确认修改分类</div><div class="om-feature-content"><p>将为 <strong>'+count+'</strong> '+esc(unit||'套穿搭')+(target?'设置分类为 <strong>'+esc(target)+'</strong>':'清除现有分类')+'。</p><p class="om-hint">本次不调用 API，确认后可在“操作撤销”恢复。</p><div class="om-edit-foot"><button type="button" class="om-btn om-btn-outline" id="om-local-confirm-cancel">返回</button><button type="button" class="om-btn om-btn-safe" id="om-local-confirm-start">确认修改 · '+count+'</button></div></div>',{modal:true,medium:true,onClose:function(){if(!settled){settled=true;resolve(false);}}});
        sheet.querySelector('#om-local-confirm-cancel').onclick=function(){finish(false);};sheet.querySelector('#om-local-confirm-start').onclick=function(){finish(true);};sheet.querySelector('#om-local-confirm-cancel').focus({preventScroll:true});
    });
}
