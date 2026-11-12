// Outfit Manager · 二改版 | 标签拆分、合并与统计
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export function splitSceneTags(raw) {
    if (!raw || !String(raw).trim()) return [];
    return String(raw).split(/[,，、/|]/).map(function (s) { return s.trim(); }).filter(Boolean);
}
export function joinSceneTags(arr) {
    var seen = {}; var out = [];
    (arr || []).forEach(function (t) {
        t = String(t || '').trim();
        if (!t || seen[t]) return;
        seen[t] = true; out.push(t);
    });
    return out.join('、');
}
export function collectPartitionTags(part) {
    var map = {}; // tag -> count
    (part.outfits || []).forEach(function (o) {
        splitSceneTags(o.sceneTag).forEach(function (tg) {
            map[tg] = (map[tg] || 0) + 1;
        });
    });
    return map;
}
export function replaceTagInPartition(part, fromTag, toTag) {
    var n = 0;
    (part.outfits || []).forEach(function (o) {
        var tags = splitSceneTags(o.sceneTag);
        var changed = false;
        var next = [];
        var seen = {};
        tags.forEach(function (tg) {
            var v = (tg === fromTag) ? (toTag || '') : tg;
            if (!v) { changed = true; return; }
            if (tg === fromTag && toTag) changed = true;
            if (seen[v]) { if (tg === fromTag) changed = true; return; }
            seen[v] = true;
            next.push(v);
        });
        if (changed) {
            o.sceneTag = joinSceneTags(next);
            n++;
        }
    });
    return n;
}

