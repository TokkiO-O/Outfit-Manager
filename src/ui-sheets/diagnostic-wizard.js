// Outfit Manager · 二改版 | 优先排查用户选中的扩展
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { createSheet, closeSheet } from './sheet-base.js';
import { esc, toast, mountPopup } from '../utils.js';
import { getDiagnosticInventory } from '../compatibility-check.js';
import { diagnosticConclusion, diagnosticPublicReport, isDiagnosticActive } from '../diagnostic-job.js';
import { readDiagnosticJob, diagnosticTabId, diagnosticBoot, subscribeDiagnosticPolicy } from '../diagnostic-policy.js';
import { startDiagnosticWizard, cancelDiagnosticWizard, retryDiagnosticRestore, continueDiagnosticWizard, manualDiagnosticResult, diagnosticRecoveryUrl, diagnosticStorageReady } from '../diagnostic-wizard.js';

var current = null;
var purposes = { baseline: '原始启用状态', 'group-off': '所选扩展全部停用', 'enable-step': '逐个恢复所选扩展', 'confirm-off': '再次停用可疑项', 'confirm-on': '再次启用可疑项' };
var stages = { preparing: '准备起始副本', loading: '加载测试衣柜', reading: '分块读取同一份 JSON', images: '处理图片', planning: '整理导入内容', preview: '导入预览', saving: '等待实际保存', verify: '刷新后核对持久数据', manual: '等待手动复现', complete: '导入已提交' };
var outcomes = { pass: '完成并通过刷新读回', fail: '复现失败', interrupted: '页面中断，待确认', blocked: '条件不完整', 'no-change': '没有新增或更新，未形成有效对照' };
var reasons = { IMPORT_FAILED: '导入路径报错；具体根因需结合错误日志判断', INIT_FAILED: '本轮衣柜初始化失败', SAVE_FAILED: '提交或同步未完成', VERIFY_FAILED: '刷新后的衣柜或图片与提交结果不一致', UNEXPECTED_RELOAD: '页面在操作中途重新载入，无法自动区分刷新、崩溃或关闭', USER_CONFIRMED_RELOAD: '你已确认页面中断就是原来的刷新问题', MANUAL_FAILURE: '你已确认相同操作出现原问题', MODEL_BLOCKED: '真实生成被保护措施阻止，或预览按钮无法自动操作，本轮不作为冲突证据', HOST_CHANGED: '宿主开关、依赖加载或测试区条件不完整', SOURCE_MISSING: '本机临时测试文件缺失', NO_CHANGE: '此文件的内容在起始衣柜已全部存在，建议换用能复现新增导入的文件', SUCCESS: '实际保存后已刷新，并重新读回核对' };
function rows(job) {
    return job.results.map(function(r,i) { return '<details class="om-compat-check" data-status="'+(r.outcome==='pass'?'pass':'attention')+'"><summary><strong>第 '+(i+1)+' 轮 · '+esc(purposes[r.purpose])+'</strong><span>'+esc(outcomes[r.outcome])+'</span></summary><p>所选范围内启用：'+esc(r.enabled.join('、')||'全部关闭')+'</p><p>'+esc(stages[r.stage]||r.stage)+' · '+esc(reasons[r.code]||'未完成有效对照')+'</p><p>穿搭 '+r.counts.outfits+' / 单品 '+r.counts.accessories+' · '+Math.round(r.durationMs/1000)+' 秒</p>'+(r.collateral.length?'<p class="om-hint">连带加载变化：'+esc(r.collateral.join('、'))+'；不能单独归因。</p>':'')+'</details>'; }).join('');
}
function download(job) {
    var url=URL.createObjectURL(new Blob([JSON.stringify(diagnosticPublicReport(job),null,2)],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='outfit-conflict-investigation-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
}
export async function openDiagnosticWizard() {
    if(current&&current.isConnected){mountPopup(current);return current;}
    var unsubscribe, inventory=[], file=null, signature='', busy=false, newRequest=false;
    var sheet=createSheet('<div class="om-sheet-title">逐轮冲突排查</div><div class="om-compat-body om-feature-content om-investigation"><div id="om-investigation-state" aria-live="polite"></div><div id="om-investigation-start"><p>仅排查你选中的扩展。使用原衣柜的独立副本，同一文件逐轮导入；每轮刷新后核对保存结果，结束后恢复扩展开关。</p><p class="om-hint">会多次刷新酒馆。先保留草稿，并暂停其他窗口的衣柜操作。测试不调用模型 API；临时副本和源文件占用额外空间，大备份会更慢。本地模式可直接使用，后端模式需要配套后端 2.3.0。</p><label class="om-compat-check">复现方式 <select id="om-investigation-mode"><option value="import">导入同一份 JSON（自动逐轮复测）</option><option value="manual">手动复现界面或选择问题（每轮自行标记）</option></select></label><p id="om-investigation-file-wrap"><input type="file" accept=".json,application/json" id="om-investigation-file"><span id="om-investigation-file-info"></span></p><p class="om-hint" id="om-investigation-manual-help" hidden>在测试副本中重复相同操作，再标记“正常”或“复现原问题”。不测试真实聊天切换、真实回复生成及模型调用；需要这些操作的问题请用兼容性检查和错误日志取证。</p><p><strong>优先排查哪些扩展（最多 8 个）</strong></p><div id="om-investigation-targets">正在读取已启用扩展…</div><label style="display:block;margin:12px 0"><input type="checkbox" id="om-investigation-consent"> 我已保留草稿，允许为此次排查临时切换所选扩展并多次刷新</label><button type="button" class="om-btn om-btn-safe" id="om-investigation-run" disabled>手动开始排查</button></div><p class="om-hint">报告仅包含开关组合、阶段、错误分类和数量，不含衣柜正文、图片、聊天、API 配置或文件名。未复现不等于没有冲突。</p><p><a id="om-investigation-recovery" target="_blank" rel="noopener">独立恢复页面（酒馆界面打不开时使用）</a></p><button type="button" class="om-btn om-btn-outline" id="om-investigation-close">关闭窗口</button></div>',{modal:true,medium:true,onClose:function(){if(unsubscribe)unsubscribe();current=null;}});
    var originalClose=sheet._omOnClose;sheet._omOnClose=function(){originalClose();var banner=document.getElementById('om-diagnostic-banner');if(banner)mountPopup(banner);};
    current=sheet; sheet.querySelector('.om-sheet').classList.add('om-compat-sheet');
    sheet.querySelector('#om-investigation-recovery').href=diagnosticRecoveryUrl();
    var state=sheet.querySelector('#om-investigation-state'),start=sheet.querySelector('#om-investigation-start');
    function paint(force) {
        if(!sheet.isConnected)return;
        var job=readDiagnosticJob(), active=isDiagnosticActive(job), next=job?JSON.stringify([job.phase,job.round&&job.round.stage,job.results.length,job.conclusion,job.restoreDone,job.cleanupPending,job.finalStatus]):'none';
        if(!force&&next===signature)return;signature=next;
        start.hidden=active||!!(job&&job.finalStatus==='paused')||diagnosticBoot.sandbox||!!(job&&!newRequest);
        if(!job){state.innerHTML='';return;}
        var own=job.owner===diagnosticTabId;
        state.innerHTML='<p><strong>'+esc(diagnosticConclusion(job))+'</strong></p>'+(active?'<p>第 '+(job.results.length+1)+' 轮 · '+esc(job.round?purposes[job.round.purpose]:'准备')+' · '+esc(job.phase==='restoring'?'正在恢复原开关':job.round?stages[job.round.stage]:'复制起始衣柜')+'</p>':'<p>'+ (job.restoreDone?'原来的所选扩展开关已恢复。':'原开关尚未确认恢复。')+'</p>')+(job.suspect?'<p>关联可疑项：'+esc(job.suspect)+'</p>':'')+(active&&!own?'<p class="om-hint">排查由另一个窗口启动，此窗口暂不打开可写衣柜。可请求取消；原窗口关闭后可恢复开关。</p>':'')+(job.cleanupPending?'<p class="om-hint">临时数据尚未完全清理，可再次点清理；正式衣柜未被替换。</p>':'')+'<div class="om-compat-actions">'+(active?'<button type="button" class="om-btn om-btn-outline" data-do="cancel">'+(own?'取消并恢复':'请求原窗口取消')+'</button>':'')+((job.phase==='restoring'||active&&!own)?'<button type="button" class="om-btn om-btn-outline" data-do="restore">恢复原开关</button>':'')+(job.finalStatus==='paused'&&own?'<button type="button" class="om-btn om-btn-outline" data-do="continue">确认刚才就是原问题，继续复测</button><button type="button" class="om-btn om-btn-outline" data-do="discard">结束并清理测试副本</button>':'')+(!active&&job.finalStatus!=='paused'?'<button type="button" class="om-btn om-btn-outline" data-do="new">重新排查</button>':'')+(!active?'<button type="button" class="om-btn om-btn-outline" data-do="export">导出此次报告</button>':'')+(job.cleanupPending&&!active?'<button type="button" class="om-btn om-btn-outline" data-do="discard">清理临时数据</button>':'')+'</div>'+(active&&own&&job.mode==='manual'&&job.phase==='running'?'<p>关闭此窗口，在标有“测试副本”的衣柜复现相同操作后，重新打开这里标记结果。</p><div class="om-compat-actions"><button type="button" class="om-btn om-btn-safe" data-do="normal">相同操作正常</button><button type="button" class="om-btn om-btn-outline" data-do="failure">复现原问题</button></div>':'')+rows(job);
    }
    async function perform(action) { if(busy)return;busy=true;try{await action();}catch(error){toast(error.message||'排查未完成，请使用恢复入口',true);}finally{busy=false;paint(true);} }
    state.onclick=function(event){var button=event.target.closest('[data-do]');if(!button)return;var job=readDiagnosticJob();perform(function(){switch(button.dataset.do){case 'new':newRequest=true;return;case 'cancel':case 'discard':return cancelDiagnosticWizard();case 'restore':return retryDiagnosticRestore();case 'continue':return continueDiagnosticWizard(true);case 'export':return download(job);case 'normal':return manualDiagnosticResult(false);case 'failure':return manualDiagnosticResult(true);}});};
    sheet.querySelector('#om-investigation-close').onclick=function(){closeSheet(sheet);};
    sheet.querySelector('#om-investigation-mode').onchange=function(){var manual=this.value==='manual';sheet.querySelector('#om-investigation-file-wrap').hidden=manual;sheet.querySelector('#om-investigation-manual-help').hidden=!manual;};
    sheet.querySelector('#om-investigation-file').onchange=function(){file=this.files[0]||null;sheet.querySelector('#om-investigation-file-info').textContent=file?' '+(file.size/1048576).toFixed(1)+' MiB':'';};
    sheet.querySelector('#om-investigation-run').onclick=function(){
        if(!sheet.querySelector('#om-investigation-consent').checked){toast('开始前请先保留草稿，并勾选刷新说明');return;}
        var targets=Array.from(sheet.querySelectorAll('[data-extension]:checked')).map(function(el){return el.dataset.extension;});
        perform(function(){return startDiagnosticWizard({targets:targets,inventory:inventory,file:file,mode:sheet.querySelector('#om-investigation-mode').value});});
    };
    unsubscribe=subscribeDiagnosticPolicy(function(){paint(false);});paint(true);
    if(!isDiagnosticActive(readDiagnosticJob())&&diagnosticStorageReady())try{
        inventory=await getDiagnosticInventory();if(!sheet.isConnected)return sheet;
        var enabled=inventory.filter(function(item){return item.enabled===true&&!item.outfitManager;});
        sheet.querySelector('#om-investigation-targets').innerHTML=enabled.length?enabled.map(function(item){return '<label style="display:block;padding:6px 0"><input type="checkbox" data-extension="'+esc(item.id)+'"> '+esc(item.id)+' <small>'+esc(item.version||'版本未报告')+'</small></label>';}).join(''):'没有找到可排查的已启用扩展。';
        sheet.querySelector('#om-investigation-targets').onchange=function(event){if(sheet.querySelectorAll('[data-extension]:checked').length>8){event.target.checked=false;toast('每次最多优先排查 8 个扩展');}};
        sheet.querySelector('#om-investigation-run').disabled=!enabled.length;
    }catch(error){sheet.querySelector('#om-investigation-targets').textContent='未能确认宿主扩展列表，已停止自动切换。可使用独立恢复页面。';}
    return sheet;
}
