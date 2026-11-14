// Outfit Manager · 二改版 | 不联网的请求链探针
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

var KEY = typeof Symbol === 'function' ? Symbol('outfit-compatibility-probe') : '__omCompatibilityProbe';
var URL_TEXT = 'data:application/json,{"outfitCompatibility":"not-observed"}';
var installedFetch = null, installedOpen = null, installedSend = null, completion = false;

export function answerCompatibilityProbe(input, init) {
    if (input !== URL_TEXT || !init || !init[KEY]) return null;
    return Promise.resolve(new Response(JSON.stringify({ outfitCompatibility: 'observed', token: init[KEY] }), { headers: { 'Content-Type': 'application/json' } }));
}
export function markCompatibilityHooks(fetchFn, openFn, sendFn) { installedFetch = fetchFn; installedOpen = openFn; installedSend = sendFn; }
export function markCompatibilityCompletion(value) { completion = !!value; }
export function getCompatibilityHookState() {
    return { installed: !!installedFetch, completion: completion, fetchCurrent: typeof window !== 'undefined' && window.fetch === installedFetch,
        xhrCurrent: typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype.open === installedOpen && XMLHttpRequest.prototype.send === installedSend };
}
export async function probeCompatibilityFetch() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return 'unavailable';
    var token = Math.random().toString(36).slice(2), init = { method: 'GET', cache: 'no-store', credentials: 'omit' }, timer;
    init[KEY] = token;
    try {
        return await Promise.race([
            Promise.resolve().then(function () { return window.fetch(URL_TEXT, init); }).then(function (response) { return response.json(); }).then(function (value) { return value && value.outfitCompatibility === 'observed' && value.token === token ? 'observed' : 'not-observed'; }),
            new Promise(function (resolve) { timer = setTimeout(function () { resolve('timeout'); }, 1500); })
        ]);
    } catch (error) { return 'blocked'; }
    finally { clearTimeout(timer); }
}
