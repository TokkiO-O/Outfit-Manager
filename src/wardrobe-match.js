// Outfit Manager · 二改版 | 文字线索、标签与服装时代匹配
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { inferTextTags, ERA_TAGS } from './scene-recommendations.js';
var cache=new WeakMap();
export function splitTags(value){return Array.from(new Set(String(value||'').split(/[,，、/|\n]/).map(function(tag){return tag.trim();}).filter(Boolean)));}
export function wardrobeTags(outfit){
    var stamp=[outfit.name,outfit.category,outfit.subCategory,outfit.description,outfit.sceneTag].join('\u0001'),old=cache.get(outfit);
    if(old&&old.stamp===stamp)return old.value;
    var explicit=splitTags(outfit.sceneTag),explicitEra=explicit.filter(function(tag){return ERA_TAGS.includes(tag);});
    var inferred=inferTextTags(outfit).map(function(item){return item.tag;}).filter(function(tag){return !ERA_TAGS.includes(tag)||!explicitEra.length||explicitEra.includes(tag);});
    var value={explicit:explicit,inferred:inferred,tags:Array.from(new Set(explicit.concat(inferred)))};cache.set(outfit,{stamp:stamp,value:value});return value;
}
var aliases={
    '古代':/古代|古装|古风|汉服|宫廷|仙侠|修仙|王府|皇宫/,'近代':/近代|民国|中山装/,'现代':/现代|都市|当代/,
    '汉服':/汉服|襦裙|马面裙|交领|古风|古装/,'古风':/古风|古装|古代|汉服|仙侠|修仙/,'欧式古典':/欧式古典|西式宫廷|欧式宫廷|维多利亚|中世纪|洛可可/,'新中式':/新中式|中式日常|汉元素/,
    '和风':/和风|和服|浴衣/,'JK':/\bjk\b|校服|水手服/i,'洛丽塔':/洛丽塔|洛莉塔|lolita/i,'哥特':/哥特|哥德|gothic/i,'奇幻':/奇幻|魔法|魔女|精灵|修仙|仙侠/,
    '休闲':/休闲|日常|散步|在街上|出门|便服/,'休闲风':/休闲|日常|随性|便服|松弛/,'家居':/家居|居家|在家|回家|宅家/,'睡前':/睡前|睡觉|睡衣|就寝|上床休息/,
    '通勤':/通勤|上班|公司|办公|职场|商务|开会/,'通勤风':/通勤|职业|职场|商务|公司|办公|上班/,'校园':/校园|学校|上学|上课|校服/,'学院':/学院|校园|学校|上学|校服/,
    '海边':/海边|海滩|沙滩|游泳|泳池|泳装/,'运动':/运动|健身|瑜伽|跑步|打球|锻炼/,'运动风':/运动|健身|瑜伽|跑步|球服/,
    '正式':/正式|宴会|晚宴|婚礼|典礼|礼服|朝会/,'派对':/派对|夜店|舞会|聚会/,'约会':/约会|烛光晚餐|情侣晚餐/,'户外':/户外|登山|徒步|露营/,'雨天':/雨天|下雨|雨衣/,
    '旅行':/旅行|旅游|度假|旅途/,'逛街':/逛街|购物|商场/,'节庆':/节庆|春节|中秋|端午|新年|圣诞|万圣节/,'拍照':/拍照|写真|摄影|出片/,
    '甜美':/甜美|可爱|甜妹|甜系/,'优雅':/优雅|端庄|知性|轻熟/,'简约':/简约|极简|简单|素净/,'复古':/复古|怀旧/,'法式':/法式|茶歇/,'街头':/街头|嘻哈|街舞/,'机能':/机能|战术|赛博/,'甜酷':/甜酷|辣妹|千禧|y2k/i,'性感':/性感|情趣|私密/,'私密':/私密|情趣|内衣/
};
export function rankWardrobe(outfits,text){
    var source=String(text||'').normalize('NFKC').toLowerCase().split(/[。；！!?\n]/).filter(function(line){return !/不是|不要|别穿|不适合|不去|不穿|不想|不打算|不需要|无需|没有去|没去|回忆|想起|昨天|假如|如果/.test(line);}).join('。');
    var wants=Object.keys(aliases).filter(function(tag){return aliases[tag].test(source);});
    var wantedEra=wants.filter(function(tag){return ERA_TAGS.includes(tag);});
    var words=source.split(/[，,、/\s]+/).filter(function(word){return word.length>=2&&word.length<=12;});
    return (outfits||[]).map(function(outfit,index){var info=wardrobeTags(outfit),hits=info.tags.filter(function(tag){return wants.includes(tag)||source.includes(tag.toLowerCase());});
        var score=hits.reduce(function(n,tag){return n+(info.explicit.includes(tag)?7:5);},0);
        words.forEach(function(word){if(hits.some(function(tag){return word===tag;}))return;if((String(outfit.name||'')+' '+String(outfit.category||'')+' '+String(outfit.subCategory||'')).toLowerCase().includes(word))score+=3;else if(String(outfit.description||'').toLowerCase().includes(word))score+=1;});
        var eras=info.tags.filter(function(tag){return ERA_TAGS.includes(tag);});if(wantedEra.length===1&&eras.length&&!eras.includes(wantedEra[0]))score-=40;
        return {outfit:outfit,score:score,tags:hits,index:index};
    }).sort(function(a,b){return b.score-a.score||a.index-b.index;});
}
