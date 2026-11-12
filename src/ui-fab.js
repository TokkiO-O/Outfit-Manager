// Outfit Manager · 二改版 | 侧栏入口、悬浮球及位置保存
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { load, loadMeta, saveMeta } from './db/index.js';
import { getById } from './data.js';
import { esc, compressImage } from './utils.js';
import { fn } from './bridge.js';

var SCRIPT_NAME = '穿搭管理';
var BTN_ID = 'outfit-mgr-ext-btn-v4';
var FAB_ID = 'om-fab-main';

// ── FAB（悬浮球）────────────────────────────────────────
var fabResizeHandler = null;

// 入口样式仅在值变化时更新，避免重复布局与绘制。
function setImp(el, prop, val, cache) {
    if (!el) return;
    if (cache[prop] === val) return;
    cache[prop] = val;
    el.style.setProperty(prop, val, 'important');
}

function clampFabElement(container, size) {
    if (!container) return false;
    var rect = container.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (vw <= 0 || vh <= 0) return false;
    // 无尺寸时仍强制放到默认位置，避免“入口消失”
    var left = Math.max(0, Math.min((rect.width ? rect.left : vw - 16 - size), vw - size));
    var top = Math.max(0, Math.min((rect.height ? rect.top : vh - 80 - size), vh - size));
    var cache = container._omClampCache || (container._omClampCache = {});
    setImp(container, 'left', left + 'px', cache);
    setImp(container, 'top', top + 'px', cache);
    setImp(container, 'position', 'fixed', cache);
    // 正常聊天页要能看见；其它扩展全屏弹窗时由 shouldHideFab 隐藏
    setImp(container, 'z-index', '5000', cache);
    setImp(container, 'opacity', '1', cache);
    // 显隐交给 syncFabVisibility，这里不强制 display
    if (typeof container._omSyncVis === 'function') {
        container._omSyncVis();
    } else {
        container._omHidden = null;
        setImp(container, 'display', 'flex', cache);
        setImp(container, 'visibility', 'visible', cache);
        setImp(container, 'pointer-events', 'none', cache);
    }
    var btn = container.querySelector('#om-fab-main-btn');
    if (btn) {
        var bCache = btn._omClampCache || (btn._omClampCache = {});
        setImp(btn, 'pointer-events', 'auto', bCache);
        setImp(btn, 'cursor', 'pointer', bCache);
        setImp(btn, 'display', 'block', bCache);
        setImp(btn, 'visibility', 'visible', bCache);
        setImp(btn, 'opacity', '1', bCache);
    }
    return true;
}

function fabNeedsRebuild(container) {
    if (!container || !container.parentNode) return true;
    var btn = container.querySelector('#om-fab-main-btn');
    if (!btn) return true;
    var cs = window.getComputedStyle ? window.getComputedStyle(container) : null;
    var bs = window.getComputedStyle ? window.getComputedStyle(btn) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return true;
    if (bs && (bs.display === 'none' || bs.visibility === 'hidden' || bs.opacity === '0')) return true;
    var rect = container.getBoundingClientRect();
    if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) return true;
    return false;
}

function injectFab() {
  try {
    var d = loadMeta() || {};
    var entryMode = d.entryMode || 'both';
    // 仅侧栏：不显示悬浮球
    if (entryMode === 'sidebar') {
        var existingOff = document.getElementById(FAB_ID);
        if (existingOff && existingOff.parentNode) existingOff.parentNode.removeChild(existingOff);
        return;
    }
    // showBall 仅在明确 false 时关闭；undefined 一律当开启（防止配置丢失）
    if (d.showBall === false && entryMode !== 'fab') {
        var existingOff2 = document.getElementById(FAB_ID);
        if (existingOff2 && existingOff2.parentNode) existingOff2.parentNode.removeChild(existingOff2);
        return;
    }
    // 纠正异常配置：entryMode=fab 时强制开球
    if (entryMode === 'fab' && d.showBall === false) {
        try { d.showBall = true; saveMeta(d); } catch (e0) {}
    }
    if (d.showBall !== true && d.showBall !== false) {
        try {
            d.showBall = true;
            if (!d.entryMode) d.entryMode = 'both';
            saveMeta(d);
        } catch (e) {}
    }
    var existing = document.getElementById(FAB_ID);
    if (existing) {
        var existingSize = d.fabSize || 38;
        if (!fabNeedsRebuild(existing) && clampFabElement(existing, existingSize)) return;
        if (existing.parentNode) existing.parentNode.removeChild(existing);
    }
    if (!document.body) return;
    var container = document.createElement('div'); container.id = FAB_ID;
    var MAIN_SIZE = d.fabSize || 38;
    var accent = 'linear-gradient(145deg,#f8c0d4 0%,#e8a0b4 50%,#c4b0e0 100%)';

    function posFab() {
        var vh = window.innerHeight || document.documentElement.clientHeight;
        var vw = window.innerWidth || document.documentElement.clientWidth;
        var dd = loadMeta();
        var mainTop, mainLeft;
        if (dd.fabPos && typeof dd.fabPos.top === 'number' && typeof dd.fabPos.left === 'number') {
            // 使用保存的位置，但约束在屏幕内
            mainTop = Math.max(0, Math.min(dd.fabPos.top, vh - MAIN_SIZE));
            mainLeft = Math.max(0, Math.min(dd.fabPos.left, vw - MAIN_SIZE));
        } else {
            // 默认位置：右下角
            mainTop = vh - 80 - MAIN_SIZE; mainLeft = vw - 16 - MAIN_SIZE;
            if (mainTop < 10) mainTop = 10; if (mainLeft < 10) mainLeft = 10;
        }
        container.setAttribute('style',
            'position:fixed !important;top:' + mainTop + 'px !important;left:' + mainLeft + 'px !important;' +
            'z-index:5000 !important;display:flex !important;align-items:center !important;' +
            'pointer-events:none !important;margin:0 !important;padding:0 !important;');
    }

    function isVisibleLayer(el) {
        if (!el) return false;
        var cs = window.getComputedStyle ? getComputedStyle(el) : null;
        if (!cs) return false;
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (parseFloat(cs.opacity || '1') < 0.05) return false;
        if (el.hasAttribute && el.hasAttribute('hidden')) return false;
        return true;
    }

    function isOwnOm(el) {
        if (!el) return true;
        if (el.id === FAB_ID || (el.closest && el.closest('#' + FAB_ID))) return true;
        if (el.id && String(el.id).indexOf('om-') === 0) return true;
        if (el.classList && (el.classList.contains('om-sheet') || el.classList.contains('om-modal') || el.classList.contains('om-overlay') || el.classList.contains('om-lightbox'))) return true;
        if (el.closest && el.closest('.om-overlay, .om-sheet, .om-modal, .om-lightbox, #om-popup-slot')) return true;
        return false;
    }

    function shouldHideFab() {
        // 只在「明确的全屏/模态层」打开时隐藏，不要把酒馆常驻 UI（TopBar、侧栏、扩展块）当成弹窗
        // 穿搭主界面
        if (document.querySelector('.om-overlay')) return true;

        // 酒馆确认弹窗（真正显示时才有尺寸）
        var modalIds = ['dialogue_popup', 'dialogue_popup_holder', 'shadow_popup', 'select_chat_popup', 'character_popup'];
        for (var s = 0; s < modalIds.length; s++) {
            var se = document.getElementById(modalIds[s]);
            if (!se || !isVisibleLayer(se)) continue;
            var sr = se.getBoundingClientRect();
            // 必须是居中大弹窗量级，避免空壳节点误伤
            if (sr.width > window.innerWidth * 0.25 && sr.height > window.innerHeight * 0.2) return true;
        }

        // 其它扩展的宿主容器：只有真正铺满屏幕时才藏
        var bbi = document.getElementById('bbi-app-host');
        if (bbi && isVisibleLayer(bbi)) {
            var br = bbi.getBoundingClientRect();
            if (br.width > window.innerWidth * 0.4 && br.height > window.innerHeight * 0.4) return true;
        }

        // 其它扩展：仅匹配明确的全屏 overlay / modal 类名，且几乎铺满屏幕
        var overlays = document.querySelectorAll(
            '.modal.show, .modal.in, .popup.active, [class*="fullscreen"], [class*="full-screen"]'
        );
        for (var i = 0; i < overlays.length; i++) {
            var el = overlays[i];
            if (isOwnOm(el) || !isVisibleLayer(el)) continue;
            var r = el.getBoundingClientRect();
            if (r.width > window.innerWidth * 0.6 && r.height > window.innerHeight * 0.5) return true;
        }
        return false;
    }

    function syncFabVisibility() {
        if (!container || !container.parentNode) return;
        // 弹窗遮挡状态变化时才更新悬浮球样式，避免观察器反复触发。
        var hide = shouldHideFab();
        if (container._omHidden === hide) return;
        container._omHidden = hide;
        var cache = container._omClampCache || (container._omClampCache = {});
        if (hide) {
            setImp(container, 'display', 'none', cache);
            setImp(container, 'visibility', 'hidden', cache);
            setImp(container, 'pointer-events', 'none', cache);
        } else {
            setImp(container, 'display', 'flex', cache);
            setImp(container, 'visibility', 'visible', cache);
            setImp(container, 'pointer-events', 'none', cache);
            var btn = container.querySelector('#om-fab-main-btn');
            if (btn) {
                var bCache = btn._omClampCache || (btn._omClampCache = {});
                setImp(btn, 'pointer-events', 'auto', bCache);
            }
        }
    }
    container._omSyncVis = syncFabVisibility;

    var mainBtn;
    if (d.fabImage) {
        mainBtn = document.createElement('img');
        mainBtn.src = d.fabImage;
        mainBtn.setAttribute('style',
            'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;' +
            'cursor:pointer !important;display:block !important;' +
            'pointer-events:auto !important;object-fit:contain !important;touch-action:none !important;' +
            'filter:drop-shadow(0 2px 6px rgba(0,0,0,.25)) !important;');
    } else {
        mainBtn = document.createElement('div');
        mainBtn.className = 'om-fab-logo';
        mainBtn.innerHTML =
            '<svg viewBox="0 0 56 56" width="' + Math.round(MAIN_SIZE * 0.78) + '" height="' + Math.round(MAIN_SIZE * 0.78) + '" style="pointer-events:none">' +
            '<path d="M28 12c0 0 0-2 2-2s2 1.4 1.1 2.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
            '<path d="M19 16.5h18" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M23 17c0 0 1 2.8 1.3 5.8.2 2-1.3 3.5-2.8 4.6-1.3.9-1.9 2.2-1.6 3.7.5 2.5 4 4.8 8.1 4.8s7.6-2.3 8.1-4.8c.3-1.5-.3-2.8-1.6-3.7-1.5-1.1-3-2.6-2.8-4.6.3-3 1.3-5.8 1.3-5.8" fill="#fff" opacity=".95"/>' +
            '<path d="M25.2 16c-1.8-1.2-3.4.2-2.6 1.8 1 2 3.1 1.5 3.7.3" fill="#ffe0ee"/>' +
            '<path d="M30.8 16c1.8-1.2 3.4.2 2.6 1.8-1 2-3.1 1.5-3.7.3" fill="#ffe0ee"/>' +
            '<circle cx="28" cy="16.8" r="1.5" fill="#ffd0e0"/>' +
            '</svg>' +
            '<span class="om-fab-sparkle" style="pointer-events:none">✦</span>' +
            '<span class="om-fab-sparkle om-fab-sparkle2" style="pointer-events:none">♡</span>';
        mainBtn.setAttribute('style',
            'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;border-radius:50% !important;' +
            'background:' + accent + ' !important;color:#fff !important;border:2.5px solid #fff !important;cursor:pointer !important;' +
            'display:flex !important;align-items:center !important;justify-content:center !important;position:relative !important;' +
            'box-shadow:0 4px 0 #d4849c,0 8px 18px rgba(232,160,180,.45) !important;opacity:1 !important;pointer-events:auto !important;' +
            'touch-action:none !important;');
    }

    mainBtn.id = 'om-fab-main-btn';
    container.appendChild(mainBtn);

    // 拖拽 + 点击判断
    var _dragState = { sx: 0, sy: 0, ox: 0, oy: 0, moved: false, handled: false };
    function startDrag(x, y) {
        var rect = container.getBoundingClientRect();
        _dragState.sx = x; _dragState.sy = y;
        _dragState.ox = rect.left; _dragState.oy = rect.top;
        _dragState.moved = false;
    }
    function moveDrag(x, y) {
        var dx = x - _dragState.sx, dy = y - _dragState.sy;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _dragState.moved = true;
        if (_dragState.moved) {
            var nx = Math.max(0, Math.min(_dragState.ox + dx, window.innerWidth - MAIN_SIZE));
            var ny = Math.max(0, Math.min(_dragState.oy + dy, window.innerHeight - MAIN_SIZE));
            container.style.setProperty('left', nx + 'px', 'important');
            container.style.setProperty('top', ny + 'px', 'important');
        }
    }
    function saveFabPos() {
        var rect = container.getBoundingClientRect();
        var dd = loadMeta();
        dd.fabPos = { top: Math.round(rect.top), left: Math.round(rect.left) };
        saveMeta(dd);
    }
    mainBtn.addEventListener('touchstart', function (e) {
        var t = e.touches[0];
        startDrag(t.clientX, t.clientY);
    }, { passive: true });
    mainBtn.addEventListener('touchmove', function (e) {
        var t = e.touches[0];
        moveDrag(t.clientX, t.clientY);
    }, { passive: true });
    mainBtn.addEventListener('touchend', function (e) {
        if (!_dragState.moved) {
            _dragState.handled = true;
            e.preventDefault();
            setTimeout(function () { fn.openPopup(); }, 50);
        } else {
            // 拖拽结束：保存位置
            saveFabPos();
        }
    });

    // PC 端：只在左键按下期间监听文档级移动/抬起，避免遗留永久监听器。
    mainBtn.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
        document.addEventListener('mousemove', mouseMove);
        document.addEventListener('mouseup', mouseUp);
    });
    function mouseMove(e) {
        moveDrag(e.clientX, e.clientY);
    }
    function mouseUp() {
        document.removeEventListener('mousemove', mouseMove);
        document.removeEventListener('mouseup', mouseUp);
        if (_dragState.moved) saveFabPos();
    }

    // 点击：触摸点击和拖拽后的合成 click 都只处理一次。
    mainBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (_dragState.handled) { _dragState.handled = false; return; }
        if (_dragState.moved) { _dragState.moved = false; return; }
        fn.openPopup();
    });

    posFab();
    if (fabResizeHandler) window.removeEventListener('resize', fabResizeHandler);
    fabResizeHandler = function () { posFab(); syncFabVisibility(); };
    window.addEventListener('resize', fabResizeHandler);
    document.body.appendChild(container);
    clampFabElement(container, MAIN_SIZE);
    syncFabVisibility();
    // DOM 变更先合并调度，再统一读取布局并更新入口显示状态。
    if (!window._omFabVisObs) {
        var visState = window._omFabVisState || (window._omFabVisState = { dirty: false, timer: 0, last: 0 });

        var runFabSync = function () {
            visState.timer = 0;
            if (!visState.dirty) return;
            visState.dirty = false;
            visState.last = Date.now();
            var fabEl = document.getElementById(FAB_ID);
            if (fabEl && typeof fabEl._omSyncVis === 'function') fabEl._omSyncVis();
        };

        window._omFabScheduleSync = function () {
            visState.dirty = true;
            if (visState.timer) return;
            var wait = 250 - (Date.now() - visState.last);
            visState.timer = setTimeout(runFabSync, wait > 0 ? wait : 0);
        };

        try {
            window._omFabVisObs = new MutationObserver(function () {
                window._omFabScheduleSync();
            });
            window._omFabVisObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
        } catch (obsErr) {}

        // 兜底：只做「有没有漏掉的变化 / 元素是否被移除」的廉价检查
        if (!window._omFabVisTimer) {
            window._omFabVisTimer = setInterval(function () {
                if (document.visibilityState === 'hidden') return;
                if (!document.getElementById(FAB_ID)) return;
                if (visState.dirty) runFabSync();
            }, 2000);
        }
    }
  } catch (err) {
    console.error('[outfit-manager] injectFab failed', err);
  }
}

function closeFab() { /* no-op, fab is now single button */ }

// ── 侧栏按钮 ──────────────────────────────────────────────
function getActiveNamesSafe() {
    try {
        var d = load();
        var ids = (d && Array.isArray(d.activeIds)) ? d.activeIds : [];
        var names = [];
        ids.forEach(function (id) {
            try {
                var o = getById(d, id);
                if (o && o.name) names.push(o.name);
            } catch (e) {}
        });
        return names;
    } catch (e2) {
        return [];
    }
}

function updateBtn() {
    var btn = document.getElementById(BTN_ID); if (!btn) return;
    var names = getActiveNamesSafe();
    var span = btn.querySelector('span');
    if (span) {
        if (names.length === 0) span.textContent = SCRIPT_NAME;
        else if (names.length === 1) span.textContent = names[0];
        else span.textContent = '衣柜(' + names.length + '套)';
    }
    btn.style.color = names.length > 0 ? 'var(--SmartThemeQuoteColor)' : '';
}

function findMenu() {
    var m = document.getElementById('extensionsMenu'); if (m) return m;
    m = document.getElementById('extensions_menu'); if (m) return m;
    m = document.querySelector('#extensionsMenu, #extensions_menu, .extensions_menu, #rm_extensions_block .list-group');
    if (m) return m;
    var items = document.querySelectorAll('.list-group-item.interactable, #extensionsMenu .list-group-item, .drawer-content .list-group-item');
    for (var i = 0; i < items.length; i++) {
        var tx = items[i].textContent || '';
        if (tx.indexOf('CSS') !== -1 || tx.indexOf('头像框') !== -1 || tx.indexOf('变量管理') !== -1 || tx.indexOf('Regex') !== -1) {
            return items[i].parentElement;
        }
    }
    return null;
}

function injectBtn() {
    try {
        var meta = loadMeta() || {};
        var entryMode = meta.entryMode || 'both';
        var existingBtn = document.getElementById(BTN_ID);
        // 仅悬浮球：去掉侧栏入口
        if (entryMode === 'fab') {
            if (existingBtn && existingBtn.parentNode) existingBtn.parentNode.removeChild(existingBtn);
            return;
        }
        if (existingBtn) {
            updateBtn();
            return;
        }
        var menu = findMenu();
        if (!menu) return;
        var names = getActiveNamesSafe();
        var btn = document.createElement('div');
        btn.id = BTN_ID;
        btn.className = 'list-group-item flex-container flexGap5 interactable';
        btn.title = SCRIPT_NAME;
        if (names.length > 0) btn.style.color = 'var(--SmartThemeQuoteColor)';
        btn.innerHTML = '<i class="fa-solid fa-shirt"></i><span>' + esc(names.length === 1 ? names[0] : names.length > 1 ? '衣柜(' + names.length + '套)' : SCRIPT_NAME) + '</span>';
        btn.addEventListener('click', function () {
            try { if (fn.openPopup) fn.openPopup(); } catch (e) { console.error('[outfit-manager] openPopup', e); }
        });
        menu.appendChild(btn);
    } catch (err) {
        console.error('[outfit-manager] injectBtn failed', err);
    }
}

// ── 导出 ─────────────────────────────────────────────────
export { FAB_ID, BTN_ID, injectFab, closeFab, updateBtn, injectBtn, findMenu };

export function registerFabFn() {
    fn.updateBtn = updateBtn;
    fn.injectBtn = injectBtn;
    fn.injectFab = injectFab;
}
