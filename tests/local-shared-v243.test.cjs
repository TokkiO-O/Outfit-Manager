const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const mods=new Map(),disk=new Map();let readsFailed=false,creates=0,race=null;
 function get(file){file=path.resolve(file);if(mods.has(file))return mods.get(file);let mod;
  if(file.endsWith(path.join('db','idb.js')))mod=new vm.SyntheticModule(['idbGet','idbGetOrCreate'],function(){
   this.setExport('idbGet',(key,cb)=>cb(disk.has(key)?disk.get(key):null,readsFailed?new Error('synthetic read failure'):null));
   this.setExport('idbGetOrCreate',(key,value,cb)=>{creates++;if(race){disk.set(key,race);race=null;}const created=!disk.has(key);if(created)disk.set(key,value);cb(disk.get(key),null,created);});
  },{identifier:file});
  else mod=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file});mods.set(file,mod);return mod;
 }
 const file=path.join(__dirname,'../src/db/local-partitions.js'),mod=get(file);await mod.link((spec,ref)=>get(path.resolve(path.dirname(ref.identifier),spec)));await mod.evaluate();
 const DB=get(path.join(__dirname,'../src/db/state.js')).namespace.DB;DB.metaCache={activePartitions:{}};
 const read=key=>new Promise(resolve=>mod.namespace.readLocalPartition(key,(value,error)=>resolve({value,error})));
 const shared='char:__shared__',existing={outfits:[{id:'keep',name:'saved'}],accessories:[]};
 disk.set('user:__default__',existing);
 let result=await read(shared);assert.equal(result.error,null);assert.equal(result.value.outfits.length,0);assert.equal(disk.has(shared),true);assert.equal(creates,1);assert.deepEqual(DB.localPartitionRepairs,[shared]);assert.equal(disk.get('user:__default__'),existing);
 result=await read(shared);assert.equal(result.error,null);assert.equal(creates,1,'durable repair is not repeated');
 disk.set(shared,existing);result=await read(shared);assert.equal(result.value,existing);assert.equal(creates,1,'saved shared contents are never replaced');
 disk.delete(shared);readsFailed=true;result=await read(shared);assert.match(result.error.message,/read failure/);assert.equal(disk.has(shared),false);assert.equal(creates,1);readsFailed=false;
 result=await read('user:missing');assert.match(result.error.message,/缺失/);assert.equal(disk.has('user:missing'),false);assert.equal(creates,1);
 DB.metaCache.activePartitions[shared]=['worn'];result=await read(shared);assert.match(result.error.message,/缺失/);assert.equal(creates,1);delete DB.metaCache.activePartitions[shared];
 DB.serverMode=true;result=await read(shared);assert.match(result.error.message,/缺失/);assert.equal(creates,1);DB.serverMode=false;
 disk.set(shared,{bad:'invalid'});result=await read(shared);assert.match(result.error.message,/格式异常/);assert.equal(disk.get(shared).bad,'invalid');assert.equal(creates,1);
 disk.set(shared,null);result=await read(shared);assert.match(result.error.message,/格式异常/);assert.equal(disk.get(shared),null);
 disk.delete(shared);race=existing;result=await read(shared);assert.equal(result.value,existing,'a concurrent real write wins the atomic create-if-absent repair');assert.equal(disk.get('user:__default__'),existing);
 console.log('local shared 2.4.3: pass (durable repair; existing data; read errors; missing presets; worn selections; backend ownership; corrupt/null records; concurrent real writes)');
})().catch(error=>{console.error(error);process.exitCode=1;});
