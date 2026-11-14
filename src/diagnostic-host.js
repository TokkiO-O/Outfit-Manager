// Outfit Manager · 二改版 | 宿主扩展开关与可独立使用的恢复接口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { restoreDisabled, desiredDisabled, uncontrolledSwitchChanges } from './diagnostic-job.js';

function normalized(value) { return Array.from(new Set(value || [])).sort(); }
function equal(a, b) { return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b)); }
function syncSelectedMemory(job, wanted) {
    try {
        var settings = SillyTavern.getContext().extensionSettings;
        if (!settings || !Array.isArray(settings.disabledExtensions)) return;
        // A pending native autosave must not reapply the test switches after
        // restoration. Preserve unrelated in-memory changes as well.
        settings.disabledExtensions = normalized(settings.disabledExtensions.filter(function(id){return !job.targets.includes(id);}).concat(job.targets.filter(function(id){return wanted.includes(id);})));
    } catch(ignored) {}
}
export async function diagnosticRequestHeaders() {
    try { var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext(); var get = ctx && ctx.getRequestHeaders || window.getRequestHeaders; if (typeof get === 'function') { var headers = new Headers(get()); headers.set('Content-Type', 'application/json'); return headers; } } catch (ignored) {}
    var response = await fetch('/csrf-token', { credentials: 'same-origin', cache: 'no-store' });
    var data = response.ok ? await response.json() : null;
    if (!data || typeof data.token !== 'string') throw new Error('DIAGNOSTIC_HOST_HEADERS');
    return { 'Content-Type': 'application/json', 'X-CSRF-Token': data.token };
}
async function settings() {
    var response = await fetch('/api/settings/get', { method: 'POST', credentials: 'same-origin', headers: await diagnosticRequestHeaders(), body: '{}', cache: 'no-store' });
    if (!response.ok) throw new Error('DIAGNOSTIC_HOST_READ');
    var data = await response.json(), value = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
    if (!value || !value.extension_settings || !Array.isArray(value.extension_settings.disabledExtensions)) throw new Error('DIAGNOSTIC_HOST_FORMAT');
    return value;
}
export async function readDiagnosticDisabled() { return normalized((await settings()).extension_settings.disabledExtensions); }
async function writeSettingsDisabled(disabled) {
    // Read the latest host settings; only replace the switch array. No settings
    // object is stored in the wizard journal, report or recovery download.
    var value = await settings(); value.extension_settings.disabledExtensions = normalized(disabled);
    var response = await fetch('/api/settings/save', { method: 'POST', credentials: 'same-origin', headers: await diagnosticRequestHeaders(), body: JSON.stringify(value), cache: 'no-store' });
    if (!response.ok) throw new Error('DIAGNOSTIC_HOST_SAVE');
}
async function serialized(action) {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') return navigator.locks.request('outfit-diagnostic-settings-v1', action);
    return action();
}
export async function loadDiagnosticHost() {
    var adapter = null;
    try { var host = await import('/scripts/extensions.js'); if (typeof host.enableExtension === 'function' && typeof host.disableExtension === 'function') adapter = host; } catch (ignored) {}
    var disabled = await readDiagnosticDisabled();
    return { automatic: true, disabled: disabled,
        async apply(job, enabled, stillOwned) {
            return serialized(async function () {
                var current = await readDiagnosticDisabled(); if (uncontrolledSwitchChanges(job, current)) throw new Error('DIAGNOSTIC_HOST_CHANGED');
                var wanted = desiredDisabled(job, enabled);
                if (adapter) {
                    for (var name of job.targets) {
                        if (!stillOwned()) throw new Error('DIAGNOSTIC_CANCELLED');
                        var off = current.includes(name), nextOff = wanted.includes(name);
                        if (off === nextOff) continue;
                        await (nextOff ? adapter.disableExtension : adapter.enableExtension)(name, false);
                    }
                } else { if (!stillOwned()) throw new Error('DIAGNOSTIC_CANCELLED'); syncSelectedMemory(job,wanted); await writeSettingsDisabled(wanted); }
                var actual = await readDiagnosticDisabled(); if (!equal(actual, wanted)) throw new Error('DIAGNOSTIC_HOST_SAVE_UNCONFIRMED');
                return actual;
            });
        },
        async matches(job, enabled) { return equal(await readDiagnosticDisabled(), desiredDisabled(job, enabled)); }
    };
}
export async function restoreDiagnosticHost(job) {
    return serialized(async function () {
        var current = await readDiagnosticDisabled(), wanted = restoreDisabled(job, current);
        syncSelectedMemory(job,wanted);
        if (!equal(current, wanted)) await writeSettingsDisabled(wanted);
        var actual = await readDiagnosticDisabled();
        return job.targets.every(function (name) { return actual.includes(name) === job.originalDisabled.includes(name); });
    });
}
