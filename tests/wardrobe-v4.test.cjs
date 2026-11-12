'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const plain=v=>JSON.parse(JSON.stringify(v));
async function environment(storage=new Map(),disk=new Map()){
 const handlers=new Map(),contextData={chatId:'one',characterId:0,groupId:null,characters:[{avatar:'character.png',name:'Same card'}],name2:'Same card',chatMetadata:{},chat:[],getCurrentChatId:()=>contextData.chatId,
  saveMetadata:()=>Promise.resolve(),eventTypes:{CHAT_CHANGED:'changed',MESSAGE_RECEIVED:'received'},eventSource:{on:(name,fn)=>handlers.set(name,fn)}};
 const sandbox={console,Date,JSON,Math,Map,WeakMap,Set,Promise,setTimeout,clearTimeout,SillyTavern:{getContext:()=>contextData},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
 const context=vm.createContext(sandbox),mods=new Map();
 function get(file){file=path.resolve(file);if(mods.has(file))return mods.get(file);
  let m;if(file.endsWith(path.join('db','idb.js'))){m=new vm.SyntheticModule(['idbGet','idbPut','idbGetOrCreate'],function(){this.setExport('idbGet',(key,cb)=>cb(disk.get(key)||null));this.setExport('idbPut',(key,value,cb)=>{disk.set(key,plain(value));if(cb)cb(true);});this.setExport('idbGetOrCreate',(key,value,cb)=>{const created=!disk.has(key);if(created)disk.set(key,plain(value));cb(disk.get(key),null,created);});},{context,identifier:file});}
  else m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});mods.set(file,m);return m;}
 async function load(file){const m=get(path.join(root,file));if(m.status==='unlinked')await m.link((spec,ref)=>get(path.resolve(path.dirname(ref.identifier),spec)));if(m.status!=='evaluated')await m.evaluate();return m.namespace;}
 return {load,contextData,handlers,storage,disk};
}
(async()=>{
 const env=await environment(),state=await env.load('src/db/state.js'),data=await env.load('src/data.js'),chat=await env.load('src/chat-state.js');
 state.DB.metaCache=data.defMeta();state.DB.metaCache.activePartitions={'user:__default__':['a']};
 const part=data.defPartition();part.outfits=[{id:'a',name:'One',description:'Suit'},{id:'b',name:'Two',description:'Sleepwear'}];state.DB.partCache['user:__default__']=part;
 chat.installChatState();assert.deepEqual(plain(chat.getChatState().active),{},'new chats never inherit global selections');
 chat.setCurrentOutfit('user:__default__','a',{locked:true});await chat.saveChatState();
 const metadataA=plain(env.contextData.chatMetadata),identityA=chat.getChatIdentity();
 env.contextData.chatId='two';env.contextData.chatMetadata={};await env.handlers.get('changed')();chat.setCurrentOutfit('user:__default__','b');await chat.saveChatState();
 const metadataB=plain(env.contextData.chatMetadata),identityB=chat.getChatIdentity();assert.notEqual(identityA,identityB);
 env.contextData.chatMetadata=metadataA;await env.handlers.get('changed')();
 assert.equal(chat.getChatState().current['user:__default__'].outfitId,'b','foreign chat metadata cannot overwrite an existing chat session');
 env.contextData.chatId='one';env.contextData.chatMetadata=metadataB;await env.handlers.get('changed')();
 assert.equal(chat.getChatState().current['user:__default__'].outfitId,'a');assert.equal(chat.getChatState().current['user:__default__'].locked,true);
 const fresh=await environment(env.storage,env.disk),freshState=await fresh.load('src/db/state.js');freshState.DB.metaCache=data.defMeta();freshState.DB.partCache['user:__default__']=part;
 fresh.contextData.chatId='two';fresh.contextData.chatMetadata=metadataA;const recovered=await fresh.load('src/chat-state.js');
 assert.equal(recovered.getChatState().current['user:__default__'].outfitId,'b','per-chat journal restores correct state after reload and polluted host metadata');
 const tags=await env.load('src/scene-tags.js');
 for(const name of ['Lolita','女仆制服','旗袍']){const value=tags.inferSceneTags({name});assert.ok(!value.includes('正式')&&!value.includes('校园'),name+' must not imply formal or school use');}
 assert.deepEqual(plain(tags.inferSceneTags({name:'不是睡衣'})),[]);
 assert.deepEqual(plain(tags.inferSceneTags({name:'家居服'})),['家居']);
 assert.deepEqual(plain(tags.inferSceneTags({name:'睡衣'})),['睡前','家居']);
 assert.equal(tags.validateAITags({tags:[{tag:'通勤',confidence:.5,evidence:'不确定'}]}).confident,false);
 assert.deepEqual(plain(tags.mergeTagSuggestion({sceneTag:'手工、睡前',_omTagSource:{tags:['睡前'],appliedValue:'手工、睡前'}},['家居'])),['手工','家居']);
 assert.deepEqual(plain(tags.mergeTagSuggestion({sceneTag:'手工、睡前、外出',_omTagSource:{tags:['睡前'],appliedValue:'手工、睡前'}},['家居'])),['手工','睡前','外出','家居'],'later manual edits are protected');
 const imports=await env.load('src/import-plan.js'),meta=data.defMeta();meta.charIndex=[{id:'__shared__',name:'__shared__',partKey:'char:__shared__'}];
 const original={outfits:[{id:'old',name:'西装',description:'black',imageData:'image1'}],accessories:[],activeIds:[],categories:[],accCategories:[]};
 const before=JSON.stringify(original),parts={'user:__default__':original};
 let plan=imports.buildImportPlan(meta,parts,{outfits:[{id:'new',name:'西装',description:'white',imageData:'image2'}]},'merge');
 assert.equal(plan.counts.added,1);assert.equal(plan.counts.related,1);assert.equal(plan.partitions['user:__default__'].outfits.length,2);assert.equal(JSON.stringify(original),before);
 plan=imports.buildImportPlan(meta,parts,{outfits:[{id:'different',name:'西装',description:'black',imageData:'image1'}]},'merge');assert.equal(plan.counts.skipped,1);
 plan=imports.buildImportPlan(meta,parts,{outfits:[{id:'old',name:'西装',description:'white',imageData:'image1'}]},'merge');assert.equal(plan.counts.added,1,'same photo and ID with different content remains separate in merge mode');
 plan=imports.buildImportPlan(meta,parts,{outfits:[{id:'old',name:'西装',description:'white',imageData:'image1'}]},'update');assert.equal(plan.counts.updated,1);
 plan=imports.buildImportPlan(meta,parts,{outfits:[{id:'o',name:'套装',kits:[{id:'kit',accIds:['hat'],disabledAccIds:[]}],activeKitId:'kit'}],accessories:[{id:'hat',name:'帽子'}]},'merge');
 const imported=plan.partitions['user:__default__'];assert.equal(imported.outfits[1].kits[0].accIds[0],imported.accessories[0].id);assert.equal(imported.outfits[1].activeKitId,imported.outfits[1].kits[0].id);
 assert.throws(()=>imports.buildImportPlan(meta,parts,{outfits:[{name:'broken',kits:[{accIds:['missing']}]}]},'merge'),/缺失/);
 const a={name:'same',kits:[{id:'1',accIds:[]},{id:'2',accIds:[]}],activeKitId:'1'},b={...a,activeKitId:'2'};assert.notEqual(imports.recordIdentity(a),imports.recordIdentity(b),'different active kit is a different configuration');
 const presetMeta=plain(meta);presetMeta.presets=[{id:'p_target',name:'Target',partKey:'user:p_target'}];
 plan=imports.buildImportPlan(presetMeta,parts,{type:'user',outfits:[{name:'Imported into chosen preset'}]},'merge',{targetUserKey:'user:p_target'});
 assert.ok(plan.partitions['user:p_target']);assert.equal(plan.partitions['user:__default__'],undefined,'a chat-specific preset is the import target even when library default is different');
 console.log('wardrobe v4: pass (same-character chat journal / contaminated host metadata / restart isolation / fixed mode / tag precision & manual provenance / true import duplicates / ID and kit remapping)');
})().catch(error=>{console.error(error);process.exitCode=1;});
