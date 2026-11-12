// Outfit Manager · 二改版 | 导入预览、范围确认与保存
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB } from './db/state.js';
import { loadMeta, withLoadedPartitions, currentUserPartKey } from './db/index.js';
import { metaForStorage, partitionForStorage, applyChatPartition, applyChatContext, notifyChat } from './chat-state.js';
import { idbPutBatch } from './db/idb.js';
import { scheduleServerPutKey } from './db/server-partitions.js';
import { validateMetaPayload, validatePartitionPayload } from './db/init.js';
import { createSheet, closeSheet } from './ui-sheets/sheet-base.js';
import { esc, toast } from './utils.js';
import { fn } from './bridge.js';
import { copyJson, sameJson, checkCancelled, yieldImport } from './json-data.js';
import { prepareImportMedia } from './import-media.js';
import { planImportAsync } from './import-planner.js';
import { createImportProgress } from './import-progress.js';
import { wardrobeContentOnly } from './wardrobe-transfer.js';

function comparable() {
    var parts={};
    Object.keys(DB.partCache).forEach(function(key){parts[key]=partitionForStorage(key,DB.partCache[key]);});
    return {meta:metaForStorage(loadMeta()),parts:parts};
}
export async function reviewImport(source,mode,options) {
    options=options||{};
    if(DB.serverInitFailed||DB.syncConflict){if(options.job)options.job.cancel();toast('请先处理保存或同步冲突，再导入备份',true);return;}
    var job=options.job||createImportProgress();if(!job)return;
    var target=options.targetUserKey||currentUserPartKey(),keys=Object.keys(DB.knownPartKeys);
    try{
        source=wardrobeContentOnly(source,true);
        return await withLoadedPartitions(keys,async function(){
            checkCancelled(job.signal);
            // Structural snapshots keep immutable image strings shared, rather
            // than making a file-sized JSON string or a second encoded copy.
            var snapshot=copyJson(comparable()),base=copyJson(snapshot),incoming=copyJson(source);
            await prepareImportMedia(incoming,base,{signal:job.signal,onProgress:job.update});
            job.update({phase:'比较与整理穿搭',done:0,total:0});await yieldImport();
            var plan=await planImportAsync(base.meta,base.parts,incoming,mode,{targetUserKey:target},job);
            checkCancelled(job.signal);
            var error=validateMetaPayload(plan.meta);if(error)throw new Error(error);
            Object.keys(plan.partitions).forEach(function(key){var invalid=validatePartitionPayload(plan.partitions[key],key);if(invalid)throw new Error(invalid);});
            var count=plan.counts,committing=false,committed=false;
            job.finishPreparing();
            var sheet=createSheet('<div class="om-sheet-title">导入预览</div><div class="om-feature-content om-import-content">'+
                '<p>新增 '+count.added+' · 更新 '+count.updated+' · 完全重复 '+count.skipped+' · 同名或同图保留 '+count.related+'</p><p class="om-hint">仅导入衣服、单品、图片、分类和搭配关系；备份中的 API、个人设置与聊天选择均忽略。</p>'+
                (mode==='replace'?'<p class="om-feature-notice">将替换目标衣柜中的 '+count.removed+' 条原记录；其他衣柜和聊天穿着不受覆盖。</p>':'<p class="om-hint">同名、同图或图片相似均不会被当作同一套衣服自动丢弃。</p>')+
                '<div id="om-import-rows" class="om-import-scroll"></div><div id="om-import-pages"></div><p id="om-import-save-status" role="status"></p><div class="om-edit-foot om-import-footer"><button type="button" class="om-btn om-btn-safe" id="om-import-confirm">确认导入</button><button type="button" class="om-btn om-btn-outline" id="om-import-cancel">取消</button></div></div>',
                {modal:true,medium:true,onClose:function(){if(committed)job.release();else job.cancel();}});
            var page=0,size=40;
            sheet.querySelector('.om-sheet').classList.add('om-import-review');
            function renderRows(){
                sheet.querySelector('#om-import-rows').innerHTML=plan.rows.slice(page*size,(page+1)*size).map(function(row){
                    return '<div class="om-import-row"><strong>'+esc(row.name)+'</strong><small>'+esc(row.owner+' · '+row.kind+' · '+row.action)+'</small>'+
                        (row.before?'<details><summary>查看更新内容</summary><p>原：'+esc(row.before.description||row.before.name||'')+'</p><p>新：'+esc(row.after.description||row.after.name||'')+'</p></details>':'')+'</div>';
                }).join('');
                sheet.querySelector('#om-import-pages').innerHTML=plan.rows.length>size?'<div class="om-debug-actions"><button type="button" class="om-btn om-btn-outline" data-page="-1"'+(!page?' disabled':'')+'>上一页</button><span>'+(page+1)+' / '+Math.ceil(plan.rows.length/size)+'</span><button type="button" class="om-btn om-btn-outline" data-page="1"'+((page+1)*size>=plan.rows.length?' disabled':'')+'>下一页</button></div>':'';
            }
            renderRows();
            sheet.addEventListener('click',function(event){var el=event.target.closest('[data-page]');if(el&&!committing){page+=Number(el.dataset.page);renderRows();}});
            sheet.addEventListener('click',function(event){if(committing&&event.target===sheet){event.preventDefault();event.stopImmediatePropagation();}},true);
            sheet.querySelector('#om-import-cancel').onclick=function(){if(!committing)closeSheet(sheet);};
            sheet.querySelector('#om-import-confirm').onclick=async function(){
                if(committing)return;committing=true;this.disabled=true;this.textContent='正在核对与保存…';
                sheet.querySelector('#om-import-cancel').disabled=true;
                try{
                    await withLoadedPartitions(Object.keys(DB.knownPartKeys),async function(){
                        checkCancelled(job.signal);
                        if(!sameJson(snapshot,comparable()))throw new Error('预览期间衣柜发生了修改，请重新打开导入预览');
                        sheet.querySelector('#om-import-save-status').textContent='正在保存衣柜索引和导入前副本，请稍候…';await yieldImport();checkCancelled(job.signal);
                        // Images were durably cached first. Only small metadata,
                        // the recovery copy and index change in this transaction.
                        var entries=Object.keys(plan.partitions).map(function(key){return {key:key,value:plan.partitions[key]};});
                        entries.push({key:'meta',value:plan.meta},{key:'om_before_import_v4',value:base});
                        var ok=await new Promise(function(resolve){idbPutBatch(entries,resolve);});
                        if(!ok)throw new Error('本地保存未完成，原衣柜已保留；请检查可用存储空间');
                        committed=true;
                        DB.metaCache=copyJson(plan.meta);
                        Object.keys(plan.partitions).forEach(function(key){
                            DB.libraryActiveIds[key]=plan.partitions[key].activeIds.slice();
                            DB.partCache[key]=applyChatPartition(key,copyJson(plan.partitions[key]));DB.knownPartKeys[key]=true;
                            delete DB.partColdStub[key];delete DB.partLoadErrors[key];scheduleServerPutKey(key);
                        });
                        applyChatContext();scheduleServerPutKey('meta');
                    });
                    if(fn.renderViewbar)fn.renderViewbar();if(fn.requestWardrobeRefresh)fn.requestWardrobeRefresh();
                    notifyChat();closeSheet(sheet);toast('导入完成：新增 '+count.added+'，更新 '+count.updated+'，完全重复跳过 '+count.skipped);
                }catch(failure){
                    toast(failure.message,true);sheet.querySelector('#om-import-save-status').textContent=failure.message;
                    this.disabled=false;this.textContent='确认导入';sheet.querySelector('#om-import-cancel').disabled=false;
                }finally{committing=false;}
            };
            return plan;
        });
    }catch(error){job.cancel();toast('导入已停止：'+error.message,true);return null;}
}
