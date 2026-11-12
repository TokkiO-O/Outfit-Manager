// Outfit Manager · 二改版 | 衣柜结构与引用检查
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var CONFLICT_TYPES = {
    DUP_OUTFIT_ID: { severity: 'high', label: '穿搭 id 重复' },
    DUP_ACC_ID: { severity: 'high', label: '单品 id 重复' },
    NO_OUTFIT_ID: { severity: 'high', label: '穿搭缺 id' },
    NO_ACC_ID: { severity: 'high', label: '单品缺 id' },
    DEAD_ACTIVE: { severity: 'mid', label: '正在穿引用了已删除的穿搭' },
    DEAD_KIT_ACC: { severity: 'mid', label: '套装引用了已删除的单品' },
    DEAD_KIT_DISABLED: { severity: 'low', label: '套装「已停用」里有无关键' },
    DUP_KIT_ACC: { severity: 'low', label: '套装里同一单品出现多次' },
    EMPTY_KIT: { severity: 'low', label: '空套装' },
    DEAD_OUTFIT_CAT: { severity: 'mid', label: '穿搭分类已不存在' },
    DEAD_ACC_CAT: { severity: 'low', label: '单品分类已不存在' }
};

function catNameOf(c) {
    if (typeof c === 'string') return c;
    return c && typeof c.name === 'string' ? c.name : '';
}

function arr(v) {
    return Array.isArray(v) ? v : [];
}

/**
 * 只读扫描。不会修改传入的 part。
 * @returns {{issues:Array, counts:Object, total:number, fixable:number, bySeverity:Object}}
 */
export function scanConflicts(part) {
    part = part || {};
    var outfits = arr(part.outfits);
    var accs = arr(part.accessories);
    var cats = arr(part.categories);
    var accCats = arr(part.accCategories);
    var activeIds = arr(part.activeIds);

    var outfitById = {};
    var accById = {};
    var catSet = {};
    var accCatSet = {};

    outfits.forEach(function (o) { if (o && o.id) outfitById[o.id] = o; });
    accs.forEach(function (a) { if (a && a.id) accById[a.id] = a; });
    cats.forEach(function (c) { var n = catNameOf(c); if (n) catSet[n] = true; });
    accCats.forEach(function (c) { var n = catNameOf(c); if (n) accCatSet[n] = true; });

    var issues = [];
    function add(type, detail, ref) {
        var meta = CONFLICT_TYPES[type] || { severity: 'low', label: type };
        var item = {
            type: type,
            severity: meta.severity,
            label: meta.label,
            detail: detail
        };
        if (ref) for (var k in ref) item[k] = ref[k];
        issues.push(item);
    }

    // ── id 完整性 ──────────────────────────────────────
    var seenO = {};
    var seenA = {};
    outfits.forEach(function (o, i) {
        if (!o) return;
        if (!o.id) { add('NO_OUTFIT_ID', (o.name || '第 ' + (i + 1) + ' 套') + ' 没有 id', { index: i }); return; }
        if (seenO[o.id]) add('DUP_OUTFIT_ID', 'id ' + o.id + ' 出现多次', { outfitId: o.id });
        else seenO[o.id] = true;
    });
    accs.forEach(function (a, i) {
        if (!a) return;
        if (!a.id) { add('NO_ACC_ID', (a.name || '第 ' + (i + 1) + ' 件') + ' 没有 id', { index: i }); return; }
        if (seenA[a.id]) add('DUP_ACC_ID', 'id ' + a.id + ' 出现多次', { accId: a.id });
        else seenA[a.id] = true;
    });

    // ── activeIds 断链 ─────────────────────────────────
    var deadActive = [];
    activeIds.forEach(function (id) {
        if (id && !outfitById[id]) deadActive.push(id);
    });
    if (deadActive.length) {
        add('DEAD_ACTIVE', deadActive.length + ' 个「正在穿」指向已删除的穿搭', { ids: deadActive });
    }

    // ── 套装断链 ───────────────────────────────────────
    var deadKitAccCount = 0;
    var deadKitAccSamples = [];
    var deadDisabledCount = 0;
    var dupKitAccCount = 0;
    var emptyKitCount = 0;

    outfits.forEach(function (o) {
        if (!o || !Array.isArray(o.kits)) return;
        o.kits.forEach(function (kit, ki) {
            if (!kit || typeof kit !== 'object') return;
            var accIds = arr(kit.accIds);
            var disabled = arr(kit.disabledAccIds);

            var seenInKit = {};
            accIds.forEach(function (id) {
                if (!id) return;
                if (seenInKit[id]) { dupKitAccCount++; return; }
                seenInKit[id] = true;
                if (!accById[id]) {
                    deadKitAccCount++;
                    if (deadKitAccSamples.length < 8) {
                        deadKitAccSamples.push((o.name || o.id) + ' / ' + (kit.name || ('套装' + (ki + 1))));
                    }
                }
            });
            disabled.forEach(function (id) {
                if (id && !seenInKit[id]) deadDisabledCount++;
            });
            if (!accIds.length && o.kits.length > 1) emptyKitCount++;
        });
    });

    if (deadKitAccCount) {
        add('DEAD_KIT_ACC', deadKitAccCount + ' 处套装引用了不存在的单品', { samples: deadKitAccSamples });
    }
    if (deadDisabledCount) add('DEAD_KIT_DISABLED', deadDisabledCount + ' 处「已停用」指向不在套装里的单品');
    if (dupKitAccCount) add('DUP_KIT_ACC', dupKitAccCount + ' 处套装内同一单品重复出现');
    if (emptyKitCount) add('EMPTY_KIT', emptyKitCount + ' 个套装没有任何单品');

    // ── 分类孤儿 ───────────────────────────────────────
    var deadOutfitCat = {};
    outfits.forEach(function (o) {
        if (!o) return;
        var c = typeof o.category === 'string' ? o.category.trim() : '';
        if (c && !catSet[c]) deadOutfitCat[c] = (deadOutfitCat[c] || 0) + 1;
    });
    var deadOutfitCatNames = Object.keys(deadOutfitCat);
    if (deadOutfitCatNames.length) {
        add('DEAD_OUTFIT_CAT', deadOutfitCatNames.length + ' 个穿搭分类不在分类表里（涉及 ' +
            deadOutfitCatNames.reduce(function (s, k) { return s + deadOutfitCat[k]; }, 0) + ' 套）',
            { names: deadOutfitCatNames });
    }

    var deadAccCat = {};
    accs.forEach(function (a) {
        if (!a) return;
        var c = typeof a.category === 'string' ? a.category.trim() : '';
        if (c && !accCatSet[c]) deadAccCat[c] = (deadAccCat[c] || 0) + 1;
    });
    var deadAccCatNames = Object.keys(deadAccCat);
    if (deadAccCatNames.length) {
        add('DEAD_ACC_CAT', deadAccCatNames.length + ' 个单品分类不在分类表里（涉及 ' +
            deadAccCatNames.reduce(function (s, k) { return s + deadAccCat[k]; }, 0) + ' 件）',
            { names: deadAccCatNames });
    }

    // ── 汇总 ───────────────────────────────────────────
    // 「可修复」只算真正能自动处理的。
    // id 重复 / 缺 id 不在此列：不知道用户想保留哪一条，硬修只会帮倒忙。
    var AUTO_FIXABLE = {
        DEAD_ACTIVE: 1,
        DEAD_KIT_ACC: 1,
        DEAD_KIT_DISABLED: 1,
        DUP_KIT_ACC: 1,
        EMPTY_KIT: 1,
        DEAD_OUTFIT_CAT: 1,
        DEAD_ACC_CAT: 1
    };
    var bySeverity = { high: 0, mid: 0, low: 0 };
    var fixable = 0;
    issues.forEach(function (it) {
        bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1;
        if (AUTO_FIXABLE[it.type]) fixable++;
    });

    return {
        issues: issues,
        counts: {
            outfits: outfits.length,
            accessories: accs.length,
            deadActive: deadActive.length,
            deadKitAcc: deadKitAccCount,
            deadKitDisabled: deadDisabledCount,
            dupKitAcc: dupKitAccCount,
            emptyKit: emptyKitCount,
            deadOutfitCat: deadOutfitCatNames.length,
            deadAccCat: deadAccCatNames.length
        },
        total: issues.length,
        fixable: fixable,
        bySeverity: bySeverity
    };
}

/**
 * 修复「确定是死的」引用。会**直接修改**传入的 part，调用方负责 save。
 * 不处理 NO_ID / DUP_ID：那两种没法自动决定保留哪一条，必须人来定。
 *
 * @returns {{changed:number, actions:Array<string>}}
 */
export function repairConflicts(part) {
    part = part || {};
    var actions = [];
    var changed = 0;

    var outfits = arr(part.outfits);
    var accs = arr(part.accessories);
    var accById = {};
    accs.forEach(function (a) { if (a && a.id) accById[a.id] = a; });

    // 1) 清掉 activeIds 里的死引用
    if (Array.isArray(part.activeIds)) {
        var before = part.activeIds.length;
        var outfitById = {};
        outfits.forEach(function (o) { if (o && o.id) outfitById[o.id] = o; });
        part.activeIds = part.activeIds.filter(function (id) { return id && outfitById[id]; });
        var removed = before - part.activeIds.length;
        if (removed > 0) {
            changed += removed;
            actions.push('从「正在穿」移除 ' + removed + ' 个已删除的穿搭');
        }
    }

    // 2) 套装：去重 + 剔除死引用 + 清理无关键 + 删空套装
    outfits.forEach(function (o) {
        if (!o || !Array.isArray(o.kits)) return;
        o.kits.forEach(function (kit) {
            if (!kit || typeof kit !== 'object') return;
            var seen = {};
            var kept = [];
            var dropped = 0;
            arr(kit.accIds).forEach(function (id) {
                if (!id || !accById[id]) { dropped++; return; }
                if (seen[id]) { dropped++; return; }
                seen[id] = true;
                kept.push(id);
            });
            if (dropped > 0) {
                kit.accIds = kept;
                changed += dropped;
                actions.push((o.name || o.id) + ' / ' + (kit.name || '套装') + '：清掉 ' + dropped + ' 个无效单品');
            }
            if (Array.isArray(kit.disabledAccIds)) {
                var dBefore = kit.disabledAccIds.length;
                kit.disabledAccIds = kit.disabledAccIds.filter(function (id) { return id && seen[id]; });
                if (kit.disabledAccIds.length !== dBefore) {
                    changed += dBefore - kit.disabledAccIds.length;
                }
            }
        });
        // 只在有多个套装时才删空套装——只剩一个套装的话留着当容器
        if (o.kits.length > 1) {
            var kBefore = o.kits.length;
            o.kits = o.kits.filter(function (kit) {
                return kit && arr(kit.accIds).length > 0;
            });
            if (o.kits.length !== kBefore) {
                changed += kBefore - o.kits.length;
                actions.push((o.name || o.id) + '：删除 ' + (kBefore - o.kits.length) + ' 个空套装');
            }
        }
        if(o.activeKitId&&!o.kits.some(function(kit){return kit&&kit.id===o.activeKitId;})){
            o.activeKitId=o.kits.length?o.kits[0].id:null;changed++;actions.push((o.name||o.id)+'：更新当前套装引用');
        }
    });

    // 3) 分类孤儿：补登记而不是清空（清空会丢信息）
    var catSet = {};
    arr(part.categories).forEach(function (c) { var n = catNameOf(c); if (n) catSet[n] = true; });
    var addedCats = 0;
    outfits.forEach(function (o) {
        if (!o) return;
        var c = typeof o.category === 'string' ? o.category.trim() : '';
        if (c && !catSet[c]) {
            catSet[c] = true;
            if (!Array.isArray(part.categories)) part.categories = [];
            part.categories.push(c);
            addedCats++;
        }
    });
    if (addedCats > 0) {
        changed += addedCats;
        actions.push('把 ' + addedCats + ' 个孤儿穿搭分类补登记到分类表');
    }

    var accCatSet = {};
    arr(part.accCategories).forEach(function (c) { var n = catNameOf(c); if (n) accCatSet[n] = true; });
    var addedAccCats = 0;
    accs.forEach(function (a) {
        if (!a) return;
        var c = typeof a.category === 'string' ? a.category.trim() : '';
        if (c && !accCatSet[c]) {
            accCatSet[c] = true;
            if (!Array.isArray(part.accCategories)) part.accCategories = [];
            part.accCategories.push(c);
            addedAccCats++;
        }
    });
    if (addedAccCats > 0) {
        changed += addedAccCats;
        actions.push('把 ' + addedAccCats + ' 个孤儿单品分类补登记到分类表');
    }

    return { changed: changed, actions: actions };
}
