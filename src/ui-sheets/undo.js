// Outfit Manager · 二改版 | 操作选择、范围确认与恢复提交
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { state } from '../bridge.js';
import { loadPartition } from '../db/index.js';
import { copyJson } from '../json-data.js';
import { commitWardrobeChanges } from '../library-mutations.js';
import { undoEntry } from '../undo-actions.js';
import { esc, toast } from '../utils.js';
import { openTool, readPart, toolButton as btn, refreshTools } from './tool-base.js';
var TYPES={delete_outfits:'恢复删除的穿搭',batch_tag:'恢复标签',batch_cat:'恢复穿搭分类',batch_acc_cat:'恢复单品分类',repair_refs:'恢复引用与分类'};
export async function openActionUndoSheet(){
    try{var tool=await openTool('操作撤销','选择本次要恢复的步骤，默认不勾选。按从新到旧恢复；同一字段会回到所选最早步骤之前。记录保留在本次应用会话中。'),busy=false;
        var entries=(state.actionUndoStack||[]).filter(function(entry){return entry.partKey===tool.key;}),selected=new Set();
        tool.body.innerHTML='<p class="om-hint">当前衣柜有 '+entries.length+' 步可撤销，其他衣柜的记录会保留。</p><div class="om-btn-row">'+btn('勾选全部步骤','undo-all','id="om-au-all"')+btn('取消勾选','undo-none','id="om-au-none"')+'</div><div class="om-undo-list">'+entries.map(function(entry,index){var amount=(entry.payload&&(entry.payload.items||entry.payload.outfits)||[]).length;return '<label class="om-undo-row"><input type="checkbox" class="om-undo-chk" data-id="'+esc(entry.id)+'" data-idx="'+index+'"><span><strong>'+esc(TYPES[entry.type]||'旧版操作')+'</strong><small>'+esc(entry.label||'')+' · '+amount+' 项<br>'+esc(new Date(entry.ts).toLocaleString())+'</small></span></label>';}).join('')+(entries.length?'':'<div class="om-tool-empty">当前衣柜暂无可撤销操作。</div>')+'</div><p class="om-hint" id="om-au-summary">已选 0 步</p>'+btn('核对并撤销所选','undo-apply','id="om-au-apply" disabled','om-btn-safe');
        function paint(){tool.body.querySelectorAll('.om-undo-chk').forEach(function(c){c.checked=selected.has(c.dataset.id);});tool.body.querySelector('#om-au-summary').textContent='已选 '+selected.size+' 步；恢复所选步骤涉及的字段，会覆盖这些字段后来的修改。';tool.body.querySelector('#om-au-apply').disabled=!selected.size||busy;}
        tool.body.onchange=function(event){if(event.target.matches('.om-undo-chk')){if(event.target.checked)selected.add(event.target.dataset.id);else selected.delete(event.target.dataset.id);paint();}};
        tool.body.onclick=async function(event){var b=event.target.closest('[data-tool]');if(!b||busy)return;try{tool.guard();if(b.dataset.tool==='undo-all'){entries.forEach(function(entry){selected.add(entry.id);});paint();}if(b.dataset.tool==='undo-none'){selected.clear();paint();}if(b.dataset.tool==='undo-apply'){
                    var chosen=entries.filter(function(entry){return selected.has(entry.id);});if(!chosen.length)return;if(!confirm('确认撤销当前衣柜所选 '+chosen.length+' 步？\n按从新到旧恢复，涉及字段会恢复为原值。未选择的步骤保留记录；缺失或冲突的项目不会强行覆盖。'))return;busy=true;paint();await readPart(tool.key);tool.guard();var changes={},staged=copyJson(loadPartition(tool.key)),results=new Map(),total=0;chosen.forEach(function(entry){var result=undoEntry(staged,entry);if(result.count){total+=result.count;results.set(entry.id,result.remaining);}});if(!total)throw new Error('所选记录已无法恢复，可能衣服已被移除或编号冲突');changes[tool.key]=staged;await commitWardrobeChanges(changes);state.actionUndoStack=(state.actionUndoStack||[]).map(function(entry){return results.has(entry.id)?results.get(entry.id):entry;}).filter(Boolean);refreshTools();tool.close();toast('已恢复 '+total+' 项；未完成的记录仍保留');}
            }catch(error){tool.fail(error);}finally{busy=false;paint();}};
    }catch(error){toast(error.message,true);}
}
