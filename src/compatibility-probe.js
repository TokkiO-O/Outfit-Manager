// Outfit Manager · 二改版 | 不联网的请求链探针
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { diagnosticFrames, sanitizeDiagnosticFrame } from './diagnostic-evidence.js';

var KEY = typeof Symbol === 'function' ? Symbol('outfit-compatibility-probe') : '__omCompatibilityProbe';
var URL_TEXT = 'data:application/json,{"outfitCompatibility":"not-observed"}';
var installedFetch = null, installedOpen = null, installedSend = null, completion = false;
var pending = new Set();

function probeToken(headers) {
    if (!headers) return null;
    try {
        if (typeof headers.get === 'function') return headers.get('X-OM-Compatibility-Probe');
        var key = Object.keys(headers).find(function (name) { return name.toLowerCase() === 'x-om-compatibility-probe'; });
        return key ? headers[key] : null;
    } catch (ignored) { return null; }
}

export function answerCompatibilityProbe(input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (url !== URL_TEXT) return null;
    var token = init && init[KEY] || probeToken(init && init.headers) || probeToken(input && input.headers);
    if (!pending.has(token)) return null;
    return Promise.resolve(new Response(JSON.stringify({ outfitCompatibility: 'observed', token: token, trace: diagnosticFrames(new Error()) }), { headers: { 'Content-Type': 'application/json' } }));
}
export function markCompatibilityHooks(fetchFn, openFn, sendFn) { installedFetch = fetchFn; installedOpen = openFn; installedSend = sendFn; }
export function markCompatibilityCompletion(value) { completion = !!value; }
export function getCompatibilityHookState() {
    return { installed: !!installedFetch, completion: completion, fetchCurrent: typeof window !== 'undefined' && window.fetch === installedFetch,
        xhrCurrent: typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype.open === installedOpen && XMLHttpRequest.prototype.send === installedSend };
}
async function runProbe(fetcher) {
    if (typeof fetcher !== 'function') return { status: 'unavailable', trace: [] };
    var token = Math.random().toString(36).slice(2), init = { method: 'GET', cache: 'no-store', credentials: 'omit', headers: { 'X-OM-Compatibility-Probe': token } }, timer;
    init[KEY] = token;
    pending.add(token);
    try {
        return await Promise.race([
            Promise.resolve().then(function () { return fetcher.call(window, URL_TEXT, init); }).then(function (response) { return response.json(); }).then(function (value) {
                return { status: value && value.outfitCompatibility === 'observed' && value.token === token ? 'observed' : 'not-observed',
                    trace: value && Array.isArray(value.trace) ? value.trace.slice(0, 8).map(sanitizeDiagnosticFrame).filter(Boolean) : [] };
            }),
            new Promise(function (resolve) { timer = setTimeout(function () { resolve({ status: 'timeout', trace: [] }); }, 1500); })
        ]);
    } catch (error) { return { status: 'blocked', trace: diagnosticFrames(error) }; }
    finally { clearTimeout(timer); pending.delete(token); }
}
export async function probeCompatibilityFetch() { return (await runProbe(typeof window !== 'undefined' ? window.fetch : null)).status; }
async function runTransportProbe() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return { status: 'unavailable', trace: [], errorTrace: [] };
    var token = Math.random().toString(36).slice(2), url = 'data:application/json,' + encodeURIComponent(JSON.stringify({ outfitTransport: token })), trace = [], samples = 0, timer;
    var init = { method: 'GET', cache: 'no-store', credentials: 'omit' };
    if (typeof Proxy === 'function') init = new Proxy(init, { get: function (target, name, receiver) {
        if (samples++ < 16) diagnosticFrames(new Error()).forEach(function (frame) {
            if (trace.length < 16 && !trace.some(function (old) { return JSON.stringify(old) === JSON.stringify(frame); })) trace.push(frame);
        });
        return Reflect.get(target, name, receiver);
    } });
    try {
        return await Promise.race([
            Promise.resolve().then(function () { return window.fetch(url, init); }).then(function (response) { return response.json(); }).then(function (value) { return { status: value && value.outfitTransport === token ? 'pass' : 'modified', trace: trace, errorTrace: [] }; }),
            new Promise(function (resolve) { timer = setTimeout(function () { resolve({ status: 'timeout', trace: trace, errorTrace: [] }); }, 1500); })
        ]);
    } catch (error) { return { status: 'blocked', trace: trace, errorTrace: diagnosticFrames(error) }; }
    finally { clearTimeout(timer); }
}
export async function inspectCompatibilityFetch() {
    var values = await Promise.all([runProbe(typeof window !== 'undefined' ? window.fetch : null), runProbe(installedFetch), runTransportProbe()]);
    return { outer: values[0], direct: values[1], transport: values[2], outerDiffers: values[0].status !== 'observed' && values[1].status === 'observed' };
}
