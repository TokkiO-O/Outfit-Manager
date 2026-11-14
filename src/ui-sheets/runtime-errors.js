// Outfit Manager · 二改版 | 运行错误日志查看与脱敏导出
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getRuntimeErrors, setRuntimeErrorsEnabled, clearRuntimeErrors, subscribeRuntimeErrors, runtimeErrorOperation, runtimeErrorSummary, exportRuntimeErrors } from '../runtime-errors.js';
import { esc, toast } from '../utils.js';
import { createSheet, closeSheet } from './sheet-base.js';

function date(value) { try { return new Date(value).toLocaleString(); } catch (ignored) { return '时间未确认'; } }
var kinds = { handled: '功能失败', uncaught: '脚本异常', rejection: '未处理的异步异常', resource: '资源加载失败' };
function rowKey(item) { return JSON.stringify([item.kind, item.operation, item.code, item.name, item.version, item.httpStatus, item.frames]); }

export function openRuntimeErrorsSheet() {
    var shown = 20, unsubscribe;
    var sheet = createSheet('<div class="om-sheet-title">运行错误日志</div><div class="om-compat-body om-runtime-log">' +
        '<label class="om-check"><input type="checkbox" id="om-runtime-enabled">自动记录穿搭运行错误</label>' +
        '<p class="om-hint">保留最近 7 天、最多 200 条；相同错误合并，频繁报错会限流。只保存错误分类和扩展内文件位置，不保留原始报错正文、API 配置或衣柜与聊天内容。</p>' +
        '<p id="om-runtime-status" role="status"></p>' +
        '<div class="om-compat-actions"><button type="button" class="om-btn om-btn-outline" id="om-runtime-export">导出日志</button><button type="button" class="om-btn om-btn-outline" id="om-runtime-clear">清空日志</button></div>' +
        '<label class="om-runtime-filter">查看范围 <select class="om-input" id="om-runtime-filter"><option value="all">全部</option><option value="import">导入</option><option value="save">保存</option><option value="load">读取衣柜</option><option value="api">API 与图片处理</option><option value="startup">启动与界面</option><option value="runtime">脚本运行</option></select></label>' +
        '<div id="om-runtime-list" class="om-compat-checks"></div><button type="button" class="om-btn om-btn-outline" id="om-runtime-more" hidden>再显示 20 条</button>' +
        '<p class="om-hint">从本版启动后开始记录，无法还原过去的错误。日志不能证明是哪个扩展造成，也无法保证在浏览器崩溃前写入。</p>' +
        '<div class="om-edit-foot"><button type="button" class="om-btn om-btn-outline" id="om-runtime-close">关闭</button></div></div>',
        { modal: true, medium: true, onClose: function () { if (unsubscribe) unsubscribe(); } });
    sheet.querySelector('.om-sheet').classList.add('om-compat-sheet');
    function render() {
        if (!sheet.isConnected) return;
        var state = getRuntimeErrors(), log = state.data, filter = sheet.querySelector('#om-runtime-filter').value;
        var groups = { all: null, api: ['api', 'models', 'description', 'vision'], startup: ['startup', 'interface'], runtime: ['runtime', 'injection'] }, wanted = Object.prototype.hasOwnProperty.call(groups, filter) ? groups[filter] : [filter];
        var entries = log.entries.slice().reverse().filter(function (item) { return !wanted || wanted.includes(item.operation); });
        var opened = new Set(Array.from(sheet.querySelectorAll('details[data-log-key][open]')).map(function (item) { return item.dataset.logKey; }));
        sheet.querySelector('#om-runtime-enabled').checked = log.enabled;
        sheet.querySelector('#om-runtime-status').textContent = (log.enabled ? '记录已开启' : '记录已暂停') + ' · 保留 ' + log.entries.length + ' 条 · 共 ' + log.entries.reduce(function (sum, item) { return sum + item.count; }, 0) + ' 次' +
            (log.suppressed ? ' · 频繁报错期间另省略 ' + log.suppressed + ' 次' : '') + (state.persistence ? '' : ' · 本机日志保存不可用，目前只能在本页查看或导出');
        sheet.querySelector('#om-runtime-list').innerHTML = entries.length ? entries.slice(0, shown).map(function (item) {
            var key = rowKey(item);
            return '<details class="om-compat-check" data-status="attention" data-log-key="' + esc(key) + '"' + (opened.has(key) ? ' open' : '') + '><summary><span><small>' + esc(date(item.lastAt)) + '</small><strong>' + esc(runtimeErrorOperation(item.operation) + ' · ' + runtimeErrorSummary(item)) + '</strong></span><span class="om-compat-badge">' + item.count + ' 次</span></summary>' +
                '<p>' + esc(kinds[item.kind] + ' · ' + item.name + ' · ' + item.code + ' · v' + (item.version || '未知')) + '</p><p class="om-hint">首次：' + esc(date(item.firstAt)) + '；最近：' + esc(date(item.lastAt)) + '</p>' +
                (item.frames.length ? '<ul class="om-runtime-frames">' + item.frames.map(function (frame) { return '<li><code>' + esc(frame.file + (frame.line ? ':' + frame.line + (frame.column ? ':' + frame.column : '') : '')) + '</code></li>'; }).join('') + '</ul>' : '<p class="om-hint">没有可归属的扩展内文件位置。</p>') + '</details>';
        }).join('') : '<p class="om-hint" id="om-runtime-empty">' + (filter === 'all' ? '暂无已记录的运行错误。' : '这个范围暂无错误。') + '</p>';
        sheet.querySelector('#om-runtime-more').hidden = entries.length <= shown;
        sheet.querySelector('#om-runtime-clear').disabled = !log.entries.length && !log.suppressed;
    }
    sheet.querySelector('#om-runtime-enabled').onchange = function () { setRuntimeErrorsEnabled(this.checked); render(); };
    sheet.querySelector('#om-runtime-filter').onchange = function () { shown = 20; render(); };
    sheet.querySelector('#om-runtime-more').onclick = function () { shown += 20; render(); };
    sheet.querySelector('#om-runtime-clear').onclick = function () { if (!confirm('清空运行错误日志？衣柜、设置和复现记录都会保留。')) return; clearRuntimeErrors(); shown = 20; render(); toast('运行错误日志已清空'); };
    sheet.querySelector('#om-runtime-export').onclick = function () {
        var value = exportRuntimeErrors(), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a');
        link.href = url; link.download = 'outfit-errors-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
    };
    sheet.querySelector('#om-runtime-close').onclick = function () { closeSheet(sheet); };
    unsubscribe = subscribeRuntimeErrors(render); render(); return sheet;
}
