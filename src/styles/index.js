// Outfit Manager · 二改版 | 按需加载主题与常驻入口样式
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { WORKSHOP_CSS } from './workshop.js';
// 全部 CSS 注入
//
// 性能：这份样式有 110KB+ / 880 多条规则。如果常驻页面，浏览器在重算样式时
// 每次都要把它们过一遍（实测：每条消息重渲染 +1.2ms、新消息上屏 +2.3ms，
// 而这部分样式平时一条都用不上，因为页面上根本没有 .om-* 元素）。
// 所以改成「按需注入」：启动只注入悬浮球那几条，第一次打开界面时才注入全量。
//
// 文件结构：
//   index.js       注入逻辑 + 悬浮球关键样式（启动即用）
//   base.js        基础布局与卡片
//   components.js  通用组件与响应式断点
//   themes.js      风格主题包

import { BASE_CSS } from './base.js';
import { COMPONENT_CSS } from './components.js';
import { THEME_CSS } from './themes.js';
import { FEATURE_CSS } from './features.js';
import { ATELIER_CSS } from './atelier.js';
import { REFINEMENT_CSS } from './refinements.js';

// 悬浮球关键样式使用一次性动画；完整主题仅在打开界面时加载。
var CRITICAL_CSS = [
    '.om-fab-sparkle{position:absolute;top:-2px;right:-2px;font-size:9px;color:#fff;text-shadow:0 0 4px rgba(255,255,255,.8);}',
    '.om-fab-sparkle2{position:absolute;bottom:2px;left:2px;font-size:9px;color:#ffd0e0;',
    'animation:om-sparkle-crit .8s ease-out both .12s;}',
    '@keyframes om-sparkle-crit{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.12)}100%{opacity:.85;transform:scale(1)}}'
].join('');

var fullStylesInjected = false;

function ensureStyleEl(id) {
    var el = document.getElementById(id);
    if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
    }
    return el;
}

// 启动时只注入悬浮球需要的几条
export function injectCriticalStyles() {
    ensureStyleEl('om-style-critical').textContent = CRITICAL_CSS;
}

// 第一次真正要用界面时才注入全量样式（只做一次）
export function ensureFullStyles() {
    if (fullStylesInjected) return;
    fullStylesInjected = true;
    injectStyles();
}

export function injectStyles() {
    var old = document.getElementById('om-style-v4');
    if (old) old.parentNode.removeChild(old);
    var s = document.createElement('style');
    s.id = 'om-style-v4';
        s.textContent = [BASE_CSS, COMPONENT_CSS, THEME_CSS, FEATURE_CSS, ATELIER_CSS, REFINEMENT_CSS, WORKSHOP_CSS].join('');
        document.head.appendChild(s);
    }
