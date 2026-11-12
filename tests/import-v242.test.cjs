'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {File}=require('node:buffer'),root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 const context=vm.createContext({console,Blob,File,TextDecoder,TextEncoder,Uint8Array,Uint32Array,DataView,Map,Set,Promise,Date,JSON,Math,Error,Array,Object,Number,String,setTimeout,clearTimeout,atob,crypto:{}}),modules=new Map();
 function get(file){file=path.resolve(file);if(!modules.has(file))modules.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file}));return modules.get(file);}
 async function load(file){const mod=get(path.join(root,file));if(mod.status==='unlinked')await mod.link((spec,ref)=>get(path.resolve(path.dirname(ref.identifier),spec)));if(mod.status!=='evaluated')await mod.evaluate();return mod.namespace;}
 const reader=await load('src/import-file.js'),json=await load('src/json-data.js'),imports=await load('src/import-plan.js'),data=await load('src/data.js'),images=await load('src/db/local-images.js');
 const payload={outfits:[{id:'one',name:'中文😀\n"引号"与反斜杠\\',description:'x'.repeat(524249)+'😀尾部'},{id:'two',name:'第二件'}],presets:[],numbers:[0,-1,2.5e12,true,false,null]};
 let progress=0;const file=new File([JSON.stringify(payload)],'chunk-boundary.json');
 assert.deepEqual(plain(await reader.readImportFile(file,{onProgress:()=>progress++})),payload);assert.ok(progress>=2);
 const unsafe=await reader.readImportFile(new File(['{"__proto__":{"polluted":true},"outfits":[]}'],'prototype.json'));
 assert.equal(Object.prototype.hasOwnProperty.call(unsafe,'__proto__'),false);assert.equal({}.polluted,undefined);
 await assert.rejects(reader.readImportFile(new File(['{"outfits":[{}]'],'broken.json')),/结束|完整|分隔/);
 const controller=new AbortController();controller.abort();await assert.rejects(reader.readImportFile(file,{signal:controller.signal}),/取消/);
 const large='data:image/png;base64,'+'A'.repeat(150000),source={outfits:Array.from({length:4000},(_,i)=>({id:'big'+i,imageData:large,name:'name'+i}))};
 const copied=json.copyJson(source);assert.equal(copied.outfits[0].imageData,large);assert.equal(json.sameJson(copied,source),true);copied.outfits[0].name='changed';assert.notEqual(source.outfits[0].name,'changed');assert.equal(json.sameJson(copied,source),false);
 const binary=Buffer.from('SHA256 fallback exact bytes \0 fixture'),stored=await images.imageBlobAndRef('data:image/png;base64,'+binary.toString('base64'));
 assert.equal(stored.ref,'om-image:'+crypto.createHash('sha256').update(binary).digest('hex')+'.png');
 assert.deepEqual(Buffer.from(await stored.blob.arrayBuffer()),binary);
 const meta=data.defMeta(),base={outfits:[],accessories:[],categories:[],accCategories:[],activeIds:[]};
 const incoming={accessories:[{id:'acc1',name:'同款配饰',imageData:'same-image'},{id:'acc2',name:'同款配饰',imageData:'same-image'}],outfits:[{id:'one',name:'同款穿搭',imageData:'same-outfit',kits:[{id:'k1',accIds:['acc1']}],activeKitId:'k1'},{id:'two',name:'同款穿搭',imageData:'same-outfit',kits:[{id:'k2',accIds:['acc2']}],activeKitId:'k2'}]};
 const plan=imports.buildImportPlan(meta,{'user:__default__':base},incoming,'merge'),part=plan.partitions['user:__default__'];
 assert.equal(plan.counts.added,4);assert.equal(part.accessories.length,2);assert.equal(part.outfits.length,2);assert.notEqual(part.accessories[0].id,part.accessories[1].id);
 assert.equal(part.outfits[0].kits[0].accIds[0],part.accessories[0].id);assert.equal(part.outfits[1].kits[0].accIds[0],part.accessories[1].id);
 const repeated=imports.buildImportPlan(plan.meta,plan.partitions,incoming,'merge');assert.equal(repeated.counts.added,0);assert.equal(repeated.counts.skipped,4);
 console.log('import 2.4.2: pass (chunked UTF-8/escapes/invalid JSON/cancel; 600MB logical snapshot without serialising; SHA-256 fallback; duplicate source identities and kit links; repeat import)');
})().catch(error=>{console.error(error);process.exitCode=1;});
