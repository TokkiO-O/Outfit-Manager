'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

async function environment() {
    const calls = [], handlers = new Map();
    const contextData = { chatId: 'a', chatMetadata: {}, chat: [{ mes: '办公室' }], name2: 'Alice',
        saveMetadata: () => Promise.resolve(), getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'synthetic' }),
        eventTypes: { CHAT_CHANGED: 'changed', CHAT_COMPLETION_SETTINGS_READY: 'ready' },
        eventSource: { on: (name, fn) => handlers.set(name, fn), makeFirst() {} } };
    const sandbox = { URL, AbortController, setTimeout, clearTimeout, console,
        location: new URL('http://local.invalid/'), XMLHttpRequest: class { open() {} send() {} },
        SillyTavern: { getContext: () => contextData },
        fetch: async (url, init) => {
            calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
            const status = sandbox.responseStatus || 200;
            const data = status === 200 ? { choices: [{ message: { content: '{"description":"recognized"}' } }] } : { error: 'synthetic rate limit' };
            return { ok: status === 200, status, text: async () => JSON.stringify(data), json: async () => data };
        }
    };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox), modules = new Map();
    function get(file) {
        const absolute = path.resolve(file);
        if (!modules.has(absolute)) modules.set(absolute, new vm.SourceTextModule(fs.readFileSync(absolute, 'utf8'), { context, identifier: absolute }));
        return modules.get(absolute);
    }
    async function load(file) {
        const mod = get(path.join(root, file));
        if (mod.status === 'unlinked') await mod.link((specifier, ref) => get(path.resolve(path.dirname(ref.identifier), specifier)));
        if (mod.status !== 'evaluated') await mod.evaluate();
        return mod.namespace;
    }
    return { contextData, sandbox, handlers, calls, load };
}

(async () => {
    const env = await environment();
    const data = await env.load('src/data.js'), state = await env.load('src/db/state.js');
    const chat = await env.load('src/chat-state.js'), planner = await env.load('src/injection-plan.js'), slots = await env.load('src/slots.js');
    const DB = state.DB;
    DB.metaCache = data.defMeta();
    DB.metaCache.charIndex = [{ id: '__shared__', name: '__shared__', partKey: 'char:__shared__' }];
    DB.metaCache.activePartitions = { 'user:__default__': ['office', 'home'] };
    DB.metaCache.apiVision = { endpoint: 'https://synthetic.invalid', key: 'synthetic-key', model: 'synthetic', prompt: 'recognize only', allowDirectFallback: true };
    const part = data.defPartition();
    part.outfits = [{ id: 'office', name: 'Office', description: 'WORN_SENTINEL', sceneTag: '办公室', imageData: 'data:image/png;base64,dGVzdA==' }, { id: 'home', name: 'Home', description: 'HOME', sceneTag: '睡前' }];
    part.activeIds = ['office', 'home']; DB.partCache['user:__default__'] = part;
    chat.applyChatContext(); chat.setCurrentOutfit('user:__default__', 'office', { locked: true });
    const metadataA = env.contextData.chatMetadata;
    env.contextData.chatId = 'b'; env.contextData.chatMetadata = {}; chat.applyChatContext(); chat.setCurrentOutfit('user:__default__', 'home');
    env.contextData.chatId = 'a'; env.contextData.chatMetadata = metadataA; chat.applyChatContext();
    assert.equal(chat.getChatState().current['user:__default__'].outfitId, 'office');
    assert.equal(chat.getChatState().current['user:__default__'].locked, true);
    assert.deepEqual(plain(chat.partitionForStorage('user:__default__', part).activeIds), ['office', 'home']);
    const owner = { name: 'User', partKey: 'user:__default__', partition: part, outfits: part.outfits, tplSingle: '{{description}}' };
    DB.metaCache.mode = 'both'; DB.metaCache.imagePrompt = '很长的图片提示'.repeat(100);
    DB.metaCache.injectionBudget = { maxTextTokens: 100, maxImages: 1, maxCandidates: 1, includeCandidates: true };
    const plan = planner.buildInjectionPlan([owner], DB.metaCache, { chat: chat.getChatState(), scene: '睡前', resolveImage: outfit => outfit.imageData });
    assert.equal(plan.rows.length, 1); assert.equal(plan.rows[0].id, 'office'); assert.equal(plan.imageCount, 1);
    assert.ok(plan.estimatedTextTokens <= 100); assert.match(plan.text, /已锁定/);
    const fallback = planner.buildInjectionPlan([owner], { ...DB.metaCache, mode: 'image' }, { chat: chat.getChatState(), resolveImage: () => '/api/private.png' });
    assert.equal(fallback.imageCount, 0); assert.match(fallback.text, /WORN_SENTINEL/); assert.ok(fallback.warnings.length);
    const resolved = slots.resolveAccessorySlots([{ id: 'h1', slot: 'head' }, { id: 'h2', slot: 'head' }, { id: 'r1', slot: 'hands' }, { id: 'r2', slot: 'hands' }]);
    assert.deepEqual(plain(resolved.items.map(item => item.id)), ['h2', 'r1', 'r2']);

    DB.metaCache.mode = 'text'; DB.metaCache.injectionBudget = { maxTextTokens: 1000, maxImages: 1, maxCandidates: 3 };
    const injection = await env.load('src/inject.js'), api = await env.load('src/api.js');
    injection.setupInjection();
    await new Promise((resolve, reject) => api.generateSingleDescription(part.outfits[0], (error, value) => error ? reject(new Error(error)) : resolve(value)));
    assert.equal(env.calls.length, 1); assert.doesNotMatch(JSON.stringify(env.calls[0].body), /WORN_SENTINEL/);
    assert.equal(env.calls[0].init.__omInternal, undefined, 'internal marker is not sent over HTTP');
    await env.sandbox.fetch('/api/unrelated', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'unrelated' }] }) });
    assert.doesNotMatch(JSON.stringify(env.calls.at(-1).body), /WORN_SENTINEL/);
    await env.sandbox.fetch('/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'chat' }] }) });
    assert.match(JSON.stringify(env.calls.at(-1).body), /WORN_SENTINEL/);
    env.calls.length = 0; env.sandbox.responseStatus = 429;
    const error = await new Promise(resolve => api.callVisionAPI(DB.metaCache.apiVision, { dataUrl: part.outfits[0].imageData }, 'recognize only', value => resolve(value)));
    assert.match(error, /HTTP 429/); assert.equal(env.calls.length, 1, 'rate limits must not trigger another direct request');

    const backup = await env.load('src/backup.js');
    const prefix = '/api/plugins/outfit-manager/images/';
    const source = { outfits: [{ imageData: prefix + 'image.png' }] };
    await assert.rejects(backup.prepareBackup(source, prefix, (urls, cb) => cb({})), value => value.missingImages.length === 1);
    const complete = await backup.prepareBackup(source, prefix, (urls, cb) => cb({ [urls[0]]: 'data:image/png;base64,dGVzdA==' }));
    assert.equal(complete._backupManifest.imageCount, 1); assert.equal(backup.validateBackup(complete).length, 0);
    delete complete._assets['image.png']; assert.equal(backup.validateBackup(complete).length, 1);
    console.log('features v3: pass (chat isolation / library defaults / lock / token-image budgets / slots / request isolation / rate-limit semantics / strict backups)');
})().catch(error => { console.error(error); process.exitCode = 1; });
