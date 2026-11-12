'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 const DB={metaCache:{presets:[],activePartitions:{},activePresetId:null},partCache:{'user:__default__':{outfits:[{id:'old',name:'原有衣服'}],accessories:[{id:'belt',name:'腰带'}],categories:['古装'],accCategories:['腰饰'],activeIds:['old']}}};
 let binding=null,fail=false,saves=0;const deleted=[];
 const context=vm.createContext({console,Promise,Date,JSON,Math,Set});
 const stubs={
  './db/state.js':{DB,genId8:()=>String(saves+1).padStart(8,'0')},
  './db/index.js':{loadMeta:()=>DB.metaCache,loadCurrent:()=>DB.partCache[binding?'user:'+binding:'user:__default__'],ensurePartitionLoaded:(key,cb)=>cb(DB.partCache[key]),deletePartition:key=>{deleted.push(key);delete DB.partCache[key];},saveMeta:meta=>DB.metaCache=meta},
  './chat-state.js':{getChatIdentity:()=> 'test-chat',getChatState:()=>({presetId:binding}),setChatPreset:id=>binding=id,applyChatContext:()=>{},notifyChat:()=>{},getBoundPresetId:()=>binding||DB.metaCache.presets.some(p=>p.id==='__default__')&&'__default__'||null},
  './library-mutations.js':{commitWardrobeChanges:async(parts,meta)=>{if(fail)throw Error('forced failure');saves++;Object.assign(DB.partCache,plain(parts));if(meta)DB.metaCache=plain(meta);}},
  './bridge.js':{fn:{}}
 };
 const modules=new Map();
 function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});modules.set(file,m);return m;}
 const service=load(path.join(__dirname,'../src/preset-service.js'));
 await service.link((spec,ref)=>{if(ref.identifier===service.identifier&&stubs[spec]){const values=stubs[spec];return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});}return load(path.resolve(path.dirname(ref.identifier),spec));});await service.evaluate();const api=service.namespace;
 const before=plain(DB.partCache['user:__default__']);fail=true;await assert.rejects(api.retainOriginalWardrobe(),/forced failure/);assert.equal(DB.metaCache.presets.length,0);assert.deepEqual(plain(DB.partCache['user:__default__']),before);
 fail=false;assert.equal(await api.retainOriginalWardrobe(),true);assert.deepEqual(plain(DB.metaCache.presets),[{id:'__default__',name:'原有衣柜',partKey:'user:__default__'}]);assert.deepEqual(plain(DB.partCache['user:__default__']),before,'existing data and IDs stay at their original storage key');assert.equal(await api.retainOriginalWardrobe(),false,'opening twice does not create duplicate presets');
 await api.renamePreset('__default__','我自己的衣柜');assert.equal(api.currentPresetLabel(),'我自己的衣柜');await api.choosePreset('__default__');assert.equal(binding,'__default__');
 await api.removePreset('__default__');assert.equal(DB.metaCache.presets.length,0);assert.equal(binding,null);assert.equal(deleted.includes('user:__default__'),false,'compatibility record remains valid for the backend');assert.deepEqual(plain(DB.partCache['user:__default__'].outfits),[]);assert.deepEqual(plain(DB.partCache['user:__default__'].accessories),[]);assert.equal(await api.retainOriginalWardrobe(),false,'empty storage never creates a preset');
 assert.equal(api.currentPresetLabel(),'未选择预设');assert.equal(saves,3);console.log('preset compatibility: pass (ordinary editable preset, empty install, rename/delete, atomic failure, no data moves or duplicate copies)');
})().catch(error=>{console.error(error);process.exitCode=1;});
