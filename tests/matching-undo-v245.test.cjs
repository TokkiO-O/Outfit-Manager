const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const modules=new Map(),context=vm.createContext({console,Map,WeakMap,Set,Date,Math,JSON});
function mod(file){file=path.resolve(file);if(!modules.has(file))modules.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file}));return modules.get(file);}
async function load(name){const m=mod(path.join(__dirname,'../src/',name));if(m.status==='unlinked')await m.link((spec,ref)=>mod(path.resolve(path.dirname(ref.identifier),spec)));if(m.status!=='evaluated')await m.evaluate();return m.namespace;}
(async()=>{
 const rules=await load('scene-recommendations.js'),matching=await load('wardrobe-match.js'),tags=o=>rules.inferTextTags(o).map(e=>e.tag);
 for(const [o,expected]of [
  [{name:'针织两件套',description:'圆领纯色针织开衫配高腰牛仔裤'},'休闲风'],
  [{name:'西装搭配',description:'翻领西装外套内搭衬衫，下配直筒西裤。'},'通勤风'],
  [{name:'浅粉短裙',description:'泡泡袖上装以白色蕾丝与蝴蝶结装饰，下搭浅粉百褶短裙。'},'甜美'],
  [{name:'学院格纹',description:'白色衬衫系领带，配格纹百褶裙。'},'学院'],
  [{name:'收腰长裙',description:'方领长袖连衣裙，缎面裙身收腰，裙长及踝。'},'优雅'],
  [{name:'汉服',category:'复古',description:'交领右衽长襦搭配齐腰襦裙'},'汉服'],
  [{name:'黑色礼服',description:'黑色礼服配金色花朵刺绣。'},'正式']
 ])assert.ok(tags(o).includes(expected),expected+': '+tags(o));
 assert.ok(!tags({name:'蓝色裙子',description:'裙子上有一只蝴蝶结。'}).includes('甜美'),'one decorative detail is insufficient');
 assert.ok(!tags({name:'白色T恤',description:'印有哥特人物图案，背景是古代宫廷。'}).includes('古代'));
 const office={id:'office',name:'职业西装',description:'翻领西装外套配白衬衫与深色直筒西裤。'},han={id:'han',name:'齐胸襦裙',description:'汉服对襟短襦配齐胸长裙。'},casual={id:'casual',name:'休闲搭配',description:'纯色圆领毛衣配牛仔裤。'};
 assert.equal(matching.rankWardrobe([casual,han,office],'到公司上班开会')[0].outfit.id,'office');
 assert.equal(matching.rankWardrobe([office,casual,han],'古代宫廷')[0].outfit.id,'han');
 assert.equal(matching.rankWardrobe([office,han,casual],'不要穿西装，如果去公司')[0].score,0,'negated or hypothetical scenes do not pick clothes');
 const mut={name:'灰色搭配',description:'卫衣配牛仔裤'};assert.ok(matching.wardrobeTags(mut).tags.includes('休闲风'));mut.description='交领右衽，广袖短襦配齐腰襦裙';assert.ok(matching.wardrobeTags(mut).tags.includes('古代'),'cache invalidates after text edits');
 const undo=await load('undo-actions.js'),part={outfits:[{id:'a',sceneTag:'新标签',category:'现代',kits:[{id:'k',accIds:['a']}]}],accessories:[],categories:[]};
 const recent={type:'batch_tag',payload:{items:[{id:'a',prevTag:'中间标签'}]}},older={type:'batch_tag',payload:{items:[{id:'a',prevTag:'原始标签'}]}};undo.undoEntry(part,recent);undo.undoEntry(part,older);assert.equal(part.outfits[0].sceneTag,'原始标签');
 const missing=undo.undoEntry(part,{id:'partial',type:'batch_tag',payload:{items:[{id:'a',prevTag:'恢复'},{id:'deleted',prevTag:'保留记录'}]}});assert.equal(missing.count,1);assert.equal(missing.remaining.payload.items[0].id,'deleted');
 const conflict=undo.undoEntry(part,{type:'delete_outfits',payload:{outfits:[{id:'a',name:'不应覆盖'},{id:'b',name:'恢复新项'}]}});assert.equal(part.outfits.length,2);assert.equal(conflict.remaining.payload.outfits[0].id,'a');assert.equal(part.outfits[0].name,undefined);
 const defaults=await load('default-prompts.js'),data=await load('data.js'),meta=data.defMeta();meta.apiVision.prompt=defaults.V244_OUTFIT_PROMPT;data.ensureMetaDefaults(meta);assert.equal(meta.apiVision.prompt,defaults.DEFAULT_OUTFIT_PROMPT);meta.apiVision.prompt='保留我的自定义格式';data.ensureMetaDefaults(meta);assert.equal(meta.apiVision.prompt,'保留我的自定义格式');assert.match(defaults.DEFAULT_OUTFIT_PROMPT,/150～200/);assert.doesNotMatch(defaults.DEFAULT_OUTFIT_PROMPT,/220～320/);
 console.log('matching and undo 2.4.5: pass (evidence-based styles, untagged scene matching, era conflicts, negation, cache edits, newest-first and partial undo, exact prompt migration)');
})().catch(error=>{console.error(error);process.exitCode=1;});
