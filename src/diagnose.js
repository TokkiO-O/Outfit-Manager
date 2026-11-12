// Outfit Manager · 二改版 | 手动性能诊断与样式统计
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getCacheStats, getStorageHealth } from './db/index.js';
import { fn } from './bridge.js';

function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function round(v) { return Math.round(v * 10) / 10; }

// 统计当前文档里的样式规则总数（美化 + 酒馆 + 扩展）
function countRules() {
    var n = 0;
    try {
        for (var i = 0; i < document.styleSheets.length; i++) {
            try { n += document.styleSheets[i].cssRules.length; } catch (e) { /* 跨域表读不到 */ }
        }
    } catch (e) {}
    return n;
}

// 按样式表来源统计规则数量，用于区分宿主、扩展和外部样式的开销。
function describeSheet(sheet, idx) {
    var owner = sheet.ownerNode;
    var kind = '美化';
    var label = '';
    var fullText = '';

    if (owner) {
        var tag = owner.tagName || '';
        if (tag === 'LINK') {
            label = '<link> ' + String(owner.href || '').split(/[?#]/)[0].split('/').slice(-2).join('/');
        } else if (tag === 'STYLE') {
            fullText = owner.textContent || '';
            var txt = fullText.replace(/\s+/g, ' ').trim();
            label = '<style> ' + (owner.id ? '#' + owner.id + ' ' : '') + (owner.id ? '' : '内联样式');
        }
    }
    if (!label) label = sheet.href ? String(sheet.href).split(/[?#]/)[0].split('/').slice(-2).join('/') : ('styleSheets[' + idx + ']');

    // 扩展自己的样式表有 .om-overlay / .om-grid 这种独有类名
    if (fullText.indexOf('.om-overlay') !== -1 || fullText.indexOf('.om-grid') !== -1) {
        kind = '扩展';
    } else if (fullText.indexOf('mes_text') !== -1 || fullText.indexOf('#chat') !== -1 ||
               /\/style\.css|\/script\.js|\/css\//.test(label)) {
        kind = '酒馆';
    } else if (sheet.href) {
        kind = '外部';
    }

    return { kind: kind, label: label };
}

export function auditStyleSheets() {
    var out = [];
    var sheets = document.styleSheets || [];
    for (var i = 0; i < sheets.length; i++) {
        var ss = sheets[i];
        var n = 0;
        var readable = true;
        try {
            n = ss.cssRules ? ss.cssRules.length : 0;
        } catch (e) {
            readable = false;   // 跨域样式表（CDN 字体等）读不到
        }
        var d = describeSheet(ss, i);
        out.push({ rules: n, kind: d.kind, label: d.label, readable: readable });
    }
    out.sort(function (a, b) { return b.rules - a.rules; });
    return out;
}

function styleAuditLines(limit) {
    var list = auditStyleSheets();
    if (!list.length) return ['样式来源 读不到（浏览器限制）'];
    var total = 0;
    var byKind = {};
    list.forEach(function (x) {
        total += x.rules;
        byKind[x.kind] = (byKind[x.kind] || 0) + x.rules;
    });

    var lines = [];
    var kindText = Object.keys(byKind).map(function (k) { return k + ' ' + byKind[k]; }).join(' · ');
    lines.push('样式来源 共 ' + total + ' 条（' + kindText + '）');

    var shown = 0;
    for (var i = 0; i < list.length && shown < (limit || 6); i++) {
        var x = list[i];
        if (!x.rules) continue;
        var pct = total ? Math.round((x.rules / total) * 100) : 0;
        lines.push('　' + String(x.rules).padStart(6) + ' 条 (' + String(pct).padStart(3) + '%)  ' +
            x.kind.padEnd(3, '　') + '  ' + x.label);
        shown++;
    }
    if (list.length > shown) lines.push('　…还有 ' + (list.length - shown) + ' 张样式表');

    var biggest = list[0];
    if (biggest && biggest.rules > 5000 && biggest.kind !== '扩展') {
        lines.push('　⚠ 最大的一张（' + biggest.rules + ' 条，' + biggest.kind + '）不是扩展带来的；' +
            '这一项的代价扩展没法替你消掉，只能靠换/减美化');
    }
    return lines;
}

// 聊天区流式渲染成本：追加 30 段文字，每次都强制一次布局（测完立刻删掉，不留痕迹）
function measureChatRender() {
    var box = document.querySelector('#chat .mes:last-child .mes_text') || document.querySelector('#chat .mes_text');
    if (!box) return null;
    var p = box.querySelector('p') || box;
    var times = [];
    var added = [];
    for (var i = 0; i < 30; i++) {
        var node = document.createTextNode('测');
        p.appendChild(node);
        added.push(node);
        var t0 = now();
        void document.body.offsetHeight;   // 强制同步布局，等同于滚动/读位置时的真实开销
        times.push(now() - t0);
    }
    for (var j = 0; j < added.length; j++) {
        if (added[j].parentNode) added[j].parentNode.removeChild(added[j]);
    }
    times.sort(function (a, b) { return a - b; });
    return {
        median: round(times[15]),
        p95: round(times[28]),
        total: round(times.reduce(function (s, v) { return s + v; }, 0))
    };
}

// 网格重绘成本：直接量 renderGrid 要多久（虚拟滚动后只重建可见的十几张）
//
// 为什么量两次：页面有两万条 CSS 规则时，「刚挂上新子树后的第一次布局」要把所有
// 规则重新建一次索引，实测能到 80~150ms。但这是一次性的——只有打开界面那一下会付，
// 之后滚动、筛选、换装走的是热路径（实测 4~10ms）。
// 只报冷数字会把「打开面板的一次性成本」误读成「滚动会卡」，所以两个都报。
function measureGridRender() {
    if (typeof fn.renderGrid !== 'function') return null;
    var area = document.getElementById('om-grid-area');
    if (!area) return { skipped: '界面未打开' };
    var t0 = now();
    try { fn.renderGrid(); } catch (e) { return { error: String(e && e.message) }; }
    var cold = now() - t0;
    var t1 = now();
    try { fn.renderGrid(); } catch (e2) {}
    var warm = now() - t1;
    return {
        cards: area.querySelectorAll('.om-card').length,
        nodes: area.querySelectorAll('*').length,
        virtual: !!area.querySelector('.om-grid.om-virt'),
        ms: round(warm),
        coldMs: round(cold)
    };
}

export function collectDiagnostics() {
    var st = {};
    try { st = getCacheStats(); } catch (e) {}
    var health = {};
    try { health = getStorageHealth() || {}; } catch (e) {}

    var chat = measureChatRender();
    var grid = measureGridRender();

    var imgs = document.querySelectorAll('.om-grid img, #om-grid-area img');
    var decoded = 0;
    var thumbed = 0;
    for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].complete && imgs[i].naturalWidth > 0) decoded++;
        var src = imgs[i].getAttribute('src') || '';
        if (src.indexOf('/images/thumb/') !== -1) thumbed++;
    }

    var mem = null;
    var memLimit = null;
    try {
        if (performance.memory) {
            mem = Math.round(performance.memory.usedJSHeapSize / 1048576);
            memLimit = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
        }
    } catch (e) {}

    var perf = (typeof window !== 'undefined' && window.__omPerf) ? window.__omPerf : {};

    var lines = [];
    lines.push('=== 穿搭管理器 性能自检 ===');
    lines.push('时间 ' + new Date().toLocaleString());
    lines.push('模式 ' + (health.serverMode ? '后端' : '本地') + ' · 启动耗时 ' + (perf.bootMs != null ? perf.bootMs + 'ms' : '未记录'));
    lines.push('数据 分包 ' + st.partitions + '/' + (st.knownPartitions || st.partitions) + ' 驻留' +
        ' · 内存中穿搭 ' + st.outfits + ' 套（带图 ' + st.images + ' 张） · 角色 ' + st.chars);
    var LAZY_REASON = {
        on: '按需载入',
        userOff: '你关掉了省内存开关',
        serverTransactions: '后端事务模式要求全量驻留，这个开关在这种模式下不生效',
        serverInitFailed: '后端初始化失败，已退回全量驻留'
    };
    if (st.lazy) {
        lines.push('衣柜内存 按需载入（只驻留当前衣柜 + 在穿的）');
    } else {
        lines.push('衣柜内存 全部常驻（' + (LAZY_REASON[st.lazyReason] || '未知原因') + '）');
    }
    var styleLines = styleAuditLines(6);
    for (var si = 0; si < styleLines.length; si++) lines.push(styleLines[si]);
    lines.push('节点 页面共 ' + document.getElementsByTagName('*').length + ' 个元素 · #chat 子项 ' +
        (document.getElementById('chat') ? document.getElementById('chat').children.length : 0));
    if (chat) {
        lines.push('聊天渲染 每段 ' + chat.median + 'ms（p95 ' + chat.p95 + 'ms，30 段共 ' + chat.total + 'ms）');
    } else {
        lines.push('聊天渲染 跳过（没找到聊天区）');
    }
    if (grid && grid.ms != null) {
        lines.push('网格重绘 ' + grid.ms + 'ms（滚动/筛选走这条）· 渲染 ' + grid.cards + ' 张卡 / ' + grid.nodes + ' 个节点' +
            (grid.virtual ? '（虚拟滚动，只渲染可见区）' : '（未启用虚拟滚动）'));
        if (grid.coldMs != null && grid.coldMs > grid.ms * 2) {
            lines.push('　首次 ' + grid.coldMs + 'ms（一次性：给页面 ' + countRules() + ' 条 CSS 规则重建索引，只付一次）');
        }
    } else if (grid && grid.skipped) {
        lines.push('网格重绘 跳过（' + grid.skipped + '）');
    }
    lines.push('图片 界面里 ' + imgs.length + ' 个 · 已解码 ' + decoded +
        (thumbed ? ' · 走缩略图 ' + thumbed + ' 张' : ' · 未使用缩略图'));
    lines.push('内存 JS 堆 ' + (mem != null
        ? mem + 'MB' + (memLimit ? ' / 上限 ' + memLimit + 'MB' : '') + '（含还没被回收的垃圾，仅供参考）'
        : '不可读'));
    lines.push('硬件 逻辑核 ' + (navigator.hardwareConcurrency || '?') +
        ' · 设备内存 ' + (navigator.deviceMemory || '?') + 'GB' +
        ' · ' + (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? '移动端' : '桌面端'));
    lines.push('UA ' + navigator.userAgent);
    return lines.join('\n');
}

// 可手动启用的长任务统计；默认启动流程不会启用。
export function installLongTaskProbe() {
    try {
        if (window.__omLongTaskInstalled || typeof PerformanceObserver === 'undefined') return;
        window.__omLongTaskInstalled = true;
        window.__omLongTasks = [];
        var obs = new PerformanceObserver(function (list) {
            var items = list.getEntries();
            for (var i = 0; i < items.length; i++) {
                window.__omLongTasks.push({ at: Math.round(items[i].startTime), ms: Math.round(items[i].duration) });
            }
            if (window.__omLongTasks.length > 200) window.__omLongTasks.splice(0, window.__omLongTasks.length - 200);
        });
        obs.observe({ entryTypes: ['longtask'] });
    } catch (e) {}
}

export function installDiagnostics() {

    try {
        window.__omDiag = function () {
            var text = collectDiagnostics();
            var tasks = (window.__omLongTasks || []).slice(-20);
            if (tasks.length) {
                var worst = tasks.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 5);
                text += '\n最近长任务（>50ms 才记录）共 ' + tasks.length + ' 个，最长的 5 个：' +
                    worst.map(function (t) { return t.ms + 'ms'; }).join(' / ');
            }
            console.log(text);
            return text;
        };

        // 完整样式表明细：卡的时候想知道「两万条规则是谁塞的」就跑这个
        window.__omCss = function () {
            var list = auditStyleSheets();
            var total = 0;
            list.forEach(function (x) { total += x.rules; });
            var lines = ['=== 样式表来源明细（共 ' + total + ' 条）==='];
            list.forEach(function (x, i) {
                if (!x.rules && !x.readable) {
                    lines.push(String(i + 1).padStart(3) + '. [读不到] ' + x.label);
                    return;
                }
                var pct = total ? Math.round((x.rules / total) * 100) : 0;
                lines.push(String(i + 1).padStart(3) + '. ' + String(x.rules).padStart(6) + ' 条 (' +
                    String(pct).padStart(3) + '%)  ' + x.kind + '  ' + x.label);
            });
            var text = lines.join('\n');
            console.log(text);
            return text;
        };
    } catch (e) {}
}
