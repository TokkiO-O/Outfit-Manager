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
  let m;if(file.endsWith(path.join('db','idb.js'))){m=new vm.SyntheticModule(['idbGet','idbPut','idbGetOrCreate','idbDelete','idbPutBatch','idbGetAllKeys'],function(){this.setExport('idbDelete',(key,cb)=>{disk.delete(key);if(cb)cb(true);});this.setExport('idbPutBatch',(rows,cb)=>{rows.forEach(row=>disk.set(row.key,plain(row.value)));if(cb)cb(true);});this.setExport('idbGetAllKeys',cb=>cb(Array.from(disk.keys())));this.setExport('idbGet',(key,cb)=>cb(disk.get(key)||null));this.setExport('idbPut',(key,value,cb)=>{disk.set(key,plain(value));if(cb)cb(true);});this.setExport('idbGetOrCreate',(key,value,cb)=>{const created=!disk.has(key);if(created)disk.set(key,plain(value));cb(disk.get(key),null,created);});},{context,identifier:file});}
  else m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});mods.set(file,m);return m;}
 async function load(file){const m=get(path.join(root,file));if(m.status==='unlinked')await m.link((spec,ref)=>get(path.resolve(path.dirname(ref.identifier),spec)));if(m.status!=='evaluated')await m.evaluate();return m.namespace;}
 return {load,contextData,handlers,storage,disk};
}

(async()=>{
 const env=await environment(),{DB}=await env.load('src/db/state.js'),data=await env.load('src/data.js'),chat=await env.load('src/chat-state.js'),view=await env.load('src/db/view.js'),legacy=await env.load('src/db/legacy.js');
 DB.metaCache=data.defMeta();DB.metaCache.presets=[{id:'modern',name:'现代',partKey:'user:modern'}];DB.metaCache.activePresetId='modern';
 DB.metaCache.charIndex.push({id:'c_00000001',name:'角色甲',partKey:'char:c_00000001'},{id:'c_00000002',name:'角色乙',partKey:'char:c_00000002'});
 for(const key of ['user:modern','user:__default__','char:__shared__','char:c_00000001','char:c_00000002']){const p=data.defPartition();p.outfits=[{id:'same-id',name:key+' 衣服'}];p.accessories=[{id:'same-acc',name:key+' 单品'}];DB.partCache[key]=p;DB.knownPartKeys[key]=true;env.disk.set(key,plain(p));}
 chat.installChatState();chat.setChatPreset('modern');chat.setCurrentOutfit('user:modern','same-id');const assets=JSON.stringify(Object.fromEntries(Object.entries(DB.partCache).map(([key,p])=>[key,{outfits:p.outfits,accessories:p.accessories}])));
 assert.equal(view.switchWardrobeView('char'),'char:__shared__');assert.equal(DB.metaCache.currentView,'char');assert.equal(chat.getChatState().view.kind,'char');assert.equal(view.loadCurrent().outfits[0].name,'char:__shared__ 衣服');
 DB.metaCache.currentView='user';DB.metaCache.currentChar='';assert.equal(view.currentPartKey(),'char:__shared__','chat view remains authoritative if global metadata is stale');chat.applyChatContext();
 view.switchWardrobeView('char','c_00000001');assert.equal(chat.getBoundPresetId(),'modern');assert.equal(view.currentPartKey(),'char:c_00000001');assert.equal(legacy.load().currentChar,'角色甲');chat.selectChatOutfit(view.currentPartKey(),'same-id');assert.equal(view.currentPartKey(),'char:c_00000001');assert.deepEqual(plain(chat.getChatState().active['char:c_00000001']),['same-id']);assert.deepEqual(plain(chat.getChatState().active['user:modern']),['same-id']);
 view.switchWardrobeView('user');assert.equal(view.currentPartKey(),'user:modern');assert.deepEqual(plain(view.loadCurrent().activeIds),['same-id']);view.switchWardrobeView('char');assert.equal(view.currentPartKey(),'char:c_00000001','returning to character view keeps the last visited character');
 view.switchWardrobeView('char','c_00000002');assert.equal(view.loadCurrent().outfits[0].name,'char:c_00000002 衣服');assert.equal(JSON.stringify(Object.fromEntries(Object.entries(DB.partCache).map(([key,p])=>[key,{outfits:p.outfits,accessories:p.accessories}]))),assets,'view changes never copy or overwrite wardrobe contents');
 env.contextData.chatId='two';env.contextData.chatMetadata={};await chat.reconcileChatContext();chat.setChatPreset('modern');view.switchWardrobeView('user');env.contextData.chatId='one';env.contextData.chatMetadata={};await chat.reconcileChatContext();assert.equal(view.currentPartKey(),'char:c_00000002');env.contextData.chatId='two';env.contextData.chatMetadata={};await chat.reconcileChatContext();assert.equal(view.currentPartKey(),'user:modern','same-card chats keep separate browse views');
 env.contextData.chatId='one';env.contextData.chatMetadata={};await chat.reconcileChatContext();DB.metaCache.charIndex=DB.metaCache.charIndex.filter(item=>item.id!=='c_00000002');assert.equal(view.currentPartKey(),'char:__shared__','a deleted character cannot silently display the User wardrobe');chat.applyChatContext();assert.equal(DB.metaCache.currentChar,'__shared__');assert.equal(legacy.load().currentChar,'__shared__');
 view.switchWardrobeView('char','c_00000001');const d=legacy.load();d.charFavorites.push('角色甲');legacy.save(d);assert.equal(view.currentPartKey(),'char:c_00000001','saving character settings keeps its view');assert.equal(DB.partCache['user:modern'].outfits[0].name,'user:modern 衣服');
 env.contextData.chatId=null;assert.equal(view.switchWardrobeView('user'),'user:modern');assert.equal(view.switchWardrobeView('char','c_00000001'),'char:c_00000001','browsing also works when no chat is open');assert.equal(view.loadCurrent().outfits[0].name,'char:c_00000001 衣服');
 console.log('wardrobe view: pass (User/character/shared navigation, preset preservation, isolated choices, no asset writes, per-chat restoration, deleted-character fallback, legacy save, no-chat browsing)');
})().catch(error=>{console.error(error);process.exitCode=1;});
