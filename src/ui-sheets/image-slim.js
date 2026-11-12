// Outfit Manager · 二改版 | 图片瘦身的扫描、范围确认与任务进度
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { isServerMode, serverApi } from '../db/index.js';
import { esc, toast } from '../utils.js';
import { closeSheet, createSheet } from './sheet-base.js';

function fmtBytes(n) {
    if (!n || n <= 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function fmtDuration(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' 秒';
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ' 分' + (r ? ' ' + r + ' 秒' : '');
}

var KIND_LABEL = {
    OVERSIZED: '尺寸过大',
    PNG_PHOTO: 'PNG 存照片'
};

var POLL_MS = 600;

export function openImageSlimSheet() {
    if (!isServerMode()) {
        var s0 = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-compress"></i>图片瘦身</div>',
            '<div class="om-hint">图片瘦身需要服务端存储（图片以文件形式存在服务器上）。' +
            '当前是浏览器本地存储模式，图片本身就是 base64 存在 IndexedDB 里，没有可瘦身的文件。</div>'
        ].join(''), { modal: true, medium: true });
        return s0;
    }

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-compress"></i>图片瘦身</div>',
        '<div id="om-slim-body"><div class="om-hint">正在读取状态…</div></div>'
    ].join(''), { modal: true, medium: true });

    var body = sheet.querySelector('#om-slim-body');
    var timer = null;
    var dead = false;

    function stopPoll() {
        if (timer) { clearTimeout(timer); timer = null; }
    }

    function alive() {
        // 面板被关掉（节点脱离文档）就停止轮询。任务本身还在服务端继续跑。
        if (dead) return false;
        if (!sheet.parentNode) { dead = true; stopPoll(); return false; }
        return true;
    }

    function schedule() {
        stopPoll();
        timer = setTimeout(poll, POLL_MS);
    }

    function progressBar(pct) {
        var w = Math.max(2, Math.min(100, Math.round(pct)));
        return '<div style="height:6px;border-radius:3px;background:rgba(127,127,127,.22);overflow:hidden;margin:10px 0">' +
            '<div id="om-slim-bar" style="height:100%;width:' + w + '%;background:currentColor;opacity:.65;transition:width .3s"></div></div>';
    }

    function stageText(job) {
        if (job.stage === 'listing') return '正在列目录…';
        if (job.stage === 'probe') return '正在读取图片尺寸 ' + job.done + ' / ' + job.total;
        if (job.stage === 'analyze') {
            if (!job.candidatesTotal) return '正在筛选…';
            return '正在试算画质 ' + job.analyzed + ' / ' + job.candidatesTotal + '（已确认可瘦身 ' + job.found + ' 张）';
        }
        if (job.stage === 'write') return '正在生成新文件 ' + job.done + ' / ' + job.total;
        if (job.stage === 'rewrite') return '正在改写衣柜里的图片引用…';
        return '处理中…';
    }

    function stagePercent(job) {
        if (job.kind === 'apply') {
            if (job.stage === 'rewrite') return 96;
            if (!job.total) return 2;
            return Math.min(95, (job.done / job.total) * 95);
        }
        // 扫描分两段：读尺寸占前 45%，试算占后 55%
        if (job.stage === 'listing') return 1;
        if (job.stage === 'probe') return job.total ? (job.done / job.total) * 45 : 2;
        if (job.stage === 'analyze') {
            if (!job.candidatesTotal) return 99;
            return 45 + (job.analyzed / job.candidatesTotal) * 55;
        }
        return 99;
    }

    function etaText(job) {
        var done = job.stage === 'analyze' ? job.analyzed : job.done;
        var total = job.stage === 'analyze' ? job.candidatesTotal : job.total;
        if (!done || !total || done >= total) return '';
        var left = Math.round((job.elapsedMs / done) * (total - done));
        if (left < 1000) return '';
        return ' · 约还需 ' + fmtDuration(left);
    }

    var runningId = null;
    var cancelling = false;

    function renderRunning(job) {
        // 同一个任务：只更新数字，不重建 DOM。
        // 否则每 600ms 换一次按钮，用户正要点的「取消」会被换掉。
        if (runningId === job.id && body.querySelector('#om-slim-cancel')) {
            var st = body.querySelector('#om-slim-stage');
            if (st) st.textContent = stageText(job) + etaText(job);
            var bar = body.querySelector('#om-slim-bar');
            if (bar) bar.style.width = Math.max(2, Math.min(100, Math.round(stagePercent(job)))) + '%';
            var el = body.querySelector('#om-slim-elapsed');
            if (el) el.textContent = fmtDuration(job.elapsedMs);
            return;
        }
        runningId = job.id;
        cancelling = false;

        body.innerHTML =
            '<div class="om-health-issue">' +
            '<div class="om-health-issue-row"><span>' +
            (job.kind === 'apply' ? '正在瘦身' : '正在扫描图片') +
            '</span><div><span class="om-btn om-btn-outline" style="pointer-events:none" id="om-slim-elapsed">' +
            fmtDuration(job.elapsedMs) + '</span></div></div>' +
            '</div>' +
            progressBar(stagePercent(job)) +
            '<div class="om-hint" id="om-slim-stage">' + esc(stageText(job) + etaText(job)) + '</div>' +
            '<div class="om-btn-row" style="margin-top:12px;gap:8px">' +
            '<button type="button" class="om-btn om-btn-outline" id="om-slim-cancel">取消</button>' +
            '</div>' +
            '<div class="om-hint">' +
            (job.kind === 'apply'
                ? '瘦身在服务端跑，可以关掉这个面板去做别的，回来还能看进度。取消只会停在这里，已经写好的新文件不会断图。'
                : '扫描在服务端跑，可以关掉这个面板去做别的，回来还能看进度。取消会立刻停下。') +
            '</div>';

        var btn = body.querySelector('#om-slim-cancel');
        if (btn) btn.addEventListener('click', function () {
            if (cancelling) return;
            cancelling = true;
            btn.disabled = true;
            btn.textContent = '正在取消…';
            serverApi('/images/slim/cancel', 'POST', {}).catch(function () { /* 忽略 */ });
        });
    }

    // 后端插件是 2.1.1 或更早时没有 /images/slim/job、/images/slim/cancel，
    // 轮询会直接 404。这时候退回旧版「一个请求等到底」的同步流程，
    // 能干活但没有进度也不能取消 —— 总比卡在「出错了：HTTP 404」强。
    var legacy = false;

    function legacyBanner() {
        return '<div class="om-hint" style="padding:8px 10px;border-radius:8px;background:rgba(255,183,77,.12);' +
            'border:1px solid rgba(255,183,77,.35);color:#ffb74d;font-weight:600;margin-bottom:8px">' +
            '⚠️ 后端插件还是旧版（没有进度接口），现在是兼容模式：看不到进度，也不能取消。' +
            '把 Server 包更新到 2.1.2 并重启 SillyTavern，就能用上后台任务 + 进度条 + 取消。</div>';
    }

    function renderScan(report) {
        var list = report.candidates || [];
        var head = legacy ? legacyBanner() : '';
        if (!list.length) {
            body.innerHTML = head +
                '<div class="om-health-issue">' +
                '<div class="om-health-issue-row"><span>扫描了 ' + report.total + ' 张图</span><div>' +
                '<span class="om-btn om-btn-safe" style="pointer-events:none">无需瘦身</span></div></div>' +
                '</div>' +
                '<div class="om-hint">没有发现「明显浪费」的图。' +
                '判定标准是：长边超过 2000px，或者超过 900KB 却用 PNG 存照片。' +
                '低于这个范围的图不动——再压就要掉画质了。</div>' +
                '<div class="om-btn-row" style="margin-top:12px"><button type="button" class="om-btn om-btn-outline" id="om-slim-rescan">重新扫描</button></div>';
            bindRescan();
            return;
        }

        var rows = list.slice(0, 60).map(function (c) {
            return '<div class="om-health-issue-row"><span>' +
                esc(KIND_LABEL[c.kind] || c.kind) + ' · ' + c.width + '×' + c.height +
                '　' + fmtBytes(c.oldBytes) + ' → ' + fmtBytes(c.newBytes) +
                '　<em class="om-kitall-on">省 ' + Math.round(c.ratio * 100) + '%</em>' +
                '</span></div>';
        }).join('');

        body.innerHTML = head +
            '<div class="om-health-issue">' +
            '<div class="om-health-issue-row"><span>共 ' + report.total + ' 张图，' +
            list.length + ' 张可瘦身</span><div>' +
            '<span class="om-btn om-btn-safe" style="pointer-events:none">省 ' + fmtBytes(report.totalSaving) + '</span></div></div>' +
            rows +
            '</div>' +
            (list.length > 60 ? '<div class="om-hint">只列出前 60 张…</div>' : '') +
            (report.truncated
                ? '<div class="om-hint">这一轮只处理最大的 ' + list.length + ' 张，处理完再扫一次可以接着做剩下的。</div>'
                : '') +
            '<div class="om-btn-row" style="margin-top:12px;gap:8px;flex-wrap:wrap">' +
            '<button type="button" class="om-btn om-btn-safe" id="om-slim-run">立即瘦身（' + list.length + ' 张）</button>' +
            '<button type="button" class="om-btn om-btn-outline" id="om-slim-rescan">重新扫描</button>' +
            '</div>' +
            '<div class="om-hint">瘦身会生成新文件并改写引用，<b>旧图会保留</b>，' +
            '所以万一出问题还能回退。确认没问题后，再到「清理未引用图片」回收空间。' +
            '画质方面：长边缩到 1600（2 倍屏上仍然 1:1 以上）、JPEG 质量 94。' +
            (report.backend ? '　<span style="opacity:.65">引擎：' + esc(report.backend === 'magick' ? 'ImageMagick' : 'sharp') + '</span>' : '') +
            '</div>';

        var runBtn = body.querySelector('#om-slim-run');
        if (runBtn) runBtn.addEventListener('click', function () {
            runBtn.disabled = true;
            if (legacy) {
                // 旧后端：同步执行，等它跑完
                runBtn.textContent = '正在瘦身…（旧后端，别关页面）';
                serverApi('/images/slim', 'POST', { dryRun: false })
                    .then(function (res) {
                        if (!res || !res.ok) throw new Error('返回格式异常');
                        renderResult(res, null);
                    })
                    .catch(function (e) {
                        runBtn.disabled = false;
                        runBtn.textContent = '重试';
                        toast('瘦身失败：' + ((e && e.message) || '未知错误'));
                    });
                return;
            }
            runBtn.textContent = '正在启动…';
            serverApi('/images/slim', 'POST', { dryRun: false })
                .then(function (res) {
                    if (!res || !res.ok) throw new Error('返回格式异常');
                    poll();
                })
                .catch(function (e) {
                    runBtn.disabled = false;
                    runBtn.textContent = '重试';
                    toast('瘦身失败：' + ((e && e.message) || '未知错误'));
                });
        });
        bindRescan();
    }

    function bindRescan() {
        var b = body.querySelector('#om-slim-rescan');
        if (b) b.addEventListener('click', function () {
            b.disabled = true;
            b.textContent = '正在重新扫描…';
            startScan();
        });
    }

    function renderResult(res, job) {
        var changed = res.changed || 0;
        var rewritten = (res.rewritten || []).map(function (r) { return r.key + '（' + r.hits + ' 处）'; });
        var cancelled = job && job.state === 'cancelled';
        body.innerHTML =
            '<div class="om-health-issue">' +
            '<div class="om-health-issue-row"><span>已瘦身 ' + changed + ' 张' +
            (cancelled ? '（中途取消）' : '') + '</span><div>' +
            '<span class="om-btn om-btn-safe" style="pointer-events:none">省 ' + fmtBytes(res.saved) + '</span></div></div>' +
            (rewritten.length
                ? '<div class="om-health-issue-row"><span>改写了 ' + rewritten.length + ' 个衣柜的引用</span></div>' +
                  '<div class="om-hint">' + esc(rewritten.join('、')) + '</div>'
                : '') +
            '</div>' +
            '<div class="om-hint">' + esc(res.note || '') + '</div>' +
            '<div class="om-btn-row" style="margin-top:12px;gap:8px">' +
            '<button type="button" class="om-btn om-btn-outline" id="om-slim-close">完成</button>' +
            '</div>';
        var closeBtn = body.querySelector('#om-slim-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { closeSheet(sheet); });
        if (changed > 0) toast('瘦身完成，省出 ' + fmtBytes(res.saved));
    }

    function renderCancelled() {
        body.innerHTML =
            '<div class="om-hint">已取消，没有做任何改动。</div>' +
            '<div class="om-btn-row" style="margin-top:12px"><button type="button" class="om-btn om-btn-outline" id="om-slim-rescan">重新扫描</button></div>';
        bindRescan();
    }

    function renderError(msg, payload) {
        if (payload && payload.error === 'NO_SHARP') {
            var code = 'font-family:monospace;background:rgba(127,127,127,.12);padding:8px;border-radius:6px;margin:6px 0';
            body.innerHTML =
                '<div class="om-hint">后端还没装图片处理工具，无法生成缩略图/瘦身。装一个就行，二选一：</div>' +
                '<div class="om-hint" style="margin-top:10px"><b>① 电脑 / 服务器 / 小主机</b> —— 在 SillyTavern 根目录执行：</div>' +
                '<div class="om-hint" style="' + code + '">npm i sharp</div>' +
                '<div class="om-hint"><b>② 安卓 Termux</b>（手机上跑酒馆）—— 执行：</div>' +
                '<div class="om-hint" style="' + code + '">pkg install imagemagick</div>' +
                '<div class="om-hint" style="margin-top:8px">装完重启 SillyTavern 即可，两个的画质都经过调优，缩略图不会糊。' +
                '不装也没关系——扩展会自动退回「直接用原图」，功能一点不受影响，只是没有缩略图加速。</div>';
            return;
        }
        if (payload && payload.error === 'NO_SCAN') {
            body.innerHTML = '<div class="om-hint">扫描结果已经用过了，请重新扫描一遍。</div>' +
                '<div class="om-btn-row" style="margin-top:12px"><button type="button" class="om-btn om-btn-outline" id="om-slim-rescan">重新扫描</button></div>';
            bindRescan();
            return;
        }
        body.innerHTML = '<div class="om-hint">出错了：' + esc(msg || '未知错误') + '</div>' +
            '<div class="om-btn-row" style="margin-top:12px"><button type="button" class="om-btn om-btn-outline" id="om-slim-rescan">重新扫描</button></div>';
        bindRescan();
    }

    function startScan() {
        if (legacy) { startLegacyScan(); return; }
        serverApi('/images/slim', 'POST', { dryRun: true })
            .then(function (res) {
                if (!res || !res.ok) throw new Error('返回格式异常');
                // 老后端会把整份报告直接返回（同步），没有 jobId
                if (res.jobId) { poll(); return; }
                legacy = true;
                if (res.candidates) renderScan(res);
                else startLegacyScan();
            })
            .catch(function (e) {
                var payload = e && e.payload;
                if (e && e.status === 404) { legacy = true; startLegacyScan(); return; }
                if (payload && (payload.error === 'NO_SHARP' || payload.error === 'NO_SCAN')) {
                    renderError((e && e.message) || '', payload);
                } else {
                    renderError((e && e.message) || '无法启动扫描', payload);
                }
            });
    }

    function handleTerminal(job) {
        if (job.state === 'error') {
            if (job.error === 'RECOVERY_BUSY') {
                renderError('数据正在被其他操作占用（恢复/迁移中），等它完成再来。', null);
            } else {
                renderError(job.error || '任务失败', null);
            }
            return;
        }
        if (job.kind === 'apply') {
            if (job.result) renderResult(job.result, job);
            else renderCancelled();
            return;
        }
        // scan
        if (job.state === 'cancelled' || !job.report) { renderCancelled(); return; }
        renderScan(job.report);
    }

    function poll() {
        if (!alive()) return;
        serverApi('/images/slim/job', 'GET')
            .then(function (res) {
                if (!alive()) return;
                var job = res && res.job;
                if (!job) { startScan(); return; }
                if (job.state === 'running') { renderRunning(job); schedule(); return; }
                stopPoll();
                handleTerminal(job);
            })
            .catch(function (e) {
                if (!alive()) return;
                // 404 = 后端插件还是 2.1.1 或更早，没有这个接口。
                // 退回同步流程，别让人对着「出错了：HTTP 404」干瞪眼。
                if (e && e.status === 404) {
                    legacy = true;
                    startLegacyScan();
                    return;
                }
                renderError((e && e.message) || '无法读取进度', e && e.payload);
            });
    }

    function startLegacyScan() {
        body.innerHTML = legacyBanner() +
            '<div class="om-hint">正在扫描图片…</div>' +
            '<div class="om-hint">旧后端是同步扫描：几千张图可能要几分钟，' +
            '这段时间<b>看不到进度、也取消不了</b>，请先别关页面。</div>';
        serverApi('/images/slim', 'POST', { dryRun: true })
            .then(function (report) {
                if (!alive()) return;
                if (!report || !report.ok) throw new Error('返回格式异常');
                renderScan(report);
            })
            .catch(function (e) {
                if (!alive()) return;
                renderError((e && e.message) || '扫描失败', e && e.payload);
            });
    }

    // 进来先看有没有现成的任务：正在跑就接着看，跑完了就直接出结果，不用重新扫
    poll();
}
