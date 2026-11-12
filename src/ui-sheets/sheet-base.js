// Outfit Manager · 二改版 | 主题弹窗容器与关闭处理
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { ensureFullStyles } from '../styles/index.js';
import { getPopupLayer, mountPopup } from '../utils.js';

export function createSheet(contentHtml, opts) {
    ensureFullStyles();
    opts = opts || {};
    var ov = document.createElement('div');
    ov.className = 'om-sheet-overlay';
    var sizeCls = '';
    if (opts.modal) sizeCls += ' om-sheet-modal';
    if (opts.compact) sizeCls += ' om-sheet-compact';
    if (opts.medium) sizeCls += ' om-sheet-medium';
    ov.innerHTML = '<div class="om-sheet' + sizeCls + '"><div class="om-sheet-handle"></div><div class="om-sheet-content">' + contentHtml + '</div></div>';
    mountPopup(ov);
    ov._omOnClose = opts.onClose;
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(ov); });
    return ov;
}

export function closeSheet(ov) {
    if (ov && ov._omOnClose) { ov._omOnClose(); ov._omOnClose = null; }
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}

// ── 全屏 Lightbox（支持底部选择按钮）─────────────────────
// options: { showSelect: true } 显示选择/取消选择按钮（穿搭主体用）
