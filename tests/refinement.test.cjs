'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

async function capabilityChecks() {
    let routes = {}, calls = [];
    const context = vm.createContext({ AbortController, setTimeout, clearTimeout, Date,
        fetch: async (url, init) => {
            calls.push({url,init});
            const response = routes[new URL(url,'http://local.invalid').pathname.split('outfit-manager')[1]];
            return { ok: !!response, status: response ? 200 : 404, json: async () => response };
        }
    });
    const state = new vm.SourceTextModule(fs.readFileSync(path.join(root,'src/db/state.js'),'utf8'),{context});
    await state.link(()=>{throw new Error('unexpected state import');});await state.evaluate();
    const mod = new vm.SourceTextModule(fs.readFileSync(path.join(root,'src/db/capabilities.js'),'utf8'),{context});
    await mod.link(()=>state);await mod.evaluate();
    const {inspectBackend}=mod.namespace;
    let value=await inspectBackend({ok:true,pluginVersion:'2.2.1'});
    assert.equal(value.incremental,false,'version alone cannot enable conditional writes');
    assert.ok(calls.every(call=>call.init.method==='GET'&&call.init.cache==='no-store'));
    routes={'/capabilities':{ok:true,incrementalTransactions:true,partitionRevisions:true,pluginVersion:'2.2.1'}};
    value=await inspectBackend({ok:true,pluginVersion:'2.2.0'});
    assert.equal(value.incremental,true);assert.equal(value.pluginVersion,'2.2.1');assert.equal(value.source,'capabilities');
    routes={'/partitions/manifest':{ok:true,validated:true,keys:['user:__default__'],revisions:{'user:__default__':'a'.repeat(64)}}};
    value=await inspectBackend({ok:true,pluginVersion:'2.2.0'});
    assert.equal(value.incremental,true);assert.equal(value.source,'manifest');
    routes['/partitions/manifest'].revisions['user:__default__']='invalid';
    assert.equal((await inspectBackend({ok:true,pluginVersion:'2.2.0'})).incremental,false);
    calls=[];assert.equal((await inspectBackend({ok:true,pluginVersion:'2.1.2'})).source,'older-process');assert.equal(calls.length,0);
}
async function batchChecks() {
    const context=vm.createContext({AbortController,Promise,Map,Set,Math,Object,Array,JSON,Error,Number,String});
    const parts={a:{outfits:[{id:'one',name:'One',description:'',imageData:'image-a'},{id:'two',name:'Two',description:'',imageData:'image-b'}],categories:[]},
        b:{outfits:[{id:'one',name:'Other',description:'KEEP_OTHER',imageData:'image-c'}]}};
    let current='a', writes=[], active=0, peak=0, pending=[];
    const db={currentPartKey:()=>current,ensurePartitionLoaded:(key,callback)=>callback(parts[key]),loadMeta:()=>({apiVision:{endpoint:'https://fake.invalid',key:'synthetic',model:'model',concurrency:2}}),
        savePartition:(key,part,callback)=>{writes.push(key);callback(true);return true;}};
    const dbmod=new vm.SyntheticModule(Object.keys(db),function(){for(const [key,value]of Object.entries(db))this.setExport(key,value);},{context});
    const mod=new vm.SourceTextModule(fs.readFileSync(path.join(root,'src/vision-batch.js'),'utf8'),{context});
    await mod.link(()=>dbmod);await mod.evaluate();
    const batch=mod.namespace;
    batch.registerVisionWorker(async(job,item,signal)=>{
        active++;peak=Math.max(peak,active);
        const target=parts[job.partKey].outfits.find(value=>value.id===item.id);
        const before={description:target.description}, fingerprint=batch.imageFingerprint(target.imageData);
        await new Promise(resolve=>pending.push(resolve));active--;
        if(signal.aborted)throw new Error('cancelled');
        return {before,changes:{description:'GENERATED_'+item.id},imageFingerprint:fingerprint};
    });
    const finished=new Promise(resolve=>batch.runVisionBatch('description',['one','two'],{},null,(error,count,errors,stats)=>resolve({error,count,errors,stats})));
    for(let i=0;i<12;i++)await Promise.resolve();
    assert.equal(pending.length,2);assert.equal(peak,2);
    current='b';parts.a.outfits[1].description='MANUAL';
    pending.splice(0).forEach(resolve=>resolve());
    const result=await finished;
    assert.equal(parts.a.outfits[0].description,'GENERATED_one');
    assert.equal(parts.a.outfits[1].description,'MANUAL');
    assert.equal(parts.b.outfits[0].description,'KEEP_OTHER');
    assert.deepEqual(writes,['a']);assert.equal(result.stats.descSuccess,1);assert.equal(result.errors.length,1);
    pending=[];
    const cancelled=new Promise(resolve=>{
        const handle=batch.runVisionBatch('description',['one'],{overwriteDescription:true},null,(error,count,errors)=>resolve(errors));
        handle.cancel();
    });
    const errors=await cancelled;assert.equal(errors.length,1);assert.deepEqual(writes,['a']);
}
(async()=>{await capabilityChecks();await batchChecks();console.log('refinement: pass (fresh capability fallback / no version-only enabling / concurrent source-isolated auto-write / manual edits / cancellation)');})()
    .catch(error=>{console.error(error);process.exitCode=1;});
