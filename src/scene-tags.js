// Outfit Manager · 二改版 | 标签来源、合并与手工内容保护
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { inferTextTags, ERA_TAGS, STYLE_TAGS, USE_TAGS } from './scene-recommendations.js';
export var SCENE_RULE_VERSION = '2.4.5';
export var TAG_GROUPS = {时代:ERA_TAGS,风格:STYLE_TAGS,用途:USE_TAGS};
export var AUTOMATIC_SCENES = ERA_TAGS.concat(STYLE_TAGS,USE_TAGS);
export var SCENE_PALETTE = AUTOMATIC_SCENES.concat(['日常']);
export function splitTags(value) { return Array.from(new Set(String(value || '').split(/[,，、/|\n]/).map(function (tag) { return tag.trim(); }).filter(Boolean))); }
export function inferSceneTagsDetailed(outfit) {
    var evidence=inferTextTags(outfit),tags=evidence.map(function(item){return item.tag;});
    return {tags:tags,evidence:evidence,confident:!!tags.length,confidence:tags.length?Math.min.apply(Math,evidence.map(function(item){return item.confidence;})):0,
        reason:evidence.map(function(item){return item.group+'“'+item.evidence+'” → '+item.tag;}).join('；')||'没有可辨认的服装类型、时代或用途信息，可补充名称与描述后再整理'};
}
export function inferSceneTags(outfit) { return inferSceneTagsDetailed(outfit).tags; }
export function validateAITags(value) {
    var source=value&&Array.isArray(value.tags)?value.tags:[],evidence=[],seen=new Set();
    source.forEach(function(item){
        var tag=typeof item==='string'?item:item&&item.tag;
        if(!AUTOMATIC_SCENES.includes(tag)||seen.has(tag))return;seen.add(tag);
        var group=Object.keys(TAG_GROUPS).find(function(key){return TAG_GROUPS[key].includes(tag);});
        evidence.push({tag:tag,group:group,confidence:typeof item==='string'?0.4:Math.max(0,Math.min(1,Number(item.confidence)||0)),evidence:typeof item==='object'&&typeof item.evidence==='string'?item.evidence.slice(0,160):'模型未提供依据'});
    });
    var conflicting=evidence.filter(function(item){return item.group==='时代';}).length>1;
    evidence.sort(function(a,b){return ['时代','风格','用途'].indexOf(a.group)-['时代','风格','用途'].indexOf(b.group)||b.confidence-a.confidence;});
    var used={时代:0,风格:0,用途:0};evidence=evidence.filter(function(item){return ++used[item.group]<=(item.group==='时代'?1:2);}).slice(0,5);
    return {tags:evidence.map(function(item){return item.tag;}),evidence:evidence,confident:!conflicting&&!!evidence.length&&evidence.every(function(item){return item.confidence>=0.82&&!!item.evidence.trim()&&item.evidence!=='模型未提供依据';}),
        reason:(conflicting?'时代判断冲突，请确认。':'')+evidence.map(function(item){return item.tag+'：'+item.evidence;}).join('；')||'模型未给出可确认的服装标签'};
}
export function manualSceneTags(outfit) {
    var existing=splitTags(outfit.sceneTag),source=outfit._omTagSource;
    var automatic=source&&source.appliedValue===outfit.sceneTag&&Array.isArray(source.tags)?source.tags:[];
    return existing.filter(function(tag){return !automatic.includes(tag);});
}
export function mergeTagSuggestion(outfit,suggested,manualReplace) {return Array.from(new Set((manualReplace?[]:manualSceneTags(outfit)).concat(suggested)));}
export function buildSceneTagUpdate(outfit,result,kind,replaceManual) {
    var tags=mergeTagSuggestion(outfit,result.tags,replaceManual),next=tags.join('、'),manual=replaceManual?[]:manualSceneTags(outfit);
    return {changed:next!==(outfit.sceneTag||''),sceneTag:next,source:result.edited?null:{kind:'automatic',method:kind||'local',ruleVersion:SCENE_RULE_VERSION,tags:result.tags.filter(function(tag){return !manual.includes(tag);}),appliedValue:next,at:Date.now(),reason:result.reason}};
}
