// Outfit Manager · 二改版 | 衣柜分享字段与个人设置隔离
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

var scalarFields = ['id','name','description','imageData','category','subCategory','sceneTag','favorite','createdAt','updatedAt','slot','slotExclusive','activeKitId'];
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function scalars(source, fields) {
    var result = {};
    fields.forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) return;
        var value = source[key];
        if(value===undefined)return;
        if (value !== null && !['string','number','boolean'].includes(typeof value)) throw new Error('衣柜字段格式不正确：' + key);
        result[key] = value;
    });
    return result;
}
function strings(value, label) {
    if (!Array.isArray(value) || value.some(function (item) { return typeof item !== 'string'; })) throw new Error(label + ' 必须是文字列表');
    return value.slice();
}
function categories(value) {
    if (!Array.isArray(value)) throw new Error('分类必须是列表');
    return value.map(function (item) {
        if (typeof item === 'string') return item;
        if (!object(item) || typeof item.name !== 'string') throw new Error('分类数据格式不正确');
        return { name: item.name, children: item.children === undefined ? [] : strings(item.children, '子分类') };
    });
}
export function wardrobeRecordOnly(source) {
    if (!object(source)) throw new Error('衣服或单品数据格式不正确');
    var result = scalars(source, scalarFields);
    if (source.kits !== undefined) {
        if (!Array.isArray(source.kits)) throw new Error('套装关系必须是列表');
        result.kits = source.kits.map(function (kit) {
            if (!object(kit)) throw new Error('套装关系格式不正确');
            var next = scalars(kit, ['id','name']);
            ['accIds','disabledAccIds'].forEach(function (key) { if (kit[key] !== undefined) next[key] = strings(kit[key], '单品引用'); });
            return next;
        });
    }
    var origin = source._omTagSource;
    if (object(origin)) {
        result._omTagSource = scalars(origin, ['kind','method','ruleVersion','appliedValue','at','reason']);
        if (origin.tags !== undefined) result._omTagSource.tags = strings(origin.tags, '标签来源');
    }
    return result;
}
function part(source, identity) {
    if (!object(source)) throw new Error('衣柜数据格式不正确');
    var result = identity ? scalars(source, ['id','name','createdAt']) : {};
    ['outfits','accessories'].forEach(function (key) {
        if (source[key] === undefined) return;
        if (!Array.isArray(source[key])) throw new Error(key + ' 必须是列表');
        result[key] = source[key].map(wardrobeRecordOnly);
    });
    ['categories','accCategories'].forEach(function (key) { if (source[key] !== undefined) result[key] = categories(source[key]); });
    // activeIds and per-chat choices are intentionally not shared.
    return result;
}
export function wardrobeContentOnly(source, includeAssets) {
    if (!object(source)) throw new Error('备份必须是一个对象');
    var result = Object.assign(scalars(source, ['type','charName']), part(source, false));
    if (source.preset !== undefined) result.preset = part(source.preset, true);
    if (source.presets !== undefined) {
        if (!Array.isArray(source.presets)) throw new Error('预设衣柜必须是列表');
        result.presets = source.presets.map(function (value) { return part(value, true); });
    }
    if (source.chars !== undefined) {
        if (!object(source.chars)) throw new Error('角色衣柜格式不正确');
        result.chars = Object.create(null);
        Object.keys(source.chars).filter(function (name) { return !['__proto__','constructor','prototype'].includes(name); }).forEach(function (name) { result.chars[name] = part(source.chars[name], false); });
        result.charNames = Object.keys(result.chars).filter(function (name) { return name !== '__shared__'; });
    }
    if (includeAssets) {
        var needed = new Set();
        function scan(value) { if (value) ['outfits','accessories'].forEach(function (kind) { (value[kind] || []).forEach(function (item) { var match = /^\/api\/plugins\/outfit-manager\/images\/(.+)$/.exec(item.imageData || ''); if (match) needed.add(match[1]); }); }); }
        scan(result); scan(result.preset); (result.presets || []).forEach(scan); Object.keys(result.chars || {}).forEach(function (key) { scan(result.chars[key]); });
        if (object(source._assets)) {
            result._assets = Object.create(null);
            needed.forEach(function (name) { if (Object.prototype.hasOwnProperty.call(source._assets, name)) result._assets[name] = source._assets[name]; });
        }
        if (source._backupManifest !== undefined) {
            var manifest = source._backupManifest;
            if (!object(manifest) || manifest.version !== 1 || !Array.isArray(manifest.images) || manifest.images.length !== manifest.imageCount) throw new Error('备份图片清单无效');
            result._backupManifest = {version:1,images:Array.from(needed),imageCount:needed.size};
        }
    }
    return result;
}
