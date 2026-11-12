// Outfit Manager · 二改版 | 识图接口、模型列表与分类请求
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { load, save, loadMeta, loadCurrent, saveCurrent, loadPartition, savePartition, currentPartKey, resolveImageForExternal } from './db/index.js';
import { getById, partGetById, partGetAccById } from './data.js';
import { toast, getPopupLayer, esc, mountPopup } from './utils.js';
import { registerVisionWorker, runVisionBatch, imageFingerprint } from './vision-batch.js';
import { ensurePartitionLoaded } from './db/index.js';
import { fn } from './bridge.js';
import { normalizeGarmentParagraph } from './description-format.js';

// ── 端点规范化（兼容 OpenAI / 中转站 / 火山方舟 Ark）────────
export function normalizeEndpoint(raw, path) {
    try {
        var u = String(raw || '').trim().replace(/\/+$/, '');
        if (!u) return path;
        path = path || '';

        // 已是完整路径
        if (/\/chat\/completions\/?$/i.test(u)) return u.replace(/\/+$/, '');
        if (/\/models\/?$/i.test(u) && /models/i.test(path)) return u.replace(/\/+$/, '');

        var isVolc = /volces\.com|volcengine\.com|ark\.cn-|\.volc\./i.test(u);

        // 火山方舟：https://ark.cn-beijing.volces.com/api/v3 → …/api/v3/chat/completions
        // 模型名填接入点 ID（ep-xxxx），不要误切成 /v1
        if (isVolc) {
            // 纠正常见误填：/api/plan/v3 → /api/v3
            u = u.replace(/\/api\/plan\/v(\d+)/ig, '/api/v$1');
            u = u.replace(/\/api\/v(\d+)\/plan/ig, '/api/v$1');
            // 去掉多余 path，只保留到 /api/vN
            var volcBase = u.match(/^(https?:\/\/[^/?#]+\/api\/v\d+)/i);
            if (volcBase) {
                return volcBase[1] + (/models/i.test(path) ? '/models' : '/chat/completions');
            }
            if (/\/api\/v\d+$/i.test(u)) {
                return u + (/models/i.test(path) ? '/models' : '/chat/completions');
            }
            if (!/\/api\//i.test(u)) {
                return u + (/models/i.test(path) ? '/api/v3/models' : '/api/v3/chat/completions');
            }
            return u.replace(/\/+$/, '') + (/models/i.test(path) ? '/models' : '/chat/completions');
        }

        // OpenAI 兼容：去掉尾部 /v1 再拼 path
        if (u.match(/\/v\d+$/)) u = u.replace(/\/v\d+$/, '');
        if (u.match(/\/v\d+\/.*$/)) u = u.replace(/\/v\d+\/.*$/, '');
        return u + path;
    } catch (e) { return String(raw || '') + path; }
}

/** 统一网络错误文案（浏览器直连常被 CORS 拦） */
export function formatApiNetworkError(err, endpoint) {
    var msg = (err && err.message) ? err.message : String(err || '未知错误');
    if (err && err.name === 'AbortError' && err.userCancelled) return '请求已取消';
    if (err && err.name === 'AbortError') {
        return '请求超时（' + Math.round((err.timeoutMs || 0) / 1000) + ' 秒没有响应）。'
            + '换个网络、或把地址换成中转站再试。';
    }
    if (/Failed to fetch|NetworkError|Load failed|network error/i.test(msg)) {
        var hint = '网络/跨域失败';
        hint += '。请检查 API 地址、网络和服务端代理；如接口不提供模型列表，可以手动填写模型名称。';
        return hint;
    }
    return msg;
}

// ── 地址与请求的公共处理 ──────────────────────────────────
// 酒馆的 reverse_proxy 语义是「到版本号为止的根」，它自己会拼 /chat/completions。
// 所以这里要保证：火山截到 /api/vN，其它一律到 /vN，没写版本号的补 /v1。
// 生成和拉模型列表必须走同一套归一化，否则会出现「能生成但拉不到模型」这种怪现象。
export function normalizeReverseProxy(raw) {
    var u = String(raw || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    // 去掉已经带上的端点后缀
    u = u.replace(/\/chat\/completions\/?$/i, '').replace(/\/models\/?$/i, '');
    // 纠正常见误填：/api/plan/v3 → /api/v3
    u = u.replace(/\/api\/plan\/v(\d+)/ig, '/api/v$1').replace(/\/api\/v(\d+)\/plan/ig, '/api/v$1');
    // 火山方舟：截到 /api/vN
    var volc = u.match(/^(https?:\/\/[^/?#]+\/api\/v\d+)/i);
    if (volc) return volc[1];
    // 已经以 /vN 结尾：直接用
    if (/\/v\d+$/i.test(u)) return u;
    // 带了 /vN/多余路径：截到 /vN
    var vn = u.match(/^(https?:\/\/[^/?#]+\/.*?\/v\d+)(?:\/|$)/i);
    if (vn) return vn[1];
    // 没写版本号：补 /v1
    return u + '/v1';
}

/** 有的用户会把 "Bearer " 一起粘进 Key 框，避免出现 Bearer Bearer xxx */
function stripBearer(key) {
    return String(key || '').trim().replace(/^Bearer\s+/i, '');
}

/**
 * 带超时的 fetch。
 * 手机网络下最难受的不是报错，是「一直转圈」—— 没有超时的话请求可以挂到天荒地老，
 * 界面永远停在「正在识别…」。所有对外请求都必须有上限。
 */
export function fetchWithTimeout(url, opts, timeoutMs) {
    var ms = timeoutMs || 60000;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var opt = Object.assign({}, opts || {}, { __omInternal: true });
    var external = opt.signal;
    function abort() { if (ctrl) ctrl.abort(); }
    if (external && external.aborted) { var cancelled = new Error('请求已取消'); cancelled.name = 'AbortError'; cancelled.userCancelled = true; return Promise.reject(cancelled); }
    if (external && ctrl) external.addEventListener('abort', abort, { once: true });
    if (ctrl) opt.signal = ctrl.signal;
    var timer = setTimeout(abort, ms);
    function cleanup() { clearTimeout(timer); if (external && ctrl) external.removeEventListener('abort', abort); }
    function tag(error) { if (error && error.name === 'AbortError') { error.timeoutMs = ms; error.userCancelled = !!(external && external.aborted); } return error; }
    return fetch(url, opt).then(function (response) {
        // Keep the timeout/cancel signal alive until the body has been read.
        ['text', 'json', 'blob', 'arrayBuffer'].forEach(function (name) {
            if (typeof response[name] !== 'function') return;
            var read = response[name].bind(response);
            response[name] = function () { return read().catch(function (error) { throw tag(error); }).finally(cleanup); };
        });
        return response;
    }, function (error) { cleanup(); throw tag(error); });
}

/** 取 ST 请求头（含 CSRF），走同源 */
function getStRequestHeaders() {
    // 优先用酒馆自己给的方法 —— 它一定带上了当前会话的 CSRF token
    try {
        var ctx = (window.SillyTavern && window.SillyTavern.getContext)
            ? window.SillyTavern.getContext()
            : (typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null);
        if (ctx && typeof ctx.getRequestHeaders === 'function') {
            var h = ctx.getRequestHeaders();
            if (h && typeof h === 'object') return h;
        }
    } catch (e) {}
    // 兜底一：全局方法（部分版本只挂在 window 上）
    try {
        if (typeof window.getRequestHeaders === 'function') {
            var h2 = window.getRequestHeaders();
            if (h2 && typeof h2 === 'object') return h2;
        }
    } catch (e2) {}
    return { 'Content-Type': 'application/json' };
}

/** 拿不到 CSRF 时补一次，避免直接吃 403 */
function ensureCsrf(headers) {
    var h = headers || {};
    var has = false;
    try {
        if (typeof h.get === 'function') has = !!h.get('X-CSRF-Token');
        else has = !!(h['X-CSRF-Token'] || h['x-csrf-token']);
    } catch (e) {}
    if (has) return Promise.resolve(h);
    return fetchWithTimeout('/csrf-token', { credentials: 'same-origin' }, 8000)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
            if (j && j.token) {
                if (typeof h.set === 'function') h.set('X-CSRF-Token', j.token);
                else h['X-CSRF-Token'] = j.token;
            }
            return h;
        })
        .catch(function () { return h; });
}

/**
 * 通过 SillyTavern 服务端代理调上游（/api/backends/chat-completions/generate）
 * 浏览器只打同源，由 ST Node 去请求火山，避开 CORS。
 * 使用 openai + reverse_proxy + proxy_password，把用户填的 endpoint/key 传给后端。
 */
export function callViaStProxy(apiCfg, messages, maxTokens, cb, requestOptions) {
    requestOptions = requestOptions || {};
    var reverseProxy = normalizeReverseProxy(apiCfg && apiCfg.endpoint);

    // openai + reverse_proxy + proxy_password 三个字段一起才能让酒馆替我们转发
    // tool_choice:'none' 防止第三方 fetch 拦截器改写成工具调用
    var body = {
        chat_completion_source: 'openai',
        reverse_proxy: reverseProxy,
        proxy_password: stripBearer(apiCfg && apiCfg.key),
        model: (apiCfg && apiCfg.model) || '',
        messages: messages || [],
        max_tokens: maxTokens || 1024,
        stream: false,
        temperature: 0.7,
        presence_penalty: 0,
        frequency_penalty: 0,
        tool_choice: 'none'
    };

    ensureCsrf(getStRequestHeaders()).then(function (headers) {
        // 视觉请求要把整张图传上去，给足时间；纯文字请求 90 秒也够了
        var timeoutMs = /image_url/.test(JSON.stringify(messages || []).slice(0, 4000)) ? 180000 : 90000;
        return fetchWithTimeout('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify(body), signal: requestOptions.signal
        }, timeoutMs);
    }).then(function (r) {
        return r.text().then(function (t) {
            var data = null;
            try { data = t ? JSON.parse(t) : null; } catch (pe) {}
            if (!r.ok) {
                var errMsg = 'HTTP ' + r.status;
                if (data && (data.error || data.message)) {
                    errMsg += ': ' + (typeof data.error === 'string' ? data.error : (data.error && data.error.message) || data.message);
                } else if (t) {
                    errMsg += ': ' + String(t).slice(0, 180);
                }
                throw new Error(errMsg);
            }
            if (data && data.error) {
                throw new Error(typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error)));
            }
            return data;
        });
    }).then(function (data) {
        var text = '';
        if (data && data.choices && data.choices[0]) {
            var msg = data.choices[0].message || data.choices[0].delta || {};
            if (typeof msg.content === 'string') text = msg.content;
            else if (Array.isArray(msg.content)) {
                text = msg.content.map(function (p) { return (p && p.text) || (p && p.type === 'text' && p.text) || ''; }).join('');
            }
        }
        // 有的代理把正文放在 data.content
        if (!text && data && typeof data.content === 'string') text = data.content;
        cb(null, text.trim(), data);
    }).catch(function (e) {
        cb(formatApiNetworkError(e, apiCfg && apiCfg.endpoint));
    });
}

/** 优先 ST 代理，失败再尝试浏览器直连 */
export function callChatCompletions(apiCfg, messages, maxTokens, cb, requestOptions) {
    requestOptions = requestOptions || {};
    callViaStProxy(apiCfg, messages, maxTokens, function (err, text, raw) {
        if (!err) { cb(null, text, raw); return; }
        if ((requestOptions.signal && requestOptions.signal.aborted) || !apiCfg.allowDirectFallback || !/HTTP (404|501)|网络|跨域|Failed to fetch|NetworkError/i.test(String(err))) { cb(err); return; }
        // Only explicit opt-in transport fallback; never duplicate auth/rate-limit/provider failures.
        var url = normalizeEndpoint(apiCfg.endpoint, '/v1/chat/completions');
        fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + stripBearer(apiCfg && apiCfg.key)
            },
            signal: requestOptions.signal,
            body: JSON.stringify({
                model: (apiCfg && apiCfg.model) || '',
                messages: messages || [],
                max_tokens: maxTokens || 1024
            })
        }).then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ': ' + String(t).slice(0, 180)); });
            return r.json();
        }).then(function (data) {
            var text2 = '';
            if (data && data.choices && data.choices[0] && data.choices[0].message) {
                var m2 = data.choices[0].message;
                if (typeof m2.content === 'string') text2 = m2.content;
            }
            cb(null, text2.trim(), data);
        }).catch(function (e2) {
            // 两个都失败时，优先返回代理错误（更有参考价值）
            cb(err || formatApiNetworkError(e2, apiCfg && apiCfg.endpoint));
        });
    }, requestOptions);
}

// ── 获取模型列表（优先 ST /status 代理）──────────
export function fetchModelList(apiCfg, cb) {
    var ep = String((apiCfg && apiCfg.endpoint) || '').trim().replace(/\/+$/, '');
    // 和生成走同一套归一化，否则会出现「能生成、拉不到模型」
    var reverseProxy = normalizeReverseProxy(ep);

    // 先走酒馆服务端 status 代理
    ensureCsrf(getStRequestHeaders()).then(function (headers) {
        return fetchWithTimeout('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: JSON.stringify({
                chat_completion_source: 'openai',
                reverse_proxy: reverseProxy || ep,
                proxy_password: stripBearer(apiCfg && apiCfg.key)
            })
        }, 30000);
    }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + (t ? ': ' + String(t).slice(0, 120) : '')); });
        return r.json();
    }).then(function (data) {
        var models = [];
        var list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : (data && Array.isArray(data.models) ? data.models : []));
        (list || []).forEach(function (item) {
            var id = typeof item === 'string' ? item : (item && (item.id || item.name || item.model));
            if (id) models.push(String(id));
        });
        models = models.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
        models.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
        if (models.length === 0) {
            cb('接口未返回模型列表，请手动填写模型名称');
            return;
        }
        cb(null, models);
    }).catch(function (e) {
        if(!apiCfg.allowDirectFallback){cb(formatApiNetworkError(e,ep)+'；也可手动填写模型名称');return;}
        // Direct access is used only when enabled in the API settings.
        var url = normalizeEndpoint(apiCfg.endpoint, '/v1/models');
        fetchWithTimeout(url, {
            headers: { 'Authorization': 'Bearer ' + stripBearer(apiCfg && apiCfg.key) }
        }, 20000).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            var models = [];
            var list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : (data && Array.isArray(data.models) ? data.models : []));
            list.forEach(function (mm) { var id = typeof mm === 'string' ? mm : mm && (mm.id || mm.name || mm.model); if (id) models.push(String(id)); });
            models = Array.from(new Set(models));
            models.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
            if (!models.length) throw new Error(e.message || '无模型');
            cb(null, models);
        }).catch(function (e2) {
            cb(formatApiNetworkError(e, ep) || e2.message || String(e2));
        });
    });
}

// ── 模型选择弹窗 ─────────────────────────────────────────
export function openModelPicker(apiCfg, onSelect) {
    toast('正在获取模型列表…');
    fetchModelList(apiCfg, function (err, models) {
        if (err) { toast('获取失败：' + err, true); return; }
        if (!models || models.length === 0) { toast('未找到可用模型', true); return; }

        var _mp = getPopupLayer();
        var listHtml = models.map(function (m) {
            return '<div class="om-model-item" data-m="' + esc(m) + '" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(127,127,127,.08);font-size:.88em;transition:.12s;">' + esc(m) + '</div>';
        }).join('');

        var modal = document.createElement('div');
        modal.className = 'om-modal';
        modal.innerHTML = '<div class="om-modal-box" style="max-height:70vh;"><div class="om-modal-title">选择模型</div>' +
            '<input id="om-model-search" type="text" placeholder="搜索模型，或输入完整模型名称…" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.2);background:rgba(127,127,127,.08);color:inherit;font-size:.88em;font-family:inherit;" />' +
            '<div style="max-height:50vh;overflow-y:auto;border:1px solid rgba(127,127,127,.12);border-radius:8px;">' + listHtml + '</div>' +
            '<div class="om-btn-row"><button id="om-model-manual" class="om-btn om-btn-outline" disabled>使用输入的模型名</button><button id="om-model-cancel" class="om-btn om-btn-outline">取消</button></div></div>';
        mountPopup(modal, _mp);

        modal.addEventListener('click', function (e) { if (e.target === modal) _mp.removeChild(modal); });
        modal.querySelector('#om-model-cancel').addEventListener('click', function () { _mp.removeChild(modal); });

        modal.querySelector('#om-model-search').addEventListener('input', function () {
            var q = this.value.toLowerCase();
            modal.querySelector('#om-model-manual').disabled = !this.value.trim();
            modal.querySelectorAll('.om-model-item').forEach(function (item) {
                item.style.display = item.dataset.m.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
            });
        });
        modal.querySelector('#om-model-manual').onclick = function () {
            var value = modal.querySelector('#om-model-search').value.trim();
            if (value) { onSelect(value); if (modal.parentNode) modal.parentNode.removeChild(modal); }
        };
        setTimeout(function () { modal.querySelector('#om-model-search').focus(); }, 50);

        modal.querySelectorAll('.om-model-item').forEach(function (item) {
            item.addEventListener('mouseenter', function () { item.style.background = 'rgba(127,127,127,.12)'; });
            item.addEventListener('mouseleave', function () { item.style.background = ''; });
            item.addEventListener('click', function () {
                onSelect(item.dataset.m);
                if (modal.parentNode) _mp.removeChild(modal);
            });
        });
    });
}

// ── 解析 AI 返回的 JSON（容错：处理 markdown 代码块、提取 JSON）
function parseAIResponse(raw) {
    if (!raw || !raw.trim()) return null;
    var s = raw.trim();
    // 去掉 markdown 代码块
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    // 尝试直接解析
    try { var obj = JSON.parse(s); if (obj && typeof obj === 'object') return cleanParsed(obj); } catch (e) {}
    // 尝试提取第一个 { ... }
    var m = s.match(/\{[\s\S]*\}/);
    if (m) { try { var obj2 = JSON.parse(m[0]); if (obj2 && typeof obj2 === 'object') return cleanParsed(obj2); } catch (e2) {} }
    // JSON 解析全部失败：尝试把首行当 name，其余当 description
    var lines = s.split(/\n+/).filter(function (l) { return l.trim(); });
    if (lines.length >= 2 && lines[0].length <= 20 && !/[。；，:：()（）【】{}\[\]]/.test(lines[0]) && !/^(?:上装|下装|外套|内搭|裙裤|鞋袜|配饰|材质|颜色|后背)/.test(lines[0])) {
        return { name: lines[0].trim(), description: lines.slice(1).join('\n').trim() };
    }
    return null;
}

// 清理 AI 返回的 JSON：如果 description 开头就是 name，去掉重复
function cleanParsed(obj) {
    if (obj.name && obj.description) {
        var n = obj.name.trim();
        var d = obj.description.trim();
        // description 开头是 name（可能后面跟换行、逗号、句号、冒号等）
        if (d.indexOf(n) === 0) {
            d = d.slice(n.length).replace(/^[\s,，.。:：\-—\n]+/, '').trim();
            if (d) obj.description = d;
        }
    }
    return obj;
}

function getCategoryName(catObj) {
    return catObj && typeof catObj === 'object' ? (catObj.name || '') : (catObj || '');
}

function getCategoryChildren(catObj) {
    return catObj && typeof catObj === 'object' && Array.isArray(catObj.children) ? catObj.children : [];
}

function buildClassificationPrompt(categories) {
    var lines = [];
    (categories || []).forEach(function (catObj) {
        var name = getCategoryName(catObj);
        if (!name) return;
        var children = getCategoryChildren(catObj).filter(function (sc) { return !!sc; });
        lines.push('- ' + name + (children.length ? '（子类仅作参考：' + children.join(' / ') + '）' : ''));
    });
    var hasCats = lines.length > 0;
    return [
        '你是穿搭图片风格分类助手。只根据服装整体风格归类。',
        '【父分类 category 规则】',
        hasCats
            ? '必须从下面「现有风格分类」中选一个，category 必须与列表里的名称完全一致（逐字相同），禁止改写、拼接、翻译。'
            : '当前无分类，可新建一个简洁风格名（2-8字）。',
        '禁止返回「Lolita：王子风」「甜美-洛丽塔」这类组合名；有 Lolita 就只用「Lolita」。',
        '只有图片明确是洛丽塔/Lolita（定型裙、JSK/OP、多层裙撑、典型洛丽塔剪裁与配饰）才能选 Lolita；普通连衣裙、少女感、甜美、公主风 ≠ Lolita。',
        '不确定时选更宽泛的现有分类（如休闲、甜美），不要硬分到 Lolita。',
        hasCats ? '仅当现有分类全部明显不符时，才可新建风格名，并设 isNew=true。' : '',
        '【子分类 subCategory 规则】',
        '只能是「春夏」或「秋冬」；按厚薄/露肤/季节感判断，无法判断用「春夏」。不要把「王子风」等当作子分类。',
        '禁止返回空 category、未分类、unknown。',
        '只回复 JSON，不要代码块：{"category":"风格名","subCategory":"春夏或秋冬","confidence":0.0,"isNew":false}',
        '',
        hasCats ? ('现有风格分类：\n' + lines.join('\n')) : '现有风格分类：无'
    ].filter(Boolean).join('\n');
}

function buildCombinedDescriptionPrompt(descriptionPrompt, categories) {
    var lines = [];
    (categories || []).forEach(function (catObj) {
        var name = getCategoryName(catObj);
        if (!name) return;
        var children = getCategoryChildren(catObj).filter(function (sc) { return !!sc; });
        lines.push('- ' + name + (children.length ? '：' + children.join(' / ') : ''));
    });
    return [
        '请根据图片同时完成【穿搭描述】和【现有分类判断】。',
        '',
        '穿搭描述要求：',
        descriptionPrompt || '生成穿搭名称和服装描述。',
        '',
        '分类要求：只能从下面列出的现有分类和子分类中选择，不能新增、改写、翻译或猜造分类。category 必须是非空的现有父分类，禁止返回空字符串、null、无分类、未分类或 unknown。即使不确定，也必须选择最接近的父分类；只有 subCategory 可以为空字符串。',
        '',
        '只回复 JSON，不要代码块：{"name":"穿搭名称6字以内","description":"服装描述","category":"现有父分类","subCategory":"现有子分类或空字符串","confidence":0.0}',
        '',
        '现有分类：',
        lines.join('\n')
    ].join('\n');
}

function getDefaultClassification(categories) {
    var cats = categories || [];
    for (var i = 0; i < cats.length; i++) {
        var name = getCategoryName(cats[i]);
        if (name) return { category: name, subCategory: '', confidence: 0 };
    }
    return { category: '', subCategory: '', confidence: 0 };
}

function normalizeClassificationFallback(categories, fallback) {
    fallback = fallback || {};
    var wantedCat = (fallback.category || '').trim();
    var wantedSub = (fallback.subCategory || '').trim();
    var cats = categories || [];
    for (var i = 0; i < cats.length; i++) {
        var name = getCategoryName(cats[i]);
        if (name !== wantedCat) continue;
        var result = { category: name, subCategory: '', confidence: 0 };
        if (wantedSub && getCategoryChildren(cats[i]).indexOf(wantedSub) !== -1) result.subCategory = wantedSub;
        return result;
    }
    return getDefaultClassification(categories);
}

function matchExistingCategory(wanted, categories) {
    wanted = (wanted || '').trim();
    if (!wanted) return null;
    // 去掉冒号后的拼接后缀：Lolita：王子风 → Lolita
    var primary = wanted.split(/[：:]/)[0].trim();
    primary = primary.replace(/[\/\|·\-—_].*$/, '').trim() || primary;
    var cats = categories || [];
    var names = [];
    for (var i = 0; i < cats.length; i++) {
        var n = getCategoryName(cats[i]);
        if (n) names.push(n);
    }
    if (!names.length) return null;
    // 1. 完全一致
    for (var a = 0; a < names.length; a++) {
        if (names[a] === wanted || names[a] === primary) return names[a];
    }
    // 2. 忽略大小写
    var lowWanted = wanted.toLowerCase();
    var lowPrimary = primary.toLowerCase();
    for (var b = 0; b < names.length; b++) {
        var ln = names[b].toLowerCase();
        if (ln === lowWanted || ln === lowPrimary) return names[b];
    }
    // 3. 现有名是返回值的子串，或返回值是现有名的子串（取最长现有名）
    var best = null;
    var bestLen = 0;
    for (var c = 0; c < names.length; c++) {
        var nm = names[c];
        var lnm = nm.toLowerCase();
        if (lowWanted.indexOf(lnm) !== -1 || lowPrimary.indexOf(lnm) !== -1 || lnm.indexOf(lowPrimary) !== -1) {
            if (nm.length > bestLen) {
                best = nm;
                bestLen = nm.length;
            }
        }
    }
    return best;
}

function validateClassificationResult(parsed, categories, fallback, options) {
    options = options || {};
    var allowCreate = options.allowCreate !== false;
    var result = normalizeClassificationFallback(categories, fallback);
    result.isNewCategory = false;
    result.isNewSubCategory = false;
    if (!parsed || typeof parsed !== 'object') return result;

    var confidence = Number(parsed.confidence);
    if (!isFinite(confidence)) confidence = 0.5;
    if (confidence > 1) confidence = confidence / 100;
    if (confidence < 0) confidence = 0;
    if (confidence > 1) confidence = 1;

    var wantedCat = (parsed.category || parsed.cat || '').trim();
    var wantedSub = (parsed.subCategory || parsed.subcategory || parsed.sub || '').trim();
    // 过滤无效占位名
    if (/^(无分类|未分类|unknown|null|none|n\/a)$/i.test(wantedCat)) wantedCat = '';
    if (/^(无分类|未分类|unknown|null|none|n\/a)$/i.test(wantedSub)) wantedSub = '';
    // 子类若不是季节词，清掉（防止「王子风」进子类）
    if (wantedSub && wantedSub !== '春夏' && wantedSub !== '秋冬') {
        // 或许 AI 把拼接写在 sub 里，尝试并入 cat 再匹配
        if (!wantedCat) wantedCat = wantedSub;
        wantedSub = '';
    }
    if (!wantedCat && !wantedSub) return result;

    var cats = categories || [];
    // 强制对齐到现有分类名（Lolita：王子风 → Lolita）
    var matchedName = matchExistingCategory(wantedCat, cats);
    if (matchedName) {
        wantedCat = matchedName;
        result.category = matchedName;
        result.confidence = confidence;
        result.subCategory = normalizeSeasonSub(wantedSub);
        result.isNewCategory = false;
        result.isNewSubCategory = true;
        return result;
    }

    // 无匹配：仅当允许新建且置信度较高
    if (allowCreate && wantedCat && confidence >= 0.55) {
        // 再清一次拼接后缀，避免新建「Lolita：xxx」
        wantedCat = wantedCat.split(/[：:]/)[0].trim() || wantedCat;
        // 清理后再匹配一次
        matchedName = matchExistingCategory(wantedCat, cats);
        if (matchedName) {
            result.category = matchedName;
            result.confidence = confidence;
            result.subCategory = normalizeSeasonSub(wantedSub);
            result.isNewCategory = false;
            result.isNewSubCategory = true;
            return result;
        }
        result.category = wantedCat;
        result.subCategory = normalizeSeasonSub(wantedSub);
        result.confidence = confidence;
        result.isNewCategory = true;
        result.isNewSubCategory = true;
        return result;
    }

    // 回退默认分类
    result.subCategory = normalizeSeasonSub(result.subCategory);
    return result;
}

function normalizeSeasonSub(sub) {
    var s = (sub || '').trim();
    if (s === '春夏' || s === '秋冬') return s;
    if (/秋|冬|厚|毛衣|大衣|棉|呢/.test(s)) return '秋冬';
    if (/春|夏|薄|短袖|吊带|凉/.test(s)) return '春夏';
    // 默认春夏
    return '春夏';
}

/** 确保分区里存在指定分类/子分类，返回新建项列表 */
export function ensureCategoriesExist(part, category, subCategory) {
    var created = [];
    if (!part) return created;
    if (!Array.isArray(part.categories)) part.categories = [];
    var catName = (category || '').trim();
    if (!catName) return created;
    var subName = (subCategory || '').trim();

    var found = null;
    for (var i = 0; i < part.categories.length; i++) {
        var c = part.categories[i];
        var n = typeof c === 'object' ? c.name : c;
        if (n === catName) {
            found = c;
            break;
        }
    }
    if (!found) {
        found = { name: catName, children: [] };
        part.categories.push(found);
        created.push({ type: 'category', name: catName });
    } else if (typeof found === 'string') {
        // 旧扁平结构转对象
        var idx = part.categories.indexOf(found);
        found = { name: found, children: [] };
        part.categories[idx] = found;
    } else if (!Array.isArray(found.children)) {
        found.children = [];
    }
    if (subName && found.children.indexOf(subName) === -1) {
        found.children.push(subName);
        created.push({ type: 'subCategory', name: subName, parent: catName });
    }
    return created;
}

// ── 单次 Vision API 调用（优先 ST 服务端代理）──
export function callVisionAPI(apiCfg, image, systemPrompt, cb, requestOptions) {
    if (!image || !image.dataUrl || /^\/api\//.test(image.dataUrl)) { cb('图片未能读取，请检查图片后重试'); return; }
    var imgContent = /^(data:|https?:)/.test(image.dataUrl) ? image.dataUrl : 'data:image/jpeg;base64,' + image.dataUrl;
    var messages = [{
        role: 'user',
        content: [
            { type: 'image_url', image_url: { url: imgContent } },
            { type: 'text', text: systemPrompt || '请描述图中服装' }
        ]
    }];
    callChatCompletions(apiCfg, messages, 4096, function (err, text) {
        if (err) cb(err);
        else cb(null, text || '');
    }, requestOptions);
}

// ── 图片自动分类（可自动新建不合适时的分类）──────────────
export function classifyOutfitImage(apiCfg, image, categories, fallback, cb, options) {
    options = options || {};
    var allowCreate = options.allowCreate !== false;
    if (!apiCfg || !apiCfg.endpoint || !apiCfg.key || !apiCfg.model) {
        cb(null, fallback || { category: '', subCategory: '', isNewCategory: false });
        return;
    }
    if ((!Array.isArray(categories) || categories.length === 0) && !allowCreate) {
        cb(null, fallback || { category: '', subCategory: '', isNewCategory: false });
        return;
    }
    callVisionAPI(apiCfg, image, buildClassificationPrompt(categories || []), function (err, text) {
        if (err) { cb(err, fallback || { category: '', subCategory: '', isNewCategory: false }); return; }
        var parsed = parseAIResponse(text);
        var cls = validateClassificationResult(parsed, categories || [], fallback, { allowCreate: allowCreate });
        if (cls && cls.category) {
            cls.subCategory = normalizeSeasonSub(cls.subCategory);
        }
        cb(null, cls);
    });
}

function getClassificationFallback(categories, outfit) {
    return normalizeClassificationFallback(categories, outfit || {});
}

// ── 批量自动分类（后台队列，可自动新建分类）────────────────
export function batchClassifyOutfits(outfitIds, options, progressCb, doneCb) {
    if (typeof options === 'function') { doneCb = progressCb; progressCb = options; options = {}; }
    return runVisionBatch('classify', outfitIds, options || {}, progressCb, doneCb);
}

// ── 批量生成描述（并发队列）─────────────────────────────
export function batchGenerateDescriptions(outfitIds, options, progressCb, doneCb) {
    return runVisionBatch('description', outfitIds, options || {}, progressCb, doneCb);
}

// ── 批量生成单品描述（并发队列）──────────────────────────
export function batchGenerateAccDescriptions(accIds, options, progressCb, doneCb) {
    return runVisionBatch('accessory', accIds, options || {}, progressCb, doneCb);
}

// ── 单套描述生成（返回结构化数据）───────────────────────
export function generateSingleDescription(outfit, cb) {
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('请先在设置中配置描述API'); return; }
    if (!outfit.imageData) { cb('该穿搭没有图片'); return; }
    // server 模式下图片可能是后端 URL，外部 AI 无法访问，需要先 resolve 为 base64
    resolveImageForExternal(outfit.imageData, function (resolvedUrl) {
        callVisionAPI(apiCfg, { name: outfit.name, dataUrl: resolvedUrl }, apiCfg.prompt, function (err, text) {
            if (err) { cb(err); return; }
            var result; try { result = descriptionResult(text); } catch (error) { cb(error.message); return; } cb(null, result);
        });
    });
}

// ── 单个单品描述生成（返回结构化数据）────────────────────
export function generateSingleAccDescription(acc, cb) {
    var meta = loadMeta();
    var apiCfg = meta.apiVision;
    if (!apiCfg.endpoint || !apiCfg.key || !apiCfg.model) { cb('请先在设置中配置描述API'); return; }
    if (!acc.imageData) { cb('该单品没有图片'); return; }
    var prompt = (apiCfg.accPrompt || apiCfg.prompt || '')
        .replace(/\{\{accCategory\}\}/g, acc.category || '单品');
    resolveImageForExternal(acc.imageData, function (resolvedUrl) {
        callVisionAPI(apiCfg, { name: acc.name || '', dataUrl: resolvedUrl }, prompt, function (err, text) {
            if (err) { cb(err); return; }
            var result; try { result = descriptionResult(text); } catch (error) { cb(error.message); return; } cb(null, result);
        });
    });
}

function descriptionResult(text) {
    var parsed = parseAIResponse(text);
    var value = parsed ? parsed.description : (/^\s*(?:\{|\[|```)/.test(text || '') ? '' : text);
    if (typeof value !== 'string' || !value.trim()) throw new Error('未返回可用的服装描述，原有内容已保留');
    var paragraph=normalizeGarmentParagraph(value);
    if(!paragraph)throw new Error('未返回可用的服装描述，原有内容已保留');
    return { name: parsed && typeof parsed.name === 'string' ? parsed.name.trim() : '', description: paragraph };
}

async function performVisionTask(job, item, signal) {
    var part = await new Promise(function (resolve, reject) { ensurePartitionLoaded(job.partKey, function (value) { if (value) resolve(value); else reject(new Error('源衣柜无法载入')); }); });
    var target = (job.kind === 'accessory' ? part.accessories || [] : part.outfits || []).find(function (value) { return value.id === item.id; });
    if (!target || !target.imageData) throw new Error('条目已删除或没有图片');
    var before = { name: target.name || '', description: target.description || '', category: target.category || '', subCategory: target.subCategory || '' };
    var fingerprint = imageFingerprint(target.imageData);
    var image = await new Promise(function (resolve) { resolveImageForExternal(target.imageData, resolve); });
    if (signal.aborted) { var abort = new Error('请求已取消'); abort.name = 'AbortError'; throw abort; }
    var apiCfg = job.apiConfig, options = job.options || {}, categories = part.categories || [];
    var prompt = job.kind === 'classify' ? buildClassificationPrompt(categories) : job.kind === 'accessory'
        ? (apiCfg.accPrompt || apiCfg.prompt || '').replace(/\{\{accCategory\}\}/g, target.category || '单品')
        : options.autoClassify ? buildCombinedDescriptionPrompt(apiCfg.prompt, categories) : apiCfg.prompt;
    var text = await new Promise(function (resolve, reject) {
        callVisionAPI(apiCfg, { dataUrl: image }, prompt, function (error, value) { if (error) reject(new Error(error)); else resolve(value); }, { signal: signal });
    });
    if (!text || !text.trim()) throw new Error('API 返回了空内容');
    var parsed = parseAIResponse(text), changes = {};
    var overwrite = options.overwriteDescription !== undefined ? options.overwriteDescription : !!apiCfg.overwrite;
    if (job.kind !== 'classify' && (!before.description.trim() || overwrite)) {
        changes.description = descriptionResult(text).description;
        if (options.autoName && parsed && typeof parsed.name === 'string' && parsed.name.trim()) changes.name = parsed.name.trim();
    }
    if (job.kind === 'classify' || options.autoClassify) {
        var classification = validateClassificationResult(parsed, categories, getClassificationFallback(categories, target), { allowCreate: job.kind === 'classify' && options.allowCreate !== false });
        if (classification.category) {
            changes.category = classification.category;
            changes.subCategory = normalizeSeasonSub(classification.subCategory || '');
        } else if (job.kind === 'classify') throw new Error('未识别到可靠分类，原有内容已保留，可重试');
    }
    if (!Object.keys(changes).length) throw new Error('没有需要修改的内容');
    return { before: before, changes: changes, imageFingerprint: fingerprint, lowConfidence: !!classification && !(Number(classification.confidence) >= 0.55) };
}
registerVisionWorker(performVisionTask);
