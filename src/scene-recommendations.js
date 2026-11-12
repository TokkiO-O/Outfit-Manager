// Outfit Manager · 二改版 | 时代、风格和用途的本地文字规则
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var ERA_TAGS = ['古代','近代','现代'];
export var STYLE_TAGS = ['汉服','古风','欧式古典','民国','新中式','旗袍','和风','JK','洛丽塔','哥特','地雷系','女仆','角色装','奇幻','机能','街头','甜美','简约','优雅','复古','法式','学院','运动风','休闲风','通勤风','工装','甜酷','性感','裙装','裤装','套装','上装','外套'];
export var USE_TAGS = ['休闲','家居','睡前','通勤','约会','正式','派对','校园','海边','旅行','运动','拍照','逛街','户外','雨天','节庆','私密'];
function sourceClauses(outfit) {
    var clauses = [];
    [['名称',outfit.name,true],['分类',outfit.category,true],['子分类',outfit.subCategory,true],['描述',outfit.description,false]].forEach(function (source) {
        String(source[1] || '').normalize('NFKC').split(/[，,。；;！!\n]|但是|而是|不过|\bbut\b/i).forEach(function (text) {
            text = text.trim();
            if (text) clauses.push({source:source[0],text:text,identity:source[2]});
        });
    });
    return clauses;
}
export function inferTextTags(outfit) {
    outfit = outfit || {};
    var all = sourceClauses(outfit), veto = new Set(), evidence = [];
    var positives = all.filter(function (clause) {
        if (/不适合|不适宜|不用于|不宜穿|不能穿|不可穿|\bnot (?:for|suitable)\b/i.test(clause.text)) {
            USE_TAGS.forEach(function (tag) { if (clause.text.includes(tag)) veto.add(tag); }); return false;
        }
        return !/不是|并非|并不|非校服|非睡衣|非正式|\bnot\b|\bwithout\b/i.test(clause.text) &&
            !/背景|海报|墙上|模特|人物|摄影棚|布景|拍摄地点/.test(clause.text);
    });
    function find(re, identityOnly) {
        var matcher = new RegExp(re.source, re.flags.replace(/g/g,'') + 'g');
        for (var i=0;i<positives.length;i++) {
            var clause=positives[i]; if(identityOnly&&!clause.identity)continue;
            matcher.lastIndex=0; var match;
            while ((match=matcher.exec(clause.text))) {
                var before=clause.text.slice(0,match.index),tail=clause.text.slice(match.index+match[0].length);
                if (/印着|印有|印制着|绘有|图案为|图案是/.test(before.slice(-14)) || /^(?:图案|印花|头像|人物像|字体|字样|海报|挂件|玩偶)/.test(tail)) continue;
                if (/^(?:风|感|式)/.test(tail)&&/睡衣|泳衣|泳装|校服|礼服|运动服|^JK$/i.test(match[0]))continue;
                return {text:match[0],source:clause.source};
            }
        }
        return null;
    }
    function add(tag, group, hits, confidence) {
        hits=(Array.isArray(hits)?hits:[hits]).filter(Boolean);
        if (!hits.length || veto.has(tag)) return;
        evidence.push({tag:tag,group:group,kind:group==='时代'?'服装时代':group==='风格'?'款式风格':'用途',source:group+'依据',confidence:confidence||0.9,
            evidence:Array.from(new Set(hits.map(function (hit) { return typeof hit==='string'?hit:hit.text; }))).join(' + ')});
    }
    function combo(tag, group, cues, confidence) { var hits=cues.map(function (re) { return find(re); });if(hits.every(Boolean))add(tag,group,hits,confidence||0.87); }
    var ancientNamed=find(/古代|古装|古风|唐制|宋制|明制|清代|唐代|宋代|明代|魏晋|汉服|汉代|秦汉|战国|仙侠服|侠客服/,true);
    var han=find(/汉服|襦裙|袄裙|诃子裙|袒领|齐胸(?:裙|襦裙)|齐腰襦裙|曲裾|深衣|褙子|比甲|道袍|直裰|曳撒|飞鱼服|圆领袍|马面裙|交领长袍/);
    var traditional1=find(/交领|对襟|右衽|大襟|圆领袍/),traditional2=find(/广袖|大袖|琵琶袖|披帛|腰封|襦|褙子|云肩|蔽膝|长袍|裙襕/);
    var western=find(/中世纪|欧式宫廷|欧洲宫廷|文艺复兴|维多利亚|洛可可|巴洛克|摄政时期|都铎|十八世纪|十九世纪|克里诺林|巴斯尔/);
    var kimono=find(/和服|振袖|留袖|日式浴衣/),qipao=find(/旗袍/),republic=find(/民国|近代|中山装|学生蓝布长衫/);
    var lolita=find(/洛丽塔|洛莉塔|Lolita|\blo\b|lo裙/i),jk=find(/\bJK\b|水手校服|学生制服|校服|学院制服/i);
    var contemporaryMix=find(/新中式|汉元素|汉服风|改良汉服|改良和服|现代改良|中式改良/);
    var modernTop=find(/T恤|T-shirt|卫衣|POLO|牛仔外套|西装外套/i),modernBottom=find(/牛仔裤|牛仔短裤|工装裤|西裤|西装裤/);
    var mixPair=!!(han&&(modernTop||modernBottom));
    var modern=find(/现代|连衣裙|吊带裙|抹胸|礼裙|鱼尾裙|花苞裙|A\s*字裙|蓬蓬裙|蓬裙|羽绒服|棉服|背带裤|短裙|半身裙|半裙|短裤|牛仔|衬衫|T恤|T-shirt|卫衣|开衫|针织|毛衣|西装|西服|西裤|夹克|风衣|大衣|运动服|瑜伽|泳衣|泳装|比基尼|情趣内衣|文胸|皮衣|露肩|挂脖|紧身衣|pajamas?|hoodie|sweater|cardigan|jeans|tracksuit/i);
    var gothic=find(/哥特|哥德|gothic|\bgoth\b/i,true),maid=find(/女仆(?:装|服|裙|制服|套装)?/,true),role=find(/cosplay|cos服|角色扮演|角色装|兔女郎|舞台装|舞台服|女仆/i,true);
    var fantasy=find(/仙侠|仙女装|魔法|魔女|巫师|精灵|奇幻|魔幻|修仙|神官|祭司|魔族/,true);
    var era='';
    if(contemporaryMix||mixPair){era='现代';add(era,'时代',[contemporaryMix||han,modernTop||modernBottom],0.91);if(!kimono||han)add('新中式','风格',contemporaryMix||han,0.91);}
    else if(lolita&&!ancientNamed){era='现代';add(era,'时代',lolita,0.95);}
    else if(ancientNamed||han||traditional1&&traditional2||western&&!gothic||kimono){era='古代';add(era,'时代',ancientNamed||han||western||kimono||[traditional1,traditional2],0.93);}
    else if(republic){era='近代';add(era,'时代',republic,0.94);}
    else if(modern||qipao||jk||gothic||maid||role){era='现代';add(era,'时代',modern||qipao||jk||gothic||maid||role,0.89);}
    if(era==='古代'&&(han||traditional1&&traditional2||ancientNamed&&!western&&!kimono))add(han||traditional1&&traditional2?'汉服':'古风','风格',han||(traditional1&&traditional2?[traditional1,traditional2]:ancientNamed),0.91);
    if(era==='古代'&&western)add('欧式古典','风格',western,0.92);
    if(republic&&era==='近代')add('民国','风格',republic,0.94);
    if(qipao)add('旗袍','风格',qipao,0.95);
    if(kimono)add('和风','风格',kimono,0.94);
    if(lolita)add('洛丽塔','风格',lolita,0.96);
    if(jk)add('JK','风格',jk,0.95);
    if(gothic)add('哥特','风格',gothic,0.94);
    var jirai=find(/地雷系/,true);if(jirai)add('地雷系','风格',jirai,0.94);
    if(maid)add('女仆','风格',maid,0.94);
    if(role&&!maid)add('角色装','风格',role,0.93);
    if(fantasy)add('奇幻','风格',fantasy,0.93);
    var sweet=find(/甜美|甜系|甜妹|甜酷|可爱系/,true),street=find(/街头|嘻哈|街舞|朋克|辣妹/,true),tech=find(/机能|战术|赛博/,true);
    if(sweet)add('甜美','风格',sweet);if(street)add('街头','风格',street);if(tech)add('机能','风格',tech);
    // Style comes from the garment's identity or several independent design cues.
    // A colour or a bow by itself does not establish a style or intended occasion.
    var styleNames=[['简约',/极简|简约|简洁风|minimalist/i],['优雅',/优雅|端庄|轻熟|知性/,true],['复古',/复古|怀旧|vintage|retro/i],['法式',/法式|法兰西风|法式茶歇/],['学院',/学院|学园|preppy/i],['运动风',/运动风|运动休闲|运动套装|运动服|瑜伽服|网球服|球衣|tracksuit|activewear/i],['休闲风',/休闲|日常款|常服|便服|casual/i],['通勤风',/通勤|职业装|商务|正装套装|office wear/i],['工装',/工装|cargo|workwear/i],['甜酷',/甜酷|辣妹|y2k|千禧/i],['性感',/性感|情趣|辣妹/,true]];
    styleNames.forEach(function(rule){var hit=find(rule[1],rule[2]);if(hit)add(rule[0],'风格',hit,0.92);});
    if(era!=='古代'&&!role&&!lolita&&!jk&&!qipao&&!kimono){
        combo('甜美','风格',[/蝴蝶结|荷叶边|木耳边|娃娃领|彼得潘领|泡泡袖|蓬蓬裙|百褶短裙/,/粉色|粉红|浅粉|鹅黄|奶黄|浅蓝|天蓝|白色蕾丝|奶油|碎花|花朵刺绣/],0.88);
        combo('优雅','风格',[/收腰|高腰|修身|包臀|鱼尾|裹身|茶歇裙|铅笔裙|及踝|及膝|长裙/,/缎面|丝绒|天鹅绒|珍珠|小香风|粗花呢|西装领|垂领|方领|船领|长袖|一字领/],0.87);
        combo('法式','风格',[/裹身|茶歇裙|方领|泡泡袖/,/碎花|波点|小碎花|格纹|收腰|绑带收腰/],0.89);
        combo('学院','风格',[/衬衫|针织背心|毛衣背心|领带|水手领|彼得潘领/,/百褶裙|格裙|格纹裙|制服裙|西装短裤|小西装/],0.89);
        combo('通勤风','风格',[/衬衫|西装|西服|blazer/i,/西裤|西装裤|直筒裤|铅笔裙|包臀半裙|包臀半身裙|过膝裙/],0.89);
        combo('休闲风','风格',[/T恤|T-shirt|卫衣|针织|毛衣|开衫|连帽|hoodie/i,/牛仔|休闲裤|阔腿裤|工装裤|运动裤|短裤|半身裙|半裙/],0.87);
        combo('运动风','风格',[/连帽|运动|卫衣|球服|拉链外套|弹力背心/,/运动裤|条纹裤|束脚裤|瑜伽裤|跑步短裤|球鞋|运动鞋/],0.90);
        combo('街头','风格',[/宽松|落肩|oversize|超大廓形/i,/卫衣|印花T恤|印花T-shirt|破洞牛仔|工装裤|棒球夹克|棒球帽/i],0.88);
        combo('甜酷','风格',[/露腰|短款|超短|吊带|抹胸|挂脖/,/皮革|皮衣|皮裙|金属链|铆钉|工装|破洞牛仔/],0.88);
        combo('复古','风格',[/灯笼袖|泡泡袖|羊腿袖|翻领|娃娃领|伞裙/,/波点|格纹|灯芯绒|彼得潘领|排扣|双排扣/],0.87);
        combo('简约','风格',[/纯色|素色|无图案|无印花|素面/,/直筒|基础款|圆领|V领|翻领|方领|针织|衬衫|T恤|吊带/i],0.86);
    }
    var purposes=[
        ['家居',/家居服|居家服|居家套装|家居套装|loungewear/i],['睡前',/睡衣|睡袍|睡裙|睡裤|pajamas?|pyjamas?|sleepwear|nightgown/i],
        ['海边',/泳衣|泳装|比基尼|沙滩裤|swimwear|swimsuit|bikini/i],['运动',/运动服|运动套装|健身服|瑜伽服|瑜伽裤|骑行服|网球裙|球衣|activewear|tracksuit/i],
        ['户外',/冲锋衣|登山服|徒步服|滑雪服/],['雨天',/雨衣|雨披|雨靴|防雨外套/],['正式',/晚礼服|晚礼裙|婚纱|婚服|礼服|礼裙|燕尾服|朝服|官服|冠服|tuxedo/i],
        ['通勤',/职业套装|职业装|商务套装|商务正装|通勤装|\bOL\b/i],['私密',/情趣|开裆|乳贴|胸贴|三点式|内衣套装|内衣套裙|蕾丝内衣|透明内衣|私房内衣/]
    ];
    purposes.forEach(function (rule) {var hit=find(rule[1]);if(hit)add(rule[0],'用途',hit,0.95);});
    if(evidence.some(function (item) {return item.tag==='睡前';}))add('家居','用途',find(/睡衣|睡袍|睡裙|睡裤|pajamas?|pyjamas?|sleepwear|nightgown/i),0.94);
    if(jk&&!find(/情趣|cosplay|角色扮演|cos服|舞台/i))add('校园','用途',jk,0.94);
    // Explicit purpose words may occur in names/categories or an intended-use
    // statement. Decorative lace, a traditional garment or cosplay is not one.
    var explicit=[['拍照',/拍照|写真|出片|摄影服|photoshoot/i],['节庆',/节庆|节日|春节|新年|中秋|端午|庆典|庙会|圣诞|万圣节/],
        ['约会',/约会|date night|dating/i],['派对',/派对|夜店|蹦迪|party|clubwear/i],['旅行',/旅行|度假|旅途|vacation|travel/i],['逛街',/逛街|购物|shopping/i],
        ['通勤',/通勤|上班|办公|商务|office wear/i],['户外',/户外|徒步|登山|露营/],['休闲',/休闲|常服|便服|casual/i]];
    explicit.forEach(function (rule) {
        var hit=find(rule[1],true);
        if(!hit)for(var i=0;i<positives.length;i++){var clause=positives[i],m=rule[1].exec(clause.text);if(!m)continue;var before=clause.text.slice(0,m.index),tail=clause.text.slice(m.index+m[0].length);
            if(/适合|适宜|用于|穿去|出席|参加|场景|用途|for\b/i.test(before)||/^(?:和|与|、|日常|都|均|也){0,6}(?:适合|适配|可穿)/.test(tail)){hit={text:m[0],source:clause.source};break;}}
        if(hit)add(rule[0],'用途',hit,0.97);
    });
    var privateWear=evidence.some(function(item){return item.tag==='私密';}),sleepWear=evidence.some(function(item){return item.tag==='睡前';}),swim=evidence.some(function(item){return item.tag==='海边';});
    if(era!=='古代'&&!privateWear&&!sleepWear&&!swim&&!role){
        combo('休闲','用途',[/T恤|T-shirt|卫衣|开衫|针织衫|毛衣|hoodie|cardigan|sweater/i,/牛仔裤|牛仔短裤|休闲裤|工装裤|运动裤|jeans|joggers/i]);
        combo('逛街','用途',[/衬衫|T恤|卫衣|开衫|针织上衣|背心|吊带上衣/i,/牛仔裤|休闲裤|半身裙|半裙|短裤|百褶裙/]);
        if(!jk&&!lolita&&!find(/超短|开裆/))combo('通勤','用途',[/衬衫|西装外套|西服外套|blazer/i,/西装裤|西裤|直筒长裤|铅笔裙|包臀半身裙|tailored trousers|pencil skirt/i]);
    }
    // A concrete garment form is useful when no style/use can be inferred; it
    // does not manufacture a scene merely to fill the requested number of tags.
    if(!evidence.some(function(item){return item.group!=='时代';})){
        var forms=[['套装',/套装|套裙|两件套|三件套/],['裙装',/裙|洋装/],['裤装',/裤/],['外套',/外套|夹克|风衣|大衣|披风|羽绒服|棉服/],['上装',/衬衫|T恤|卫衣|开衫|针织衫|上衣|背心/]];
        for(var n=0;n<forms.length;n++){var form=find(forms[n][1]);if(form){add(forms[n][0],'风格',form,0.86);break;}}
    }
    if(!era&&evidence.some(function(item){return ['休闲','通勤','校园','海边','运动'].includes(item.tag);}))add('现代','时代',evidence.find(function(item){return ['休闲','通勤','校园','海边','运动'].includes(item.tag);}).evidence,0.85);
    var seen=new Set();evidence=evidence.filter(function(item){if(seen.has(item.tag))return false;seen.add(item.tag);if(item.group!=='用途')return true;if(privateWear)return ['私密','拍照'].includes(item.tag);if(sleepWear)return ['睡前','家居'].includes(item.tag);if(swim)return !['通勤','正式','校园','家居'].includes(item.tag);if(era==='古代')return !['通勤','校园','旅行','派对'].includes(item.tag);return true;});
    var identityStyles=['汉服','古风','欧式古典','民国','新中式','旗袍','和风','JK','洛丽塔','哥特','地雷系','女仆','角色装','奇幻','机能'];
    evidence.sort(function(a,b){return ['时代','风格','用途'].indexOf(a.group)-['时代','风格','用途'].indexOf(b.group)||(a.group==='风格'&&b.group==='风格'?(identityStyles.includes(b.tag)?1:0)-(identityStyles.includes(a.tag)?1:0):0)||b.confidence-a.confidence;});
    var used={时代:0,风格:0,用途:0};return evidence.filter(function(item){return ++used[item.group] <= (item.group==='时代'?1:2);}).slice(0,5);
}
