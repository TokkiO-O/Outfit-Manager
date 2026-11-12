const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const mods=new Map();function get(file){file=path.resolve(file);if(!mods.has(file))mods.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file}));return mods.get(file);}
 const mod=get(path.join(__dirname,'../src/data.js'));await mod.link((spec,ref)=>get(path.resolve(path.dirname(ref.identifier),spec)));await mod.evaluate();
 const data=mod.namespace,prompts=get(path.join(__dirname,'../src/default-prompts.js')).namespace;
 const old=data.defMeta();old.apiVision.prompt=prompts.LEGACY_OUTFIT_PROMPT;old.apiVision.accPrompt=prompts.LEGACY_ACCESSORY_PROMPT;
 assert.equal(data.ensureMetaDefaults(old).apiVision.prompt,prompts.DEFAULT_OUTFIT_PROMPT);
 assert.equal(data.ensureMetaDefaults(old).apiVision.accPrompt,prompts.DEFAULT_ACCESSORY_PROMPT);
 const custom=data.defMeta();custom.apiVision.prompt='MY CUSTOM OUTFIT';custom.apiVision.accPrompt='MY CUSTOM ACCESSORY';
 data.ensureMetaDefaults(custom);assert.equal(custom.apiVision.prompt,'MY CUSTOM OUTFIT');assert.equal(custom.apiVision.accPrompt,'MY CUSTOM ACCESSORY');
 const mixed=data.defMeta();mixed.apiVision.prompt=prompts.LEGACY_OUTFIT_PROMPT;mixed.apiVision.accPrompt='CUSTOM';data.ensureMetaDefaults(mixed);
 assert.equal(mixed.apiVision.prompt,prompts.DEFAULT_OUTFIT_PROMPT);assert.equal(mixed.apiVision.accPrompt,'CUSTOM');
 const previous=data.defMeta();previous.apiVision.prompt=prompts.PREVIOUS_OUTFIT_PROMPT;previous.apiVision.accPrompt=prompts.PREVIOUS_ACCESSORY_PROMPT;data.ensureMetaDefaults(previous);
 assert.equal(previous.apiVision.prompt,prompts.DEFAULT_OUTFIT_PROMPT);assert.equal(previous.apiVision.accPrompt,prompts.DEFAULT_ACCESSORY_PROMPT);
 assert.match(prompts.DEFAULT_OUTFIT_PROMPT,/6 个汉字以内/);assert.match(prompts.DEFAULT_OUTFIT_PROMPT,/150～200/);assert.match(prompts.DEFAULT_OUTFIT_PROMPT,/一段连续/);assert.match(prompts.DEFAULT_OUTFIT_PROMPT,/不要分段、编号、列表、项目标题、括号分块/);
 assert.match(prompts.DEFAULT_ACCESSORY_PROMPT,/\{\{accCategory\}\}/);assert.match(prompts.DEFAULT_OUTFIT_PROMPT,/无法辨认/);
 console.log('prompts 2.4.3: pass (exact default migration; custom/mixed preservation; category placeholder)');
})().catch(error=>{console.error(error);process.exitCode=1;});
