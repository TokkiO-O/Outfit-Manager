// Outfit Manager · 二改版 | 结构数据复制与稳定比较
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export function copyJson(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(copyJson);
    var result = {};
    Object.keys(value).forEach(function (key) {
        if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') result[key] = copyJson(value[key]);
    });
    return result;
}
export function sameJson(left, right) {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
    var a = Object.keys(left), b = Object.keys(right);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!Object.prototype.hasOwnProperty.call(right, a[i]) || !sameJson(left[a[i]], right[a[i]])) return false;
    return true;
}
export function checkCancelled(signal) { if (signal && signal.aborted) throw new Error('已取消导入'); }
export function yieldImport() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
