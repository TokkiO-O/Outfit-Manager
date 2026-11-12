const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 const mod=new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'../src/scene-tags.js'),'utf8'));
 await mod.link(spec=>{assert.equal(spec,'./scene-recommendations.js');return new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'../src',spec),'utf8'));});await mod.evaluate();const tags=mod.namespace;
 const cases=[
  [{name:'浅蓝交领广袖襦裙'},['古代','汉服'],['现代','拍照','节庆']],
  [{name:'竹墨立领襦裙',description:'交领中衣配齐腰长裙，腰间束宽腰封'},['古代','汉服'],['拍照','节庆','通勤']],
  [{name:'古代囚服套装'},['古代','古风'],['现代','拍照','节庆']],
  [{name:'维多利亚欧式宫廷礼服'},['古代','欧式古典','正式'],['拍照','节庆']],
  [{name:'宋制褙子马面裙'},['古代','汉服'],['拍照','节庆']],
  [{name:'民国学生装',description:'立领蓝布长衫'},['近代','民国'],['古代','拍照']],
  [{name:'新中式套装',description:'T恤配马面裙'},['现代','新中式'],['古代','拍照','节庆']],
  [{name:'改良和服短裙'},['现代','和风'],['拍照','节庆','新中式']],
  [{name:'Lolita 洋装',description:'参考洛可可装饰，蕾丝与蝴蝶结'},['现代','洛丽塔'],['古代','通勤','拍照','节庆']],
  [{name:'女仆制服'},['现代','女仆'],['校园','拍照','节庆']],
  [{name:'旗袍'},['现代','旗袍'],['古代','正式','拍照','节庆']],
  [{name:'黑色露肩裙'},['现代','裙装'],['约会','拍照','私密']],
  [{name:'卫衣与牛仔裤'},['现代','休闲'],['运动','拍照','节庆']],
  [{name:'JK校服套装'},['现代','JK','校园'],['通勤','拍照']],
  [{name:'JK 情趣cos服'},['现代','JK','私密'],['校园','拍照']],
  [{name:'哥特印花T恤'},['现代'],['拍照','节庆']],
  [{name:'汉服印花T恤'},['现代','上装'],['古代','汉服','拍照']],
  [{name:'T恤',description:'印着汉服人物图案'},['现代','上装'],['古代','汉服']],
  [{name:'校园风连衣裙'},['现代','裙装'],['校园','拍照']],
  [{name:'睡衣风衬衫'},['现代','上装'],['睡前','家居']],
  [{name:'礼服风衬衫'},['现代','上装'],['正式']],
  [{name:'泳衣风衬衫'},['现代','上装'],['海边']],
  [{name:'家居服'},['家居'],['睡前','拍照']],
  [{name:'睡衣'},['睡前','家居'],['约会','拍照']],
  [{name:'比基尼泳衣'},['现代','海边'],['通勤','拍照']],
  [{name:'瑜伽服'},['现代','运动'],['拍照']],
  [{name:'雨衣'},['雨天'],['拍照']],
  [{name:'衬衫配西裤'},['现代','通勤'],['校园','拍照']],
  [{name:'服装',description:'适合约会，不适合通勤'},['约会'],['通勤']],
  [{name:'汉服',description:'适合春节庆典穿着'},['古代','汉服','节庆'],['拍照']],
  [{name:'汉服写真服'},['古代','汉服','拍照'],['节庆']],
  [{name:'汉服',description:'背景是春节布景，摄影棚墙上有写真海报'},['古代','汉服'],['拍照','节庆']],
  [{name:'现代情趣内衣'},['现代','私密'],['睡前','拍照']],
  [{name:'古代情趣肚兜'},['古代','私密'],['现代','拍照']],
  [{name:'现代亮片鱼尾礼裙'},['现代','正式'],['拍照','节庆']]
 ];
 for(const [item,wanted,forbidden]of cases){const result=tags.inferSceneTagsDetailed(item);for(const tag of wanted)assert.ok(result.tags.includes(tag),JSON.stringify({item,wanted,actual:result.tags}));for(const tag of forbidden)assert.ok(!result.tags.includes(tag),JSON.stringify({item,forbidden,actual:result.tags}));assert.ok(result.evidence.every(e=>!!e.evidence&&!!e.group));assert.ok(result.tags.length<=5);assert.ok(!result.tags.includes('日常'));}
 for(const item of [{name:'娃娃泳装挂件'},{name:'不是睡衣'},{name:'穿搭1',description:''},{name:'服装',sceneTag:'古代、约会'}])assert.deepEqual(plain(tags.inferSceneTags(item)),[]);
 const item={sceneTag:'手工专属、拍照、节庆',_omTagSource:{tags:['拍照','节庆'],appliedValue:'手工专属、拍照、节庆'}};
 const repaired=tags.buildSceneTagUpdate(item,tags.inferSceneTagsDetailed({name:'交领广袖襦裙'}),'local');assert.match(repaired.sceneTag,/手工专属/);assert.match(repaired.sceneTag,/古代/);assert.doesNotMatch(repaired.sceneTag,/拍照|节庆/);
 assert.deepEqual(plain(tags.manualSceneTags({sceneTag:'手工、拍照',_omTagSource:{tags:['拍照'],appliedValue:'拍照'}})),['手工','拍照']);
 assert.equal(tags.validateAITags({tags:[{tag:'古代',confidence:.99,evidence:'交领襦裙'},{tag:'现代',confidence:.99,evidence:'冲突'}]}).confident,false);
 assert.equal(tags.validateAITags({tags:[{tag:'古代',confidence:.99,evidence:'  '}]}).confident,false);
 assert.deepEqual(plain(tags.validateAITags({tags:[{tag:'日常',confidence:1,evidence:'泛用词'}]}).tags),[]);
 console.log('tags 2.4.4: pass ('+cases.length+' era/style/use cases; no decorative photography/festival fallback; provenance repair; manual/AI conflict guards)');
})().catch(error=>{console.error(error);process.exitCode=1;});
