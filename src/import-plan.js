// Outfit Manager · 二改版 | 导入范围、更新与重复记录计划
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { copyJson } from './json-data.js';
import { wardrobeContentOnly, wardrobeRecordOnly } from './wardrobe-transfer.js';
var copy = copyJson;
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function safeCopy(value) {
    return copyJson(value);
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!object(value)) return value;
    var result = {};
    if (Array.isArray(value.kits)) result.activeKitIndex = value.kits.findIndex(function (kit) { return kit.id === value.activeKitId; });
    Object.keys(value).sort().forEach(function (key) {
        if (['id','createdAt','updatedAt','favorite','activeKitId'].includes(key) || key.indexOf('_om') === 0) return;
        result[key] = canonical(value[key]);
    });
    return result;
}
export function recordIdentity(item) {
    var value;
    if(Array.isArray(item.outfits)||Array.isArray(item.accessories))value={name:item.name,outfits:(item.outfits||[]).map(wardrobeRecordOnly),accessories:(item.accessories||[]).map(wardrobeRecordOnly),categories:item.categories||[],accCategories:item.accCategories||[]};
    else value=wardrobeRecordOnly(item);
    return JSON.stringify(canonical(value));
}
function empty() { return { outfits: [], accessories: [], categories: [], accCategories: [], activeIds: [] }; }
function uniqueId(list, prefix) {
    var id;
    do { id = (prefix || 'o_') + Math.random().toString(36).slice(2, 10).padEnd(8, '0'); } while (list.some(function (item) { return item.id === id; }));
    return id;
}
function combineCategories(target, incoming) {
    (incoming || []).forEach(function (value) {
        var name = typeof value === 'string' ? value : value && value.name;
        if (!name) return;
        var found = target.find(function (item) { return (typeof item === 'string' ? item : item.name) === name; });
        if (!found) target.push(copy(value));
        else if (object(value) && (value.children || []).length) {
            if (typeof found === 'string') { var at = target.indexOf(found); found = { name: name, children: [] }; target[at] = found; }
            found.children = Array.from(new Set((found.children || []).concat(value.children || [])));
        }
    });
}
function checkPartition(part) {
    if (!object(part)) throw new Error('衣柜数据格式不正确');
    ['outfits','accessories','categories','accCategories'].forEach(function (key) {
        if (part[key] !== undefined && !Array.isArray(part[key])) throw new Error(key + ' 必须是列表');
    });
    ['outfits','accessories'].forEach(function (key) {
        var ids = new Set();
        (part[key] || []).forEach(function (item) {
            if (!object(item) || (item.name !== undefined && typeof item.name !== 'string') ||
                (item.imageData !== undefined && typeof item.imageData !== 'string')) throw new Error('导入条目格式不正确');
            if (item.id && ids.has(item.id)) throw new Error('备份内存在重复条目标识，请先修正后再导入');
            if (item.id) ids.add(item.id);
        });
    });
}
function presetIdentity(name, part) {
    var accessories=(part.accessories||[]).map(wardrobeRecordOnly);
    var acc = new Map(accessories.map(function (item) { return [item.id, item]; }));
    var outfits = copy((part.outfits || []).map(wardrobeRecordOnly));
    outfits.forEach(function (outfit) { (outfit.kits || []).forEach(function (kit) {
        ['accIds','disabledAccIds'].forEach(function (field) { if (kit[field]) kit[field] = kit[field].map(function (id) { return acc.get(id) || id; }); });
    }); });
    return JSON.stringify(canonical({ name: name, outfits: outfits, accessories: accessories, categories: part.categories || [], accCategories: part.accCategories || [] }));
}
export function buildImportPlan(meta, partitions, source, mode, options) {
    options = options || {};
    if (!object(source)) throw new Error('备份必须是一个对象');
    source = wardrobeContentOnly(source, false);
    var result = { meta: copy(meta), partitions: {}, rows: [], mode: mode || 'merge', counts: { added: 0, updated: 0, skipped: 0, related: 0, removed: 0 } };
    var targets = [];
    function character(name, data) {
        var shared = name === '__shared__';
        var entry = result.meta.charIndex.find(function (item) { return shared ? item.id === '__shared__' : item.name === name; });
        if (!entry) {
            var id = shared ? '__shared__' : uniqueId(result.meta.charIndex, 'c_');
            entry = { id: id, name: name, partKey: 'char:' + id }; result.meta.charIndex.push(entry);
        }
        targets.push({ key: entry.partKey, name: shared ? '通用衣柜' : name, data: data });
    }
    function preset(preset) {
        if (!object(preset)) throw new Error('预设数据格式不正确');
        checkPartition(preset);
        var name = preset.name || '导入预设';
        var entry = result.meta.presets.find(function (item) { return item.id === preset.id; });
        var signature = presetIdentity(name, preset);
        if (!entry && mode !== 'update') entry = result.meta.presets.find(function (item) { return partitions[item.partKey] && presetIdentity(item.name, partitions[item.partKey]) === signature; });
        if (!entry && mode === 'update') {
            var named = result.meta.presets.filter(function (item) { return item.name === name; }); if (named.length === 1) entry = named[0];
        }
        if (entry && mode !== 'update') {
            var old = partitions[entry.partKey];
            if (!old || presetIdentity(entry.name, old) !== signature) entry = null;
        }
        if (!entry) { var id = uniqueId(result.meta.presets, 'p_'); entry = { id: id, name: name, partKey: 'user:' + id }; result.meta.presets.push(entry); }
        targets.push({ key: entry.partKey, name: '预设 · ' + name, data: preset });
    }
    result.meta.charIndex = result.meta.charIndex || []; result.meta.presets = result.meta.presets || [];
    if (source.type === 'preset' && source.preset) preset(source.preset);
    else if (source.type === 'char' && source.charName) character(source.charName, source);
    else {
        if (source.type !== 'chars_all') {
            if (!Array.isArray(source.outfits) && !Array.isArray(source.accessories) && !source.chars && !source.presets) throw new Error('未找到可导入的衣柜内容');
            var key = options.targetUserKey || (meta.activePresetId ? ((meta.presets || []).find(function (item) { return item.id === meta.activePresetId; }) || {}).partKey : 'user:__default__');
            targets.push({ key: key || 'user:__default__', name: 'User 衣柜', data: source });
        }
        if (source.chars) {
            if (!object(source.chars)) throw new Error('角色衣柜格式不正确');
            Object.keys(source.chars).forEach(function (name) { character(name, source.chars[name]); });
        }
        if (Array.isArray(source.presets)) source.presets.forEach(preset);
    }
    targets.forEach(function (target) {
        checkPartition(target.data);
        var original = partitions[target.key] || empty(), part = mode === 'replace' ? empty() : copy(original);
        var accMap = {};
        var processed = 0, total = targets.reduce(function(n,t){return n+(t.data.outfits||[]).length+(t.data.accessories||[]).length;},0);
        function index(list) {
            var result={list:list,exact:new Map(),names:new Map(),images:new Map(),ids:new Map(),originalExact:new Map(),originalNames:new Map(),originalIds:new Map(),used:new Set()};
            list.forEach(function(item){var sig=recordIdentity(item),bucket=result.originalExact.get(sig)||[];bucket.push(item);result.originalExact.set(sig,bucket);if(item.name){var named=result.originalNames.get(item.name)||[];named.push(item);result.originalNames.set(item.name,named);}result.originalIds.set(item.id,item);});
            result.add=function(item){var sig=recordIdentity(item);if(!result.exact.has(sig))result.exact.set(sig,item);if(item.name){var named=result.names.get(item.name)||[];named.push(item);result.names.set(item.name,named);}if(item.imageData)result.images.set(item.imageData,(result.images.get(item.imageData)||0)+1);result.ids.set(item.id,item);};
            result.remove=function(item){var sig=recordIdentity(item);if(result.exact.get(sig)===item)result.exact.delete(sig);if(item.name){var named=(result.names.get(item.name)||[]).filter(function(other){return other!==item;});result.names.set(item.name,named);}if(item.imageData)result.images.set(item.imageData,(result.images.get(item.imageData)||1)-1);result.ids.delete(item.id);};
            list.forEach(result.add);return result;
        }
        var outfitIndex=index(part.outfits),accIndex=index(part.accessories);
        if (mode === 'replace') result.counts.removed += (original.outfits || []).length + (original.accessories || []).length;
        function merge(idx, incoming, kind) {
            var list=idx.list,signature = recordIdentity(incoming), exact = (idx.originalExact.get(signature)||[]).find(function(item){return !idx.used.has(item.id);});
            processed++;
            if(options.onProgress&&processed%128===0)options.onProgress(result.rows.length,total);
            var row = { owner: target.name, kind: kind, name: incoming.name || '未命名', before: null, after: incoming, action: '新增' };
            if (exact && mode !== 'replace') {
                idx.used.add(exact.id);result.counts.skipped++; row.action = '完全重复 · 跳过'; result.rows.push(row); return exact.id;
            }
            var sameNames = idx.names.get(incoming.name)||[];
            var originalNames=(idx.originalNames.get(incoming.name)||[]).filter(function(item){return !idx.used.has(item.id);});
            var byId=incoming.id&&idx.originalIds.get(incoming.id);
            var match = mode === 'update' && (byId&&!idx.used.has(byId.id)&&byId || (originalNames.length === 1 && originalNames[0]));
            if (match) {
                row.before = copy(match); row.action = '更新'; result.counts.updated++;
                idx.used.add(match.id);
                idx.remove(match);
                var id = match.id; Object.keys(match).forEach(function (key) { delete match[key]; });
                Object.assign(match, copy(incoming), { id: id });idx.add(match); result.rows.push(row); return id;
            }
            if (sameNames.length || incoming.imageData && idx.images.get(incoming.imageData)) {
                row.action = '新增 · 同名或同图，保留两份'; result.counts.related++;
            }
            var item = copy(incoming),prefix=kind==='单品'?'a_':'o_',next;
            do{next=prefix+Math.random().toString(36).slice(2,10).padEnd(8,'0');}while(idx.ids.has(next));
            item.id=next;list.push(item);idx.add(item); result.counts.added++; result.rows.push(row); return item.id;
        }
        (target.data.accessories || []).forEach(function (item) { var id = merge(accIndex, item, '单品'); if (item.id) accMap[item.id] = id; });
        (target.data.outfits || []).forEach(function (value) {
            var item = copy(value), oldActive = item.activeKitId;
            (item.kits || []).forEach(function (kit, index) {
                var old = kit.id; kit.id = 'kit_' + index + '_' + Math.random().toString(36).slice(2, 8);
                if (old === oldActive) item.activeKitId = kit.id;
                ['accIds','disabledAccIds'].forEach(function (field) {
                    if (!Array.isArray(kit[field])) return;
                    kit[field] = kit[field].map(function (id) {
                        if (accMap[id]) return accMap[id];
                        if (accIndex.ids.has(id)) return id;
                        throw new Error('套装引用了备份中缺失的单品：' + id);
                    });
                });
            });
            merge(outfitIndex, item, '穿搭');
        });
        combineCategories(part.categories, target.data.categories);
        combineCategories(part.accCategories, target.data.accCategories);
        part.activeIds = (part.activeIds || []).filter(function (id) { return part.outfits.some(function (item) { return item.id === id; }); });
        result.partitions[target.key] = part;
    });
    result.meta.activePartitions = copy(meta.activePartitions || {});
    Object.keys(result.partitions).forEach(function (key) {
        var ids = result.partitions[key].activeIds;
        if (ids.length) result.meta.activePartitions[key] = ids.slice(); else delete result.meta.activePartitions[key];
    });
    return result;
}
