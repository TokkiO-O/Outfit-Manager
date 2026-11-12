// Outfit Manager · 二改版 | 聊天预设选择与衣柜管理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB } from '../db/state.js';
import { loadMeta } from '../db/index.js';
import { getBoundPresetId, getChatIdentity } from '../chat-state.js';
import { choosePreset, createPreset, renamePreset, removePreset, currentPresetLabel, retainOriginalWardrobe } from '../preset-service.js';
import { esc, toast } from '../utils.js';
import { closeSheet, createSheet } from './sheet-base.js';

export async function openPresetsSheet() {
    try{await retainOriginalWardrobe();}catch(error){toast(error.message,true);return;}
    var identity=getChatIdentity(),active=getBoundPresetId(),busy=false;
    var sheet=createSheet('<div class="om-sheet-title"><i class="fa-solid fa-bookmark"></i>聊天预设</div>'+ 
        '<p class="om-hint">当前聊天使用：<strong>'+esc(currentPresetLabel())+'</strong>。在这里选择后，下次回到这段聊天会自动恢复；其他聊天各自记住自己的选择。衣服编辑会直接保存到所属预设。</p>'+ 
        '<div class="om-tool-list" id="om-preset-list"></div>'+ 
        '<section class="om-tool-section"><h3>新建衣柜</h3><label class="om-field">预设名称<input id="om-preset-name-inp" maxlength="60" placeholder="例如：古风衣柜"></label>'+ 
        '<div class="om-btn-row"><button class="om-btn om-btn-outline" id="om-preset-empty">新建空白预设</button><button class="om-btn om-btn-safe" id="om-preset-save">复制当前衣柜为预设</button></div>'+ 
        '<p class="om-hint">复制包含当前衣柜的穿搭、单品和分类，不包含 API、设置或聊天选择。</p></section>'+ 
        '<div class="om-tool-footer"><button class="om-btn om-btn-outline" id="om-presets-close">完成</button></div>',{modal:true,medium:true});
    function paint(){
        var list=loadMeta().presets||[];
        sheet.querySelector('#om-preset-list').innerHTML=list.map(function(p,idx){var part=DB.partCache[p.partKey],current=(p.id||null)===(active||null);return '<div class="om-preset-item om-tool-row'+(current?' current':'')+'" data-idx="'+idx+'" data-id="'+esc(p.id||'')+'"><button type="button" class="om-preset-select"'+(!p.id?' id="om-preset-default"':'')+'><strong class="om-preset-name">'+esc(p.name)+'</strong><small class="om-preset-count">'+(current?'本聊天正在使用':part?(part.outfits||[]).length+' 套穿搭 · '+(part.accessories||[]).length+' 件单品':'按需载入，点选切换')+'</small></button>'+(p.id?'<button type="button" class="om-btn-sm om-preset-ren" title="重命名" aria-label="重命名 '+esc(p.name)+'"><i class="fa-solid fa-pen"></i></button><button type="button" class="om-btn-sm om-preset-del" title="删除预设" aria-label="删除 '+esc(p.name)+'"><i class="fa-solid fa-trash"></i></button>':'')+'</div>';}).join('')||('<div class="om-hint">还没有预设，填写名称后即可新建。</div>');
    }
    async function run(action){if(busy)return;if(getChatIdentity()!==identity){toast('聊天已切换，请重新打开预设');closeSheet(sheet);return;}busy=true;sheet.setAttribute('aria-busy','true');try{await action();}catch(error){toast(error.message,true);}finally{busy=false;sheet.removeAttribute('aria-busy');}}
    sheet.addEventListener('click',function(event){var row=event.target.closest('.om-preset-item');if(!row)return;var id=row.dataset.id||null,entry=(loadMeta().presets||[]).find(function(p){return p.id===id;});
        if(event.target.closest('.om-preset-ren')){var name=prompt('预设名称：',entry&&entry.name||'');if(name&&name.trim())run(async function(){await renamePreset(id,name);paint();});}
        else if(event.target.closest('.om-preset-del')){if(!entry||!confirm('删除「'+entry.name+'」及其中的穿搭、单品和分类？此操作无法撤销，请先导出备份。'))return;run(async function(){await removePreset(id);active=getBoundPresetId();paint();toast('已删除预设');});}
        else run(async function(){await choosePreset(id);active=getBoundPresetId();paint();toast('本聊天已记住「'+currentPresetLabel()+'」');});
    });
    function add(copy){run(async function(){var input=sheet.querySelector('#om-preset-name-inp'),name=input.value.trim();if(!name)throw new Error('请先填写预设名称');if(copy&&!confirm('将「'+currentPresetLabel()+'」的穿搭、单品和分类复制到新预设「'+name+'」？原衣柜会保留。'))return;await createPreset(name,copy);if(getChatIdentity()!==identity){closeSheet(sheet);toast('预设已创建；聊天已切换，未自动选用');return;}active=getBoundPresetId();input.value='';paint();toast('已创建并为本聊天选用「'+name+'」');});}
    sheet.querySelector('#om-preset-empty').onclick=function(){add(false);};sheet.querySelector('#om-preset-save').onclick=function(){add(true);};sheet.querySelector('#om-presets-close').onclick=function(){closeSheet(sheet);};paint();
}
