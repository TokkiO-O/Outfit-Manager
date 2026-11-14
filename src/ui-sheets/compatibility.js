// Outfit Manager · 二改版 | 兼容性检查与脱敏报告
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { collectCompatibilityReport, compatibilityStageLabel, compatibilityErrorLabel } from '../compatibility-check.js';
import { getCompatibilityRecord, startCompatibilityRecording, stopCompatibilityRecording, clearCompatibilityRecord, subscribeCompatibilityRecord } from '../compatibility-journal.js';
import { esc, toast } from '../utils.js';
import { createSheet, closeSheet } from './sheet-base.js';

var labels = { pass: '通过', attention: '需关注', unknown: '无法判断' };

function paintReport(target, report) {
    target.innerHTML = '<p class="om-compat-summary" role="status">通过 ' + report.summary.pass + ' · 需关注 ' + report.summary.attention + ' · 无法判断 ' + report.summary.unknown + '</p>' +
        '<p class="om-hint">“通过”只代表本次检测范围正常；“需关注”表示发现异常或风险，不等于已确认扩展冲突。</p>' +
        '<div class="om-compat-checks">' + report.checks.map(function (item) {
            return '<details class="om-compat-check" data-status="' + item.status + '"><summary><span class="om-compat-badge">' + labels[item.status] + '</span><strong>' + esc(item.title) + '</strong></summary><p>' + esc(item.detail) + '</p>' +
                (item.advice ? '<p class="om-hint">' + esc(item.advice) + '</p>' : '') + '</details>';
        }).join('') + '</div>' +
        '<details class="om-compat-extensions"><summary>已识别扩展（' + report.extensions.length + (report.inventoryComplete ? '' : '，清单可能不完整') + '）</summary>' +
        '<p class="om-hint">这里只展示清单与版本，不会因为安装了某扩展就判定冲突。</p><ul>' + report.extensions.map(function (item) {
            return '<li><span>' + esc(item.id) + '</span><small>' + esc(item.version || '版本未确认') + ' · ' + (item.enabled === false ? '已停用' : item.scriptLoaded ? '入口已加载' : '运行状态未确认') + '</small></li>';
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
        '<p>检查当前能验证的加载、存储、弹窗和请求处理问题。不调用模型 API，不自动停用扩展或修改衣柜。</p>' +
        '<div class="om-compat-actions"><button type="button" class="om-btn om-btn-safe" id="om-compat-run">开始检查</button><button type="button" class="om-btn om-btn-outline" id="om-compat-export" disabled>导出报告</button></div>' +
        '<p class="om-hint">报告包含扩展名称与版本、设备概况、检测结果和复现阶段；不包含衣服、图片、聊天正文、API 配置或原始错误正文。</p>' +
        '<details class="om-compat-record"><summary>复现记录（导入后刷新时使用）</summary><p class="om-hint">先开始记录，再关闭本窗口重做操作。重新打开酒馆后回到这里导出报告。记录只保留阶段、大小、内存估计和错误分类，不能确认刷新原因。</p>' +
        '<p id="om-compat-record-status" role="status"></p><div class="om-compat-actions"><button type="button" class="om-btn om-btn-outline" id="om-compat-record-start">开始记录（10 分钟）</button><button type="button" class="om-btn om-btn-outline" id="om-compat-record-stop" hidden>停止记录</button><button type="button" class="om-btn om-btn-outline" id="om-compat-record-clear">清除复现记录</button></div></details>' +
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
            paintReport(sheet.querySelector('#om-compat-results'), report); paintRecord(sheet);
            return report;
        } catch (error) {
            if (sheet.isConnected) sheet.querySelector('#om-compat-results').textContent = '本次检查没有完成，可重试或开启复现记录。';
            return null;
        } finally {
            busy = false;
            if (sheet.isConnected) { button.removeAttribute('aria-busy'); button.textContent = '重新检查'; sheet.querySelector('#om-compat-export').disabled = !report; }
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
    unsubscribe = subscribeCompatibilityRecord(function () { paintRecord(sheet); });
    if (getCompatibilityRecord().data) sheet.querySelector('.om-compat-record').open = true;
    paintRecord(sheet); run();
    return sheet;
}
