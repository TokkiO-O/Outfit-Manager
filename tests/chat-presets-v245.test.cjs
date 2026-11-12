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
 state.DB.metaCache=data.defMeta();state.DB.metaCache.presets=[{id:'modern',name:'现代',partKey:'user:modern'},{id:'ancient',name:'古风',partKey:'user:ancient'}];
 for(const key of ['user:modern','user:ancient']){const p=data.defPartition();p.outfits=[{id:key+'-a',name:'衣服',kits:[{id:'one',accIds:[]},{id:'two',accIds:[]}],activeKitId:'one'}];state.DB.partCache[key]=p;}
 chat.installChatState();chat.setChatPreset('modern');chat.setCurrentOutfit('user:modern','user:modern-a',{kitId:'two'});await chat.saveChatState();
 const metaA=plain(env.contextData.chatMetadata);env.contextData.chatId='two';env.contextData.chatMetadata={};await env.handlers.get('changed')();chat.setChatPreset('ancient');chat.setCurrentOutfit('user:ancient','user:ancient-a');await chat.saveChatState();
 assert.equal(chat.getBoundPresetId(),'ancient');env.contextData.chatId='one';env.contextData.chatMetadata=metaA;await env.handlers.get('changed')();assert.equal(chat.getBoundPresetId(),'modern');assert.equal(chat.getWornKit('user:modern',state.DB.partCache['user:modern'].outfits[0]).id,'two');assert.equal(state.DB.partCache['user:modern'].outfits[0].activeKitId,'one');
 chat.setChatPreset('ancient');chat.setCurrentOutfit('user:ancient','user:ancient-a');chat.setChatPreset('modern');assert.deepEqual(plain(chat.getChatState().active['user:modern']),['user:modern-a']);assert.deepEqual(plain(chat.getChatState().active['user:ancient']),['user:ancient-a']);
 chat.getChatState().view={kind:'char',characterId:'__shared__'};await chat.saveChatState();env.contextData.chatId='two';env.contextData.chatMetadata={};await chat.reconcileChatContext();assert.equal(chat.getBoundPresetId(),'ancient');assert.equal(chat.getChatState().view.kind,'user');
 env.contextData.chatId='one';env.contextData.chatMetadata={};await chat.reconcileChatContext();assert.equal(chat.getChatState().view.kind,'char');assert.ok(chat.getChatState().wearLog.length>=2);assert.ok(chat.getChatState().wearLog.every(r=>r.partKey.startsWith('user:')));
 const m=chat.getChatState();const oldIdentity=chat.getChatIdentity();env.contextData.characters[0].avatar='another-card.png';env.contextData.chatMetadata=plain(env.contextData.chatMetadata);assert.notEqual(chat.getChatIdentity(),oldIdentity);assert.equal(chat.getChatState().presetId,null);assert.deepEqual(plain(chat.getChatState().active),{});
 const legacy=await environment(),ls=await legacy.load('src/db/state.js'),ld=await legacy.load('src/data.js'),lc=await legacy.load('src/chat-state.js');ls.DB.metaCache=ld.defMeta();ls.DB.metaCache.presets=[{id:'ancient',name:'古风',partKey:'user:ancient'},{id:'wrong',name:'上个聊天',partKey:'user:wrong'}];legacy.contextData.chatMetadata[lc.CHAT_STATE_KEY]={version:2,presetId:'wrong',active:{'user:ancient':['dress']},current:{'user:ancient':{outfitId:'dress'}}};assert.equal(lc.getChatState().presetId,'ancient','old selected clothes identify the original preset');
 ls.DB.metaCache.presets=[{id:'__default__',name:'我的衣柜',partKey:'user:__default__'}];lc.setChatPreset(null);assert.equal(lc.getBoundPresetId(),'__default__','old unbound chats retain the ordinary preset at their existing storage key');
 const deleted=lc.getChatState();ls.DB.metaCache.presets=[];assert.equal(lc.getBoundPresetId(),null,'deleted presets fall back safely');
 const startup=await environment(),ss=await startup.load('src/db/state.js'),sd=await startup.load('src/data.js'),sc=await startup.load('src/chat-state.js');ss.DB.metaCache=sd.defMeta();startup.contextData.chatId=null;sc.installChatState();assert.ok(startup.handlers.has('changed'),'subscribe even before a chat is open');startup.contextData.chatId='new';await startup.handlers.get('changed')();assert.ok(sc.getChatState());
 console.log('chat presets 2.4.5: pass (same-card isolation, reload journals, per-chat view and kit, dormant selections, old-state migration, deleted preset fallback, startup without chat)');
})().catch(error=>{console.error(error);process.exitCode=1;});
