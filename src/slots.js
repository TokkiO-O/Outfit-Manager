// Outfit Manager · 二改版 | 配饰槽位与互斥规则
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var SLOT_LABELS = { head: '帽子 / 头饰', hair: '发型', makeup: '妆容', neck: '颈部', outer: '外套', feet: '鞋袜', hands: '手部饰品', carry: '手持 / 随身', other: '其他（可叠加）' };
export var DEFAULT_EXCLUSIVE = ['head', 'hair', 'makeup', 'outer', 'feet'];

export function accessorySlot(item) {
    if (item.slot && SLOT_LABELS[item.slot]) return item.slot;
    var category = String(item.category || '');
    if (/发型|头发/.test(category)) return 'hair';
    if (/帽|头饰/.test(category)) return 'head';
    if (/妆/.test(category)) return 'makeup';
    if (/项链|颈|围巾/.test(category)) return 'neck';
    if (/外套|披风|罩衫/.test(category)) return 'outer';
    if (/鞋|袜|靴/.test(category)) return 'feet';
    if (/手镯|戒指|手链|美甲/.test(category)) return 'hands';
    if (/包|道具|手持/.test(category)) return 'carry';
    return 'other';
}

export function exclusiveAccessory(item, rules) {
    if (typeof item.slotExclusive === 'boolean') return item.slotExclusive;
    var slot = accessorySlot(item);
    return rules && typeof rules[slot] === 'boolean' ? rules[slot] : DEFAULT_EXCLUSIVE.indexOf(slot) !== -1;
}

export function resolveAccessorySlots(items, rules) {
    var chosen = [], conflicts = [];
    (items || []).forEach(function (item) {
        var slot = accessorySlot(item);
        var removed = chosen.filter(function (other) {
            return accessorySlot(other) === slot && (exclusiveAccessory(item, rules) || exclusiveAccessory(other, rules));
        });
        if (removed.length) {
            conflicts.push({ slot: slot, kept: item.id, removed: removed.map(function (other) { return other.id; }) });
            chosen = chosen.filter(function (other) { return removed.indexOf(other) === -1; });
        }
        chosen.push(item);
    });
    return { items: chosen, conflicts: conflicts };
}
