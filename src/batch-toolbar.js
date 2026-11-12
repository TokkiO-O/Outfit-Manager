// Outfit Manager · 二改版 | 多选工具栏与分组操作
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { state, fn } from './bridge.js';
import { currentPartKey } from './db/index.js';
import { getChatIdentity } from './chat-state.js';
import { createSheet, closeSheet } from './ui-sheets/sheet-base.js';
import { esc, toast } from './utils.js';
import { openAutoClassifyModal } from './ui-outfits/classify.js';

function actions(kind) {
    if(kind==='accessory')return [
        ['整理','分类','放入指定分类，不调用 API','om-acc-batch-cat','fa-folder'],
        ['整理','移动 / 复制','转到其他衣柜或分类','om-acc-batch-move','fa-arrow-right-arrow-left'],
        ['AI 辅助','生成描述','先看数量，默认只补缺描述','om-acc-batch-desc','fa-wand-magic-sparkles'],
        ['导出与删除','导出所选','包含图片，不包含 API 与个人设置','export-accessories','fa-download'],
        ['导出与删除','删除所选','执行前确认，支持撤销','om-acc-batch-del','fa-trash']
    ];
    return [
        ['整理','手动分类','放入指定分类，不调用 API','om-batch-cat','fa-folder'],
        ['整理','标签建议','本地整理时代、风格和用途，不用 API','local-tags','fa-tags'],
        ['整理','统一设置标签','为所选穿搭手动添加或替换标签','om-batch-tag','fa-tag'],
        ['整理','移动 / 复制','转到其他衣柜或分类','om-batch-move','fa-arrow-right-arrow-left'],
        ['AI 辅助','图片自动分类','选择数量，再次确认后调用 API','image-classify','fa-layer-group'],
        ['AI 辅助','生成描述','先看数量，默认只补缺描述','om-batch-aidesc','fa-wand-magic-sparkles'],
        ['导出与删除','导出所选','包含关联单品与图片，不包含个人设置','om-batch-export','fa-download'],
        ['导出与删除','删除所选','执行前确认，支持撤销','om-batch-del','fa-trash']
    ];
}
export function batchToolbarHTML(kind) {
    var acc=kind==='accessory',prefix=acc?'om-acc-batch':'om-batch';
    var hidden=actions(kind).filter(function(item){return item[3].startsWith('om-');}).map(function(item){return '<button type="button" id="'+item[3]+'">'+item[1]+'</button>';}).join('');
    return '<div class="om-batch-bar om-batch-compact"><span class="om-batch-info">已选 <b id="om-batch-count">'+state.batchSelected.length+'</b> '+(acc?'件':'套')+'</span>'+
        '<div class="om-batch-selection"><button type="button" class="om-batch-btn" id="'+prefix+'-selall">全选</button><button type="button" class="om-batch-btn" id="'+prefix+'-none">清空</button></div>'+
        '<button type="button" class="om-batch-btn om-batch-menu-open" id="om-batch-actions-open" aria-haspopup="dialog">批量操作 <i class="fa-solid fa-chevron-down"></i></button></div>'+
        '<div hidden class="om-batch-action-triggers">'+hidden+'</div>';
}
export function bindBatchToolbar(area,kind) {
    var opener=area.querySelector('#om-batch-actions-open');if(!opener)return;
    opener.onclick=function(){
        var selected=state.batchSelected.slice(),source=currentPartKey(),identity=getChatIdentity(),items=actions(kind),groups=['整理','AI 辅助','导出与删除'];
        var sheet=createSheet('<div class="om-sheet-title">批量操作 · 已选 '+selected.length+' '+(kind==='accessory'?'件单品':'套穿搭')+'</div><div class="om-feature-content om-batch-menu">'+
            (!selected.length?'<p class="om-hint">先勾选衣服或单品，再选择下面的操作。</p>':'')+
            groups.map(function(group){return '<section><h3>'+group+'</h3><div class="om-batch-menu-grid">'+items.filter(function(item){return item[0]===group;}).map(function(item){return '<button type="button" class="om-batch-menu-item'+(/-del$/.test(item[3])?' danger':'')+'" data-batch-action="'+item[3]+'"'+(!selected.length?' disabled':'')+'><i class="fa-solid '+item[4]+'"></i><span><strong>'+item[1]+'</strong><small>'+esc(item[2])+'</small></span></button>';}).join('')+'</div></section>';}).join('')+
            '<div class="om-edit-foot"><button type="button" class="om-btn om-btn-outline" id="om-batch-menu-close">返回选择</button></div></div>',{modal:true,medium:true});
        sheet.querySelector('#om-batch-menu-close').onclick=function(){closeSheet(sheet);};
        sheet.querySelectorAll('[data-batch-action]').forEach(function(button){button.onclick=function(){
            closeSheet(sheet);
            if(currentPartKey()!==source||getChatIdentity()!==identity){toast('聊天或衣柜已切换，请重新勾选',true);return;}
            var action=button.dataset.batchAction;
            if(action==='image-classify'){openAutoClassifyModal(selected);return;}
            if(action==='local-tags'){if(fn.autoTagUntagged)fn.autoTagUntagged();return;}
            if(action==='export-accessories'){if(fn.exportSelectedAccessories)fn.exportSelectedAccessories(selected);return;}
            var target=area.querySelector('#'+action);if(target)target.click();
        };});
    };
}
