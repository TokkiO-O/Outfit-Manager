// Outfit Manager · 二改版 | 兼容性检查与脱敏报告
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { collectCompatibilityReport, compatibilityStageLabel, compatibilityErrorLabel } from '../compatibility-check.js';
import { getCompatibilityRecord, startCompatibilityRecording, stopCompatibilityRecording, clearCompatibilityRecord, subscribeCompatibilityRecord } from '../compatibility-journal.js';
import { esc, toast } from '../utils.js';
import { createSheet, closeSheet } from './sheet-base.js';
import { saveCompatibilityBaseline, clearCompatibilityBaseline, compareCompatibilityBaseline } from '../compatibility-relations.js';

var labels = { pass: '通过', attention: '需关注', unknown: '无法判断' };
var relationLabels = { interference: '检测到测试干扰', related: '关联线索', observed: '本次透传正常', uncovered: '本次未覆盖', inactive: '已停用', self: '穿搭本体' };

function relationsHtml(report) {
    var related = report.relations || [], found = related.filter(function (item) { return ['interference', 'related', 'observed'].includes(item.status); });
    var blocks = related.filter(function (item) { return item.status === 'interference'; }).length;
    return '<div class="om-compat-relations"><h3>与穿搭的干扰检测</h3><p>' + (blocks ? '已定位 ' + blocks + ' 个组件在本次测试中的干扰行为。' : '本次尚未定位到具体组件的阻断行为。') + '</p><p class="om-hint">按实际请求、点击、样式和错误证据归属；“本次未覆盖”不表示无冲突。</p>' +
        found.map(function (item) {
            var status = item.status === 'observed' ? 'pass' : 'attention';
            return '<details class="om-compat-check" data-status="' + status + '"' + (item.status === 'interference' ? ' open' : '') + '><summary><span class="om-compat-badge">' + relationLabels[item.status] + '</span><strong>' + esc((item.scope === 'server-plugin' ? '后端插件 / ' : '') + item.id) + '</strong></summary><ul>' + item.evidence.map(function (evidence) {
                return '<li>' + esc(evidence.detail) + (evidence.file ? '<br><code>' + esc(evidence.file + (evidence.line ? ':' + evidence.line + ':' + evidence.column : '')) + '</code>' : '') + '</li>';
            }).join('') + '</ul></details>';
        }).join('') + '</div>';
}

function paintComparison(sheet, report) {
    var value = report.comparison, target = sheet.querySelector('#om-compat-comparison');
    if (!value.available) { target.textContent = value.persistence ? '尚未保存对照起点。' : '本机存储不可用，无法保留对照起点。'; }
    else {
        var changed = value.changes.map(function (item) { var check = report.checks.find(function (row) { return row.id === item.id; }); return esc((check ? check.title : item.id) + '：' + labels[item.before] + ' → ' + labels[item.after]); });
        target.innerHTML = '<p>对照起点：' + esc(new Date(value.savedAt).toLocaleString()) + '</p><p>停用／不再加载：' + esc(value.removed.join('、') || '无') + '<br>新增加载：' + esc(value.added.join('、') || '无') + '</p>' +
            (changed.length ? '<ul><li>' + changed.join('</li><li>') + '</li></ul>' : '<p>可对照的测试结果没有变化。</p>') +
            (value.candidate ? '<p><strong>对照线索：</strong>仅检测到 ' + esc(value.candidate) + ' 不再加载，至少一项异常恢复。支持关联，建议重新启用后复测；仍不能排除其他设置变化。</p>' : '') +
            (value.warnings.length ? '<p class="om-hint">' + value.warnings.map(esc).join(' ') + ' 不能据此唯一归因。</p>' : '');
    }
    sheet.querySelector('#om-compat-baseline-clear').disabled = !value.available;
}

function paintReport(target, report) {
    target.innerHTML = '<p class="om-compat-summary" role="status">通过 ' + report.summary.pass + ' · 需关注 ' + report.summary.attention + ' · 无法判断 ' + report.summary.unknown + '</p>' +
        '<p class="om-hint">“通过”只代表本次检测范围正常；“需关注”表示发现异常或风险，不等于已确认扩展冲突。</p>' +
        relationsHtml(report) + '<div class="om-compat-checks">' + report.checks.map(function (item) {
            return '<details class="om-compat-check" data-status="' + item.status + '"><summary><span class="om-compat-badge">' + labels[item.status] + '</span><strong>' + esc(item.title) + '</strong></summary><p>' + esc(item.detail) + '</p>' +
                (item.advice ? '<p class="om-hint">' + esc(item.advice) + '</p>' : '') + '</details>';
        }).join('') + '</div>' +
        '<details class="om-compat-extensions"><summary>已识别扩展（' + report.extensions.length + (report.inventoryComplete ? '' : '，清单可能不完整') + '）</summary>' +
        '<p class="om-hint">每个扩展只标记本次证据覆盖的关系，没有证据时不会标成“无冲突”。</p><ul>' + report.extensions.map(function (item) {
            var relation = (report.relations || []).find(function (entry) { return entry.scope === 'extension' && entry.id === item.id; });
            return '<li><span>' + esc(item.id) + '</span><small>' + esc(item.version || '版本未确认') + ' · ' + (item.enabled === false ? '已停用' : item.scriptLoaded ? '入口已加载' : '运行状态未确认') + ' · ' + esc(relationLabels[relation && relation.status] || '本次未覆盖') + '</small></li>';
        }).join('') + '</ul></details>';
}

function paintRecord(sheet) {
    if (!sheet.isConnected) return;
    var state = getCompatibilityRecord(), data = state.data, imported = data && data.import;
    var status = !data ? '未开启复现记录。' : { recording: '正在记录，10 分钟后自动停止。', stopped: '记录已手动停止。', expired: '记录已到时停止。', interrupted: '上次记录期间页面曾重新载入。' }[data.status];
    var text = status + (imported ? ' 上次导入：' + compatibilityStageLabel(imported.stage) + (imported.fileBytes ? ' · 文件约 ' + (imported.fileBytes / 1048576).toFixed(1) + ' MiB' : '') + (imported.category ? ' · ' + compatibilityErrorLabel(imported.category) : '') : '');
    if (!state.persistence) text += ' 当前记录未能写入本机存储，刷新后可能丢失。';
    sheet.querySelector('#om-compat-record-status').textContent = text;
    sheet.querySelector('#om-compat-record-start').hidden = state.active;
    sheet.querySelector('#om-compat-record-stop').hidden = !state.active;
    sheet.querySelector('#om-compat-record-clear').disabled = !data;
}

export function openCompatibilitySheet() {
    var controller = new AbortController(), unsubscribe, busy = false, report = null;
    var sheet = createSheet('<div class="om-sheet-title">兼容性检查</div><div class="om-compat-body">' +
        '<p>实际测试穿搭请求链、点击传递、样式及本地注入功能，按证据定位干扰来源。不调用模型 API，不自动停用扩展或修改衣柜。</p>' +
        '<div class="om-compat-actions"><button type="button" class="om-btn om-btn-safe" id="om-compat-run">开始检查</button><button type="button" class="om-btn om-btn-outline" id="om-compat-export" disabled>导出报告</button></div>' +
        '<p class="om-hint">报告包含扩展名称与版本、设备概况、检测结果和复现阶段；不包含衣服、图片、聊天正文、API 配置或原始错误正文。</p>' +
        '<details class="om-compat-record"><summary>复现记录（导入后刷新时使用）</summary><p class="om-hint">先开始记录，再关闭本窗口重做操作。重新打开酒馆后回到这里导出报告。记录只保留阶段、大小、内存估计和错误分类，不能确认刷新原因。</p>' +
        '<p id="om-compat-record-status" role="status"></p><div class="om-compat-actions"><button type="button" class="om-btn om-btn-outline" id="om-compat-record-start">开始记录（10 分钟）</button><button type="button" class="om-btn om-btn-outline" id="om-compat-record-stop" hidden>停止记录</button><button type="button" class="om-btn om-btn-outline" id="om-compat-record-clear">清除复现记录</button></div></details>' +
        '<details class="om-compat-record"><summary>停用前后对照排查</summary><p class="om-hint">先在异常状态保存对照起点。保留聊天后手动停用一个怀疑扩展并完整刷新，在相同主题与窗口下重新检测。这里不会替你停用或刷新。</p><div class="om-compat-actions"><button type="button" class="om-btn om-btn-outline" id="om-compat-baseline-save" disabled>保存本次为对照起点</button><button type="button" class="om-btn om-btn-outline" id="om-compat-baseline-clear" disabled>清除对照</button></div><div id="om-compat-comparison"></div></details>' +
        '<div id="om-compat-results" aria-live="polite"></div>' +
        '<div class="om-edit-foot"><button type="button" class="om-btn om-btn-outline" id="om-compat-close">关闭</button></div></div>',
    { modal: true, medium: true, onClose: function () { controller.abort(); if (unsubscribe) unsubscribe(); } });
    sheet.querySelector('.om-sheet').classList.add('om-compat-sheet');
    async function run() {
        if (busy) return null; busy = true;
        var button = sheet.querySelector('#om-compat-run'); button.setAttribute('aria-busy', 'true'); button.textContent = '正在检查…';
        sheet.querySelector('#om-compat-export').disabled = true;
        try {
            report = await collectCompatibilityReport({ signal: controller.signal, targetId: 'om-compat-run' });
            if (!sheet.isConnected || controller.signal.aborted) return null;
            paintReport(sheet.querySelector('#om-compat-results'), report); paintRecord(sheet); paintComparison(sheet, report);
            return report;
        } catch (error) {
            if (sheet.isConnected) sheet.querySelector('#om-compat-results').textContent = '本次检查没有完成，可重试或开启复现记录。';
            return null;
        } finally {
            busy = false;
            if (sheet.isConnected) { button.removeAttribute('aria-busy'); button.textContent = '重新检查'; sheet.querySelector('#om-compat-export').disabled = !report; sheet.querySelector('#om-compat-baseline-save').disabled = !report; }
        }
    }
    sheet.querySelector('#om-compat-run').onclick = run;
    sheet.querySelector('#om-compat-export').onclick = async function () {
        var value = await run(); if (!value || !sheet.isConnected) return;
        var url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a');
        link.href = url; link.download = 'outfit-compatibility-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
    };
    sheet.querySelector('#om-compat-record-start').onclick = function () { startCompatibilityRecording(); paintRecord(sheet); toast('已开启复现记录，现在可以关闭此窗口并重做出问题的操作。'); };
    sheet.querySelector('#om-compat-record-stop').onclick = function () { stopCompatibilityRecording(); paintRecord(sheet); };
    sheet.querySelector('#om-compat-record-clear').onclick = function () { clearCompatibilityRecord(); paintRecord(sheet); run(); };
    sheet.querySelector('#om-compat-close').onclick = function () { closeSheet(sheet); };
    sheet.querySelector('#om-compat-baseline-save').onclick = async function () { var value = await run(); if (!value) return; if (!saveCompatibilityBaseline(value)) { toast('对照起点未能保存，可先导出报告', true); return; } report.comparison = compareCompatibilityBaseline(report); paintComparison(sheet, report); toast('已保存对照起点；现在可手动停用一个扩展并完整刷新后再检测'); };
    sheet.querySelector('#om-compat-baseline-clear').onclick = function () { if (!clearCompatibilityBaseline()) { toast('清除对照失败', true); return; } if (report) { report.comparison = compareCompatibilityBaseline(report); paintComparison(sheet, report); } };
    unsubscribe = subscribeCompatibilityRecord(function () { paintRecord(sheet); });
    if (getCompatibilityRecord().data) sheet.querySelector('.om-compat-record').open = true;
    paintRecord(sheet); run();
    return sheet;
}
