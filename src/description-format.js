// Outfit Manager · 二改版 | 服装描述的单段正文整理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

var pairs={'（':'）','(':')','【':'】'};
function wrappedBlocks(text) {
    var blocks=[],at=0;
    while(at<text.length){
        while(/\s/.test(text[at]||'')&&at<text.length)at++;
        if(at===text.length)break;
        if(!pairs[text[at]])return null;
        var start=at+1,stack=[pairs[text[at++]]],end=-1;
        for(;at<text.length;at++){
            if(pairs[text[at]])stack.push(pairs[text[at]]);
            else if(text[at]===stack[stack.length-1]){stack.pop();if(!stack.length){end=at++;break;}}
        }
        if(end<0)return null;blocks.push(text.slice(start,end).trim());
    }
    return blocks.length?blocks:null;
}
export function normalizeGarmentParagraph(value) {
    var text=String(value||'').trim();
    for(var depth=0;depth<5;depth++){
        var blocks=wrappedBlocks(text);if(!blocks)break;
        text=blocks.map(function(block,index){
            block=block.replace(/^(?:整体|上装|下装|外套|内搭|裙裤|鞋袜|配饰|材质|颜色|后背)\s*[:：]\s*/,'');
            return block+(index<blocks.length-1&&!/[。；;！!]$/.test(block)?'；':'');
        }).join('');
    }
    return text.replace(/【(?:整体|上装|下装|外套|内搭|裙裤|鞋袜|配饰|材质|颜色|后背)】\s*/g,'').replace(/[\r\n]+\s*/g,' ').replace(/ {2,}/g,' ').trim();
}
