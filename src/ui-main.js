// Outfit Manager · 二改版 | 主界面、分类栏、网格与底部操作
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { currentPresetLabel } from './preset-service.js';
import { decorateMainIcons } from './ui-icons.js';
import { getWardrobeMode, setWardrobeMode, applyChatContext, getWardrobeView } from './chat-state.js';
// 全屏弹窗、视角切换、分类栏、穿搭网格、底栏状态、详情面板
// v2: 使用分包存储 API (loadMeta/loadCurrent/saveCurrent/etc.)
//     角色管理仍经由兼容层 load()/save() 处理 charIndex ↔ charNames 翻译

import {
    load, save,
    loadMeta, saveMeta,
    loadCurrent,
    charNameById,
    charIdByName,
    currentPartKey,
    switchWardrobeView,
    isPartitionLoaded,
    ensurePartitionLoaded,
    maintainPartitionCache
} from './db/index.js';
import {
    SHARED_CHAR_KEY, SHARED_CHAR_LABEL,
    renameCharGroup, deleteCharGroup
} from './data.js';
import { esc, toast } from './utils.js';
import { ensureFullStyles } from './styles/index.js';
import { state, fn } from './bridge.js';
import { OM_VERSION } from './version.js';
import { DB } from './db/state.js';
import {
    preResolveActiveImages as preResolveOutfitActiveImages,
    resetOutfitsUiState, disconnectOutfitGridObserver,
    renderCatbar as renderOutfitCatbar,
    renderOutfitGrid,
    renderBottomStatus as renderOutfitBottomStatus,
    buildDetailGroups as buildOutfitDetailGroups,
    refreshDetailPanel as refreshOutfitDetailPanel,
    toggleDetailPanel as toggleOutfitDetailPanel,
    openDetailPanel as openOutfitDetailPanel,
    closeDetailPanel as closeOutfitDetailPanel,
    randomSelectOutfit,
    classifyAllUncategorized,
    recordWearHistory
} from './ui-outfits/index.js';
import {
    clearKitDraft as clearAccessoryKitDraft,
    isCurrentKitFocus as isCurrentAccessoryKitFocus,
    setKitFocus as setAccessoryKitFocus,
    ensureKitFocusForAccMode as ensureAccessoryKitFocusForAccMode,
    draftHasAcc as accessoryDraftHasAcc,
    toggleDraftAcc as toggleAccessoryDraftAcc,
    saveFocusedKitDraft as saveAccessoryFocusedKitDraft,
    toggleDisabledAcc as toggleAccessoryDisabledAcc,
    renderAccCatbar as renderAccessoryCatbar,
    renderAccGrid as renderAccessoryGrid
} from './ui-accessories.js';

function preResolveActiveImages() {
    return preResolveOutfitActiveImages();
}

var SCRIPT_NAME = '穿搭管理';

function clearKitDraft() {
    return clearAccessoryKitDraft();
}

function isCurrentKitFocus(partKey, outfitId) {
    return isCurrentAccessoryKitFocus(partKey, outfitId);
}

function setKitFocus(partKey, outfitId) {
    return setAccessoryKitFocus(partKey, outfitId);
}

function ensureKitFocusForAccMode(showToast) {
    return ensureAccessoryKitFocusForAccMode(showToast);
}

function draftHasAcc(accId) {
    return accessoryDraftHasAcc(accId);
}

function refreshDetailPanel() {
    return refreshOutfitDetailPanel();
}

function toggleDraftAcc(accId) {
    return toggleAccessoryDraftAcc(accId);
}

function saveFocusedKitDraft() {
    return saveAccessoryFocusedKitDraft();
}

function toggleDisabledAcc(partKey, outfitId, accId) {
    return toggleAccessoryDisabledAcc(partKey, outfitId, accId);
}

function applyUiPrefsToOverlay() {
    var ov = document.querySelector('.om-overlay');
    if (!ov) return;
    var m = loadMeta();
    var gridPrefs = JSON.stringify([m.uiTheme, m.gridCols, m.liteMode]);
    var gridPrefsChanged = ov._omGridPrefs != null && ov._omGridPrefs !== gridPrefs;
    ov._omGridPrefs = gridPrefs;
    var isDark = ov.classList.contains('om-dark');
    // 只切换主题相关 class，不要 ov.className= 整段覆盖（会丢掉 om-acc-mode 等状态 class，并触发大范围样式重算导致设置页/网格空白）
    ov.classList.add('om-overlay', 'om-ornate');
    ov.classList.toggle('om-dark', !!isDark);
    ov.classList.toggle('om-light', !isDark);
    ov.classList.toggle('om-lite', !!m.liteMode);
    var theme = m.uiTheme || 'sakura';
    var oldMap = { default:'sakura', rose:'sakura', matcha:'minimal', teal:'minimal', midnight:'y2k', violet:'y2k', mono:'minimal', cream:'minimal', amber:'minimal', gold:'minimal', salt:'y2k', ocean:'y2k' };
    if (oldMap[theme]) theme = oldMap[theme];
    ['sakura','y2k','dopamine','memphis','minimal'].forEach(function (th) {
        ov.classList.toggle('om-theme-' + th, th === theme);
    });
    ov.setAttribute('data-theme', theme);
    decorateMainIcons(ov, theme);
    // 角标符号随主题切换（樱粉花系只留在 sakura）
    var badgeMap = {
        sakura: ['♡','✦','✿','❀','★','✧'],
        y2k: ['★','✦','◆','◇','✧','★'],
        dopamine: ['★','●','♡','▲','✿','●'],
        memphis: ['▲','●','■','◆','★','▲'],
        minimal: []
    };
    var symbols = badgeMap[theme] || badgeMap.sakura;
    ov.querySelectorAll('.om-float-stickers .om-fs').forEach(function (el, i) { if (symbols.length) el.textContent = symbols[i % symbols.length]; });
    var badges = ov.querySelectorAll('.om-sticker-badge');
    badges.forEach(function (el, i) {
        if (theme === 'minimal') { el.style.display = 'none'; return; }
        el.style.display = '';
        // 文本由 CSS ::after 覆盖时仍写入，作无 ::after 主题的回退
        if (theme === 'sakura' && symbols[i % symbols.length]) {
            el.textContent = symbols[i % symbols.length];
        }
    });
    function hexMix(hex, light) {
        try {
            var h = String(hex).replace('#', '');
            if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
            var r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
            if (light > 0) {
                r = Math.min(255, Math.round(r + (255-r)*light));
                g = Math.min(255, Math.round(g + (255-g)*light));
                b = Math.min(255, Math.round(b + (255-b)*light));
            } else {
                r = Math.max(0, Math.round(r * (1+light)));
                g = Math.max(0, Math.round(g * (1+light)));
                b = Math.max(0, Math.round(b * (1+light)));
            }
            return '#' + [r,g,b].map(function(x){ var s=x.toString(16); return s.length<2?'0'+s:s; }).join('');
        } catch (e) { return hex; }
    }
    if (m.customAccent && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(m.customAccent)) {
        var c = m.customAccent;
        var hover = hexMix(c, 0.18);
        var active = hexMix(c, -0.12);
        ov.style.setProperty('--a-primary', c);
        ov.style.setProperty('--om-accent', c);
        ov.style.setProperty('--om-ac-primary', c);
        ov.style.setProperty('--om-ac-primary-hover', hover);
        ov.style.setProperty('--om-ac-primary-active', active);
        ov.style.setProperty('--om-btn-grad', 'linear-gradient(145deg,' + hover + ' 0%,' + c + ' 55%,' + active + ' 100%)');
        ov.style.setProperty('--om-ac-focus', hexMix(c, 0.35));
        ov.style.setProperty('--om-ac-shadow', hexMix(c, 0.25));
    } else {
        ['--a-primary','--om-accent','--om-ac-primary','--om-ac-primary-hover','--om-ac-primary-active','--om-btn-grad','--om-ac-focus','--om-ac-shadow'].forEach(function (k) {
            ov.style.removeProperty(k);
        });
    }
    // grid cols
    var gcols = parseInt(m.gridCols, 10) || 0;
    if (gcols >= 2 && gcols <= 6) {
        ov.style.setProperty('--om-grid-cols', String(gcols));
        ov.setAttribute('data-grid-cols', String(gcols));
    } else {
        ov.style.removeProperty('--om-grid-cols');
        ov.removeAttribute('data-grid-cols');
    }
    // 主题切换后卡片高度会变，虚拟网格必须重测，否则出现大片空白/幽灵格
    try {
        if (gridPrefsChanged) requestWardrobeRefresh();
    } catch (eV) {}
}

function filterActiveForCurrentMode() {
    return state.accMode
        ? (state.filterNoCat || state.filterNoDesc || state.filterFavorite)
        : (state.filterNoCat || state.filterNoTag || state.filterNoDesc || state.filterFavorite);
}

function updateSearchPlaceholder() {
    var inp = document.getElementById('om-search-inp');
    if (inp) inp.placeholder = state.accMode ? '搜索单品…' : '搜索穿搭…';
}


function syncAccToggleBtn(ov) {
    ov=ov||document.querySelector('.om-overlay');if(!ov)return;
    var btn=ov.querySelector('#om-acc-toggle'),wrap=ov.querySelector('#om-catbar-wrap'),accbar=ov.querySelector('#om-acc-catbar');
    if(!btn){btn=document.createElement('button');btn.type='button';btn.id='om-acc-toggle';btn.className='om-acc-toggle';btn.addEventListener('click',onAccToggleClick);}
    var target=state.accMode?'穿搭':'单品',icon=state.accMode?'shirt':'gem';
    btn.classList.toggle('open',!!state.accMode);btn.title='切换到'+target;btn.setAttribute('aria-label','切换到'+target);btn.setAttribute('aria-pressed',String(!!state.accMode));btn.setAttribute('data-icon',icon);
    btn.innerHTML='<i class="fa-solid fa-'+icon+'" aria-hidden="true"></i>';
    if(state.accMode&&accbar){var row=accbar.querySelector('.om-cat-row-main')||accbar;row.insertBefore(btn,row.firstChild);}else if(wrap&&btn.parentNode!==wrap)wrap.appendChild(btn);
    var presets=ov.querySelector('#om-bottom-presets');if(presets)presets.title='预设 · 本聊天使用「'+currentPresetLabel()+'」';
    decorateMainIcons(ov);
}
function onAccToggleClick(){setWardrobeBrowseMode(!state.accMode);}

function setWardrobeBrowseMode(accMode) {
    var ov = document.querySelector('.om-overlay');
    if (!ov) return;
    if(state.accMode===accMode){syncAccToggleBtn(ov);return;}
    state.accMode = accMode;
    state.batchMode = false;
    state.batchSelected = [];
    if (state.accMode) ensureKitFocusForAccMode(false);
    else clearKitDraft();
    try { ov.classList.toggle('om-acc-mode', !!state.accMode); } catch (e) {}
    updateBatchButtonState();
    updateSearchPlaceholder();
    updateFilterBarForMode();
    syncAccToggleBtn(ov);
    renderCatbar();
    renderAccCatbar();
    syncAccToggleBtn(ov);
    renderGrid();
    renderBottomStatus();
    if (state.accMode) {
        var groups = buildDetailGroups();
        if (groups.length > 0) openDetailPanel(groups);
    } else {
        closeDetailPanel();
    }
}

function updateFilterBarForMode() {
    var tagChip = document.getElementById('om-filter-notag');
    if (tagChip) tagChip.style.display = state.accMode ? 'none' : '';
    var fbtn = document.getElementById('om-filter-toggle');
    if (fbtn) fbtn.classList.toggle('om-filter-active', filterActiveForCurrentMode());
}

function updateBatchButtonState() {
    var btn = document.getElementById('om-batch-toggle');
    if (btn) {
        btn.classList.toggle('on', state.batchMode);
        btn.setAttribute('aria-pressed', String(!!state.batchMode));
        btn.title = state.batchMode ? '完成多选' : '多选';
        var label = btn.querySelector('span:not(.om-sticker-badge)');
        if (label) label.textContent = state.batchMode ? '完成' : '多选';
    }
}


// ── 打开全屏主界面 ────────────────────────────────────────
function openPopup() {
    if (document.querySelector('.om-overlay')) return;
    applyChatContext();
    var shield = document.createElement('div');
    shield.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;');
    shield.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    shield.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    document.body.appendChild(shield);
    setTimeout(function () { if (shield.parentNode) shield.parentNode.removeChild(shield); }, 400);

    ensureFullStyles();
    state.batchMode = false; state.batchSelected = []; state.searchQuery = ''; state.searchOpen = false; resetOutfitsUiState();
    state.catDrillParent = null; state.curSubCat = null;
    state.filterOpen = false; state.filterNoCat = false; state.filterNoTag = false; state.filterNoDesc = false; state.filterFavorite = false;
    state.accMode = false; state.accCat = '__all__'; state.accDrillParent = null; state.accSubCat = null;
    clearKitDraft();

    var meta = loadMeta();
    var isUser = meta.currentView !== 'char';

    var ov = document.createElement('div');
    var _th = meta.uiTheme || 'sakura';
    var _oldMap = { default:'sakura', rose:'sakura', matcha:'minimal', teal:'minimal', midnight:'y2k', violet:'y2k', mono:'minimal', cream:'minimal', amber:'minimal', gold:'minimal', salt:'y2k', ocean:'y2k' };
    if (_oldMap[_th]) _th = _oldMap[_th];
    var themeName = ' om-theme-' + _th;
    ov.className = 'om-overlay om-ornate ' + (state.darkMode ? 'om-dark' : 'om-light') + themeName;
    ov.setAttribute('style', 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;z-index:2147483647 !important;');
    var gcols = parseInt(meta.gridCols, 10) || 0;
    if (gcols >= 2 && gcols <= 6) {
        ov.style.setProperty('--om-grid-cols', String(gcols));
        ov.setAttribute('data-grid-cols', String(gcols));
    }

    ov.innerHTML =
        '<div class="om-box">' +
        '<div class="om-lace-edge om-lace-top" aria-hidden="true"></div>' +
        '<div class="om-lace-edge om-lace-bottom" aria-hidden="true"></div>' +
        '<div class="om-float-stickers" aria-hidden="true">' +
        '<span class="om-fs om-fs-1">♡</span><span class="om-fs om-fs-2">✦</span>' +
        '<span class="om-fs om-fs-3">✿</span><span class="om-fs om-fs-4">❀</span>' +
        '<span class="om-fs om-fs-5">✧</span><span class="om-fs om-fs-6">★</span>' +
        '<span class="om-fs om-fs-7">♡</span><span class="om-fs om-fs-8">✿</span>' +
        '</div>' +
        '<div class="om-head">' +
        '<div class="om-head-title">' +
        '<span class="om-logo" aria-hidden="true">' +
        '<svg class="om-logo-svg" viewBox="0 0 64 64" width="36" height="36">' +
        '<defs>' +
        '<linearGradient id="omLogoBg" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#ffe8f2"/><stop offset="50%" stop-color="#f5c4d8"/><stop offset="100%" stop-color="#e0c8f0"/>' +
        '</linearGradient>' +
        '<linearGradient id="omLogoRing" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#f0d0e0"/>' +
        '</linearGradient>' +
        '<linearGradient id="omLogoDress" x1="0.5" y1="0" x2="0.5" y2="1">' +
        '<stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#ffe6f0"/><stop offset="100%" stop-color="#f0b8d0"/>' +
        '</linearGradient>' +
        '<linearGradient id="omLogoGold" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#fff6e0"/><stop offset="100%" stop-color="#e8c890"/>' +
        '</linearGradient>' +
        '<filter id="omLogoSoft" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#c890a8" flood-opacity=".35"/>' +
        '</filter>' +
        '</defs>' +
        '<circle cx="32" cy="32" r="29" fill="url(#omLogoBg)" stroke="#fff" stroke-width="2.5" filter="url(#omLogoSoft)"/>' +
        '<circle cx="32" cy="32" r="25.5" fill="none" stroke="url(#omLogoRing)" stroke-width="1.6"/>' +
        '<circle cx="32" cy="32" r="22.5" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1" stroke-dasharray="2.2 2.8"/>' +
        '<path d="M32 12.5c0 0 .15-2.4 2.4-2.4 1.6 0 2.2 1.3 1.3 2.5" fill="none" stroke="url(#omLogoGold)" stroke-width="1.9" stroke-linecap="round"/>' +
        '<path d="M19 17.5h26" stroke="url(#omLogoGold)" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M21 17.8v2.2M43 17.8v2.2" stroke="#e8c890" stroke-width="1.5" stroke-linecap="round"/>' +
        '<path d="M24 20.2c.4 2.8.9 5.6 1.1 7.8.15 1.8-1.2 3.4-2.7 4.5-1.4 1-2.1 2.4-1.7 4 .7 3.1 4.8 6.2 11.3 6.2s10.6-3.1 11.3-6.2c.4-1.6-.3-3-1.7-4-1.5-1.1-2.85-2.7-2.7-4.5.2-2.2.7-5 1.1-7.8" fill="url(#omLogoDress)" stroke="#fff" stroke-width="1.35" stroke-linejoin="round"/>' +
        '<path d="M25.2 32.2c2.2 1.1 4.4 1.6 6.8 1.6s4.6-.5 6.8-1.6" fill="none" stroke="#f0b8c8" stroke-width="1.1" stroke-linecap="round" opacity=".85"/>' +
        '<path d="M27.2 19.2c-2.6-1.6-4.8.4-3.5 2.5 1.4 2.3 4.2 1.6 4.8.1" fill="#fff" stroke="#f0c0d0" stroke-width=".7"/>' +
        '<path d="M36.8 19.2c2.6-1.6 4.8.4 3.5 2.5-1.4 2.3-4.2 1.6-4.8.1" fill="#fff" stroke="#f0c0d0" stroke-width=".7"/>' +
        '<circle cx="32" cy="20.5" r="2.1" fill="#ffd6e6" stroke="#fff" stroke-width=".9"/>' +
        '<circle cx="32" cy="20.5" r=".7" fill="#e8a0b8"/>' +
        '<circle cx="11" cy="22" r="2.6" fill="#fffafc" stroke="#f0c0d0" stroke-width="1.1"/>' +
        '<circle cx="11" cy="22" r="1.05" fill="#e8a8c0"/>' +
        '<circle cx="53" cy="24" r="2.4" fill="#f8f0fc" stroke="#d8c0e8" stroke-width="1.1"/>' +
        '<circle cx="53" cy="24" r=".95" fill="#c8b0e0"/>' +
        '<circle cx="48" cy="46" r="1.9" fill="#ffe0ec"/>' +
        '<circle cx="15" cy="44" r="1.6" fill="#ebe0f5"/>' +
        '<circle cx="22" cy="50" r="1.2" fill="#ffd0e0"/>' +
        '<circle cx="42" cy="50" r="1.15" fill="#e8d8f5"/>' +
        '<path d="M46 14l.55 1.4 1.45.1-1.1.95.35 1.4L46 16.95l-1.25.9.35-1.4-1.1-.95 1.45-.1z" fill="#fff8e8"/>' +
        '<path d="M18 13.5l.4 1 1 .08-.75.65.25 1L18 15.6l-.9.63.25-1-.75-.65 1-.08z" fill="#fff"/>' +
        '</svg>' +
        '<span class="om-logo-sparkle">✦</span>' +
        '<span class="om-logo-sparkle om-logo-sparkle2">♡</span>' +
        '</span>' +
        '<span class="om-logo-text">' + SCRIPT_NAME + '</span>' +
        '<span class="om-logo-ribbon" aria-hidden="true">♡</span>' +
        '<span class="om-version">v' + esc(OM_VERSION) + '</span></div>' +
        '<div class="om-head-actions">' +
        '<button class="om-icon-btn om-sticker-btn" id="om-search-toggle" title="搜索"><i class="fa-solid fa-magnifying-glass"></i><span class="om-sticker-badge">♡</span></button>' +
        '<button class="om-icon-btn om-sticker-btn" id="om-filter-toggle" title="筛选"><i class="fa-solid fa-filter"></i><span class="om-sticker-badge">✦</span></button>' +
        '<button class="om-icon-btn om-sticker-btn" id="om-view-toggle" title="' + (isUser ? '切换到角色衣柜' : '切换到User衣柜') + '"><i class="fa-solid ' + (isUser ? 'fa-user' : 'fa-masks-theater') + '"></i><span class="om-sticker-badge">✿</span></button>' +
        '<button class="om-icon-btn om-sticker-btn" id="om-theme-toggle" title="主题"><i class="fa-solid fa-circle-half-stroke"></i><span class="om-sticker-badge">❀</span></button>' +
        '<button class="om-icon-btn om-sticker-btn" id="om-x" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
        '</div></div>' +

        '<div class="om-search-bar" id="om-search-bar">' +
        '<div class="om-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>' +
        '<input class="om-search-inp" id="om-search-inp" type="text" placeholder="搜索名称或标签…" autocomplete="off" /></div>' +
        '<button class="om-search-clear" id="om-search-clear" title="关闭搜索"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="om-filter-bar" id="om-filter-bar">' +
        '<button class="om-filter-chip" id="om-filter-fav"><i class="fa-solid fa-star"></i> 收藏</button>' +
        '<button class="om-filter-chip" id="om-filter-nocat">未分类</button>' +
        '<button class="om-filter-chip" id="om-filter-notag">无标签</button>' +
        '<button class="om-filter-chip" id="om-filter-nodesc">无描述</button>' +
        '<button class="om-filter-chip om-filter-action" id="om-filter-autoclass" title="选择图片分类范围并确认 API 用量"><i class="fa-solid fa-wand-magic-sparkles"></i> 分类</button>' +
        '<button class="om-filter-chip om-filter-action" id="om-filter-autotag" title="整理时代、风格与用途标签"><i class="fa-solid fa-tags"></i> 标签</button>' +
        '</div>' +
        '<div class="om-viewbar" id="om-viewbar"></div>' +
        '<div class="om-catbar-wrap" id="om-catbar-wrap">' +
        '<div class="om-catbar" id="om-catbar"></div>' +
        '<button type="button" class="om-acc-toggle" id="om-acc-toggle" title="切换到单品" aria-label="切换到单品" aria-pressed="false"><i class="fa-solid fa-gem" aria-hidden="true"></i></button>' +
        '</div>' +
        '<div class="om-acc-catbar" id="om-acc-catbar"></div>' +
        '<div class="om-batch-area" id="om-batch-area"></div>' +
        '<div class="om-grid-area" id="om-grid-area"></div>' +
        '<div class="om-bottombar" id="om-bottombar">' +
        '<div class="om-bottom-status" id="om-bottom-status"></div>' +
        '<div class="om-bottom-dock">' +
        '<button class="om-dock-btn om-sticker-btn" id="om-random-pick" title="随机"><i class="fa-solid fa-dice"></i><span>随机</span><span class="om-sticker-badge">★</span></button>' +
        '<button class="om-dock-btn om-sticker-btn" id="om-batch-toggle" title="多选"><i class="fa-solid fa-list-check"></i><span>多选</span><span class="om-sticker-badge">♡</span></button>' +
        '<button class="om-dock-btn om-dock-primary om-sticker-btn" id="om-bottom-add" title="添加"><i class="fa-solid fa-plus"></i><span class="om-sticker-badge om-sticker-badge-lg">✿</span></button>' +
        '<button class="om-dock-btn om-sticker-btn" id="om-bottom-presets" title="预设"><i class="fa-solid fa-bookmark"></i><span>预设</span><span class="om-sticker-badge">✦</span></button>' +
        '<button class="om-dock-btn om-sticker-btn" id="om-bottom-more" title="更多"><i class="fa-solid fa-ellipsis"></i><span>更多</span><span class="om-sticker-badge">❀</span></button>' +
        '</div></div>' +
        '<div class="om-more-sheet" id="om-more-sheet" hidden>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-chat-wardrobe-more"><i class="fa-solid fa-shirt"></i>本次穿搭<span class="om-sticker-badge">✧</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-scene-rec"><i class="fa-solid fa-lightbulb"></i>场景推荐<span class="om-sticker-badge">★</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-style-suggest-more"><i class="fa-solid fa-wand-magic-sparkles"></i>搭配建议<span class="om-sticker-badge">✦</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-all-kits-more"><i class="fa-solid fa-layer-group"></i>全部套装<span class="om-sticker-badge">★</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-tag-lexicon-more"><i class="fa-solid fa-tags"></i>标签词库<span class="om-sticker-badge">✧</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-wear-hist"><i class="fa-regular fa-calendar"></i>穿着历史<span class="om-sticker-badge">♡</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-action-undo"><i class="fa-solid fa-rotate-left"></i>操作撤销<span class="om-sticker-badge">↺</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-data-health-more"><i class="fa-solid fa-stethoscope"></i>数据体检<span class="om-sticker-badge">✿</span></button>' +
        '<button type="button" class="om-more-item om-sticker-btn" id="om-bottom-settings"><i class="fa-solid fa-sliders"></i>设置<span class="om-sticker-badge">❀</span></button>' +
        '</div>' +

        '</div>' +
        '<div id="om-popup-slot" style="position:absolute;inset:0;z-index:999;pointer-events:none;"></div>';

    decorateMainIcons(ov);
    document.body.appendChild(ov);
    if (typeof applyUiPrefsToOverlay === 'function') applyUiPrefsToOverlay();

    // 电脑端快捷键
    function omKeyHandler(e) {
        if (!document.querySelector('.om-overlay')) return;
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
        if (e.key === 'Escape') {
            if (document.getElementById('om-lightbox')) return;
            if (document.querySelector('.om-modal')) return;
            if (document.querySelector('.om-sheet-ov')) {
                var sh = document.querySelector('.om-sheet-ov');
                if (sh && sh.parentNode) sh.parentNode.removeChild(sh);
                return;
            }
            closePopup();
            return;
        }
        if (e.key === 'b' || e.key === 'B') {
            e.preventDefault();
            state.batchMode = !state.batchMode; state.batchSelected = [];
            updateBatchButtonState(); renderGrid();
            toast(state.batchMode ? '已进入多选' : '已退出多选');
        }
        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            randomSelectOutfit();
        }
    }
    document.addEventListener('keydown', omKeyHandler);
    ov._omKeyHandler = omKeyHandler;

    // 绑定顶栏
    ov.querySelector('#om-x').addEventListener('click', closePopup);
    ov.querySelector('#om-theme-toggle').addEventListener('click', function () {
        state.darkMode = !state.darkMode;
        var overlay = document.querySelector('.om-overlay');
        if (overlay) {
            overlay.classList.toggle('om-dark', state.darkMode);
            overlay.classList.toggle('om-light', !state.darkMode);
        }
        var btn = ov.querySelector('#om-theme-toggle');
        if (btn) btn.innerHTML = state.darkMode
            ? '<i class="fa-solid fa-circle-half-stroke"></i>'
            : '<i class="fa-regular fa-sun"></i>';
        if (btn) btn.insertAdjacentHTML('beforeend', '<span class="om-sticker-badge">✧</span>');
        decorateMainIcons(ov); applyUiPrefsToOverlay();
    });
    // 视角切换
    ov.querySelector('#om-view-toggle').addEventListener('click', function () {
        changeWardrobeView(getWardrobeView().kind === 'char' ? 'user' : 'char');
    });
    // 搜索
    ov.querySelector('#om-search-toggle').addEventListener('click', function () {
        state.searchOpen = !state.searchOpen;
        var bar = document.getElementById('om-search-bar');
        bar.classList.toggle('open', state.searchOpen);
        if (state.searchOpen) { setTimeout(function () { var i = document.getElementById('om-search-inp'); if (i) i.focus(); }, 50); }
        else { state.searchQuery = ''; renderGrid(); }
    });
    ov.querySelector('#om-search-clear').addEventListener('click', function () {
        state.searchOpen = false;
        state.searchQuery = '';
        var bar = document.getElementById('om-search-bar');
        bar.classList.remove('open');
        renderGrid();
    });
    var sinp = ov.querySelector('#om-search-inp');
    updateSearchPlaceholder();
    sinp.addEventListener('input', function () { state.searchQuery = sinp.value; renderGrid(); });
    sinp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { state.searchOpen = false; state.searchQuery = ''; ov.querySelector('#om-search-bar').classList.remove('open'); renderGrid(); } });
    // 筛选
    ov.querySelector('#om-filter-toggle').addEventListener('click', function () {
        state.filterOpen = !state.filterOpen;
        var fbar = document.getElementById('om-filter-bar');
        updateFilterBarForMode();
        fbar.classList.toggle('open', state.filterOpen);
    });
    function bindFilterChip(id, key) {
        ov.querySelector(id).addEventListener('click', function () {
            if (state.accMode && key === 'filterNoTag') return;
            state[key] = !state[key];
            // 与「标签待检查」互斥，避免空白列表困惑
            if (key !== 'filterThinTag') state.filterThinTag = false;
            this.classList.toggle('on', state[key]);
            updateFilterBarForMode();
            renderGrid();
        });
    }
    bindFilterChip('#om-filter-fav', 'filterFavorite');
    bindFilterChip('#om-filter-nocat', 'filterNoCat');
    bindFilterChip('#om-filter-notag', 'filterNoTag');
    bindFilterChip('#om-filter-nodesc', 'filterNoDesc');
    var autoClassChip = ov.querySelector('#om-filter-autoclass');
    if (autoClassChip) autoClassChip.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof classifyAllUncategorized === 'function') classifyAllUncategorized();
        else if (fn.classifyAllUncategorized) fn.classifyAllUncategorized();
    });
    var autoTagChip = ov.querySelector('#om-filter-autotag');
    if (autoTagChip) autoTagChip.addEventListener('click', function (e) {
        e.stopPropagation();
        if (fn.autoTagUntagged) fn.autoTagUntagged();
        else toast('自动标签功能未就绪', true);
    });
    var moreSheet = ov.querySelector('#om-more-sheet');
    ov.querySelector('#om-chat-wardrobe-more').addEventListener('click', function () {
        moreSheet.setAttribute('hidden', '');
        if (fn.openChatWardrobe) fn.openChatWardrobe();
    });
    ov.querySelector('#om-bottom-more').addEventListener('click', function (e) {
        e.stopPropagation();
        if (!moreSheet) return;
        var open = moreSheet.hasAttribute('hidden');
        if (open) moreSheet.removeAttribute('hidden');
        else moreSheet.setAttribute('hidden', '');
    });
    document.addEventListener('click', function moreClose(e) {
        if (!moreSheet || moreSheet.hasAttribute('hidden')) return;
        if (e.target.closest && (e.target.closest('#om-more-sheet') || e.target.closest('#om-bottom-more'))) return;
        moreSheet.setAttribute('hidden', '');
    });
    ov.querySelector('#om-scene-rec').addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openSceneRecommendSheet) fn.openSceneRecommendSheet();
    });
    ov.querySelector('#om-wear-hist').addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openWearHistorySheet) fn.openWearHistorySheet();
    });
    var sugMore = ov.querySelector('#om-style-suggest-more');
    if (sugMore) sugMore.addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openStyleSuggestSheet) fn.openStyleSuggestSheet();
    });
    var undoMore = ov.querySelector('#om-action-undo');
    if (undoMore) undoMore.addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openActionUndoSheet) fn.openActionUndoSheet();
        else toast('撤销功能未就绪', true);
    });
    var healthMore = ov.querySelector('#om-data-health-more');
    if (healthMore) healthMore.addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openDataHealthSheet) fn.openDataHealthSheet();
    });
    var perfCheck = ov.querySelector('#om-perf-check');
    if (perfCheck) perfCheck.addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openPerfSheet) fn.openPerfSheet();
    });
    var kitsMore = ov.querySelector('#om-all-kits-more');
    if (kitsMore) kitsMore.addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openAllKitsSheet) fn.openAllKitsSheet();
    });
    var tagMore = ov.querySelector('#om-tag-lexicon-more');
    if (tagMore) tagMore.addEventListener('click', function () {
        if (moreSheet) moreSheet.setAttribute('hidden', '');
        if (fn.openTagLexiconSheet) fn.openTagLexiconSheet();
    });
    var addBtn = ov.querySelector('#om-bottom-add');
    if (addBtn) addBtn.addEventListener('click', function () {
        if (state.accMode && fn.openAccEditSheet) fn.openAccEditSheet(null);
        else if (fn.openEditSheet) fn.openEditSheet(null);
    });

    // 绑定底栏
    ov.querySelector('#om-bottom-status').addEventListener('click', function (event) {
        if (event.target.closest('.om-status-mode')) {
            event.stopPropagation();
            var key = currentPartKey(), wardrobe = getWardrobeMode(key) !== 'wardrobe';
            setWardrobeMode(key, wardrobe ? 'wardrobe' : 'fixed');
            toast(wardrobe ? '已开启衣柜模式，直接点图增减备选；随正常回复选衣' : '已切换固定穿搭，点图替换，再点取消');
            return;
        }
        toggleDetailPanel();
    });
    ov.querySelector('#om-random-pick').addEventListener('click', function (e) {
        e.stopPropagation();
        randomSelectOutfit();
    });
    ov.querySelector('#om-batch-toggle').addEventListener('click', function () {
        state.batchMode = !state.batchMode; state.batchSelected = [];
        updateBatchButtonState();
        renderGrid();
    });
    ov.querySelector('#om-bottom-presets').addEventListener('click', function () { fn.openPresetsSheet(); });
    ov.querySelector('#om-bottom-settings').addEventListener('click', function () {
        var ms = document.getElementById('om-more-sheet');
        if (ms) ms.setAttribute('hidden', '');
        fn.openSettingsSheet();
    });

    // 单品/穿搭切换（按钮与分类栏同行）
    var accToggle = ov.querySelector('#om-acc-toggle');
    if (accToggle) accToggle.addEventListener('click', onAccToggleClick);
    syncAccToggleBtn(ov);

    renderViewbar();
    renderCatbar();
    renderGrid();
    renderBottomStatus();
}

function closePopup() {
    disconnectOutfitGridObserver();
    clearKitDraft();
    var ov = document.querySelector('.om-overlay'); if (ov) ov.parentNode.removeChild(ov);
}

// ── 视角切换栏渲染 ──────────────────────────────────────────
// 角色管理（添加/重命名/删除/收藏/分组）仍使用 load()/save() 兼容层
// 因为这些操作涉及 charNames ↔ charIndex 双向翻译，兼容层已处理
var charPanelExpanded = false;
var collapsedGroups = {};

function changeWardrobeView(kind, characterId) {
    switchWardrobeView(kind, characterId);
    applyChatContext();
    charPanelExpanded = false;
    state.curCat = '__all__'; state.catDrillParent = null; state.curSubCat = null;
    state.accCat = '__all__'; state.accDrillParent = null; state.accSubCat = null;
    state.batchMode = false; state.batchSelected = [];
    clearKitDraft(); closeDetailPanel();
    renderViewbar(); renderCatbar(); renderAccCatbar(); renderGrid(); renderBottomStatus();
}

function renderViewbar() {
    syncAccToggleBtn();
    updateBatchButtonState();
    updateFilterBarForMode();
    var vbar = document.getElementById('om-viewbar'); if (!vbar) return;
    var meta = loadMeta();
    var view = getWardrobeView(), isUser = view.kind !== 'char';
    var vBtn = document.getElementById('om-view-toggle');
    if (vBtn) {
        var icon = isUser ? 'fa-user' : 'fa-masks-theater';
        if (vBtn.dataset.view !== view.kind) {
            vBtn.innerHTML = '<i class="fa-solid ' + icon + '"></i><span class="om-sticker-badge">✧</span>';
            vBtn.dataset.view = view.kind;
            decorateMainIcons(vBtn.closest('.om-overlay'));
        }
        vBtn.title = isUser ? '切换到角色衣柜' : '切换到User衣柜';
        vBtn.setAttribute('aria-label', vBtn.title);
        vBtn.setAttribute('aria-pressed', String(!isUser));
    }
    vbar.style.position = 'relative';

    if (isUser) {
        vbar.style.display = 'none';
        return;
    }

    vbar.style.display = '';
    var currentCharName = '';
    if (view.characterId) {
        if (view.characterId === SHARED_CHAR_KEY) currentCharName = SHARED_CHAR_LABEL;
        else currentCharName = charNameById(view.characterId) || '';
    }
    var charLabel = currentCharName || '搜索角色…';

    var html = '<input type="text" class="om-char-input" id="om-char-input" placeholder="' + esc(charLabel) + '" autocomplete="off" />' +
        '<button class="om-char-add-btn" id="om-char-add" title="添加角色">+</button>';

    vbar.innerHTML = html;

    var inp = vbar.querySelector('#om-char-input');
    inp.addEventListener('focus', function () {
        charPanelExpanded = true;
        renderCharDropdown(vbar, load(), '');
    });
    inp.addEventListener('input', function () {
        charPanelExpanded = true;
        renderCharDropdown(vbar, load(), this.value.trim().toLowerCase());
    });
    vbar.querySelector('#om-char-add').addEventListener('click', function () { addCharPrompt(); });
    if (charPanelExpanded) renderCharDropdown(vbar, load(), '');
}

// renderCharDropdown 继续使用 load() 返回的旧格式（d.chars/d.charNames/d.charFavorites/d.charGroups）
// 因为角色管理操作（重命名/删除/分组/收藏）全部通过 save(d) 的兼容层处理 charIndex 翻译
function renderCharDropdown(vbar, d, query) {
    var old = vbar.querySelector('.om-char-dropdown');
    if (old) old.parentNode.removeChild(old);

    var favs = d.charFavorites || [];
    var groups = d.charGroups || {};
    var allNames = d.charNames || [];
    var matchedGroupKeys = {};
    if (query) { for (var gg in groups) { if (gg.toLowerCase().indexOf(query) !== -1) matchedGroupKeys[gg] = true; } }

    function visible(cn) {
        if (!query) return true;
        if (cn.toLowerCase().indexOf(query) !== -1) return true;
        for (var gg2 in matchedGroupKeys) { if ((groups[gg2] || []).indexOf(cn) !== -1) return true; }
        return false;
    }

    var inGroup = {};
    for (var gn in groups) { (groups[gn] || []).forEach(function (n) { inGroup[n] = true; }); }

    function makeRow(cn) {
        if (!visible(cn)) return '';
        var isFav = favs.indexOf(cn) !== -1;
        var isActive = d.currentChar === cn;
        var cd = d.chars && d.chars[cn] ? d.chars[cn] : { outfits: [] };
        var count = (cd.outfits || []).length;
        return '<div class="om-char-row' + (isActive ? ' active' : '') + '" data-cn="' + esc(cn) + '">' +
            '<i class="fa-' + (isFav ? 'solid' : 'regular') + ' fa-star om-char-star' + (isFav ? ' on' : '') + '" data-cn="' + esc(cn) + '"></i>' +
            '<span class="om-char-rname">' + esc(cn) + '</span>' +
            '<span class="om-char-count">' + count + '套</span>' +
            '<div class="om-char-actions">' +
            '<button class="om-char-act om-char-rename" data-cn="' + esc(cn) + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="om-char-act om-char-move-group" data-cn="' + esc(cn) + '" title="分组"><i class="fa-solid fa-folder"></i></button>' +
            '<button class="om-char-act om-char-delete" data-cn="' + esc(cn) + '" title="删除" style="color:#e57373"><i class="fa-solid fa-trash"></i></button>' +
            '</div></div>';
    }

    function makeSection(title, iconClass, names, gkey, managedGroupName) {
        var visNames = names.filter(visible);
        var isManaged = typeof managedGroupName === 'string';
        if (visNames.length === 0 && (!isManaged || (query && !matchedGroupKeys[managedGroupName]))) return '';
        var isCollapsed = collapsedGroups[gkey];
        var html = '<div class="om-char-group-hdr" data-gkey="' + esc(gkey) + '">' +
            '<i class="fa-solid fa-chevron-down om-g-arrow' + (isCollapsed ? ' collapsed' : '') + '"></i>' +
            '<i class="' + iconClass + ' om-g-icon"></i>' +
            '<span class="om-char-group-title">' + esc(title) + '</span>' +
            '<span class="om-char-group-count">(' + visNames.length + ')</span>' +
            (isManaged
                ? '<span class="om-char-group-actions">' +
                    '<button class="om-char-group-act om-char-group-rename" data-group="' + esc(managedGroupName) + '" title="重命名分组"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="om-char-group-act om-char-group-delete" data-group="' + esc(managedGroupName) + '" title="删除分组"><i class="fa-solid fa-trash"></i></button>' +
                  '</span>'
                : '') +
            '</div>';
        if (!isCollapsed) { visNames.forEach(function (cn) { html += makeRow(cn); }); }
        return html;
    }

    var listHtml = '';
    // 通用衣柜
    var sharedPartKey = 'char:' + SHARED_CHAR_KEY;
    var sharedCd = d.chars && d.chars[SHARED_CHAR_KEY] ? d.chars[SHARED_CHAR_KEY] : { outfits: [] };
    var sharedCount = (sharedCd.outfits || []).length;
    var sharedActive = d.currentChar === SHARED_CHAR_KEY;
    if (!query || SHARED_CHAR_LABEL.toLowerCase().indexOf(query) !== -1 || '通用'.indexOf(query) !== -1) {
        listHtml += '<div class="om-char-row' + (sharedActive ? ' active' : '') + '" data-cn="' + SHARED_CHAR_KEY + '" style="border-bottom:1px solid rgba(127,127,127,.1)">' +
            '<i class="fa-solid fa-globe om-char-star on" style="cursor:default"></i>' +
            '<span class="om-char-rname">' + SHARED_CHAR_LABEL + '</span>' +
            '<span class="om-char-count">' + sharedCount + '套</span>' +
            '<div class="om-char-actions"></div></div>';
    }
    var favNames = allNames.filter(function (n) { return favs.indexOf(n) !== -1; });
    listHtml += makeSection('收藏', 'fa-solid fa-star', favNames, '__fav__');
    for (var gn2 in groups) {
        var gNames = (groups[gn2] || []).filter(function (n) { return allNames.indexOf(n) !== -1; });
        listHtml += makeSection(gn2, 'fa-solid fa-folder', gNames, 'g_' + gn2, gn2);
    }
    var ungrouped = allNames.filter(function (n) { return !inGroup[n] && favs.indexOf(n) === -1; });
    if (ungrouped.length > 0) {
        var ugLabel = (favNames.length > 0 || Object.keys(groups).length > 0) ? '未分组' : '全部角色';
        listHtml += makeSection(ugLabel, 'fa-regular fa-folder-open', ungrouped, '__ungrouped__');
    }
    if (allNames.length === 0) listHtml += '<div class="om-char-empty">还没有角色，点 + 添加</div>';

    var dropdown = document.createElement('div');
    dropdown.className = 'om-char-dropdown';
    dropdown.innerHTML = listHtml;
    vbar.appendChild(dropdown);

    // 分组折叠
    dropdown.querySelectorAll('.om-char-group-hdr').forEach(function (hdr) {
        hdr.addEventListener('click', function () {
            collapsedGroups[hdr.dataset.gkey] = !collapsedGroups[hdr.dataset.gkey];
            renderCharDropdown(vbar, load(), query);
        });
    });
    // 自定义分组改名
    dropdown.querySelectorAll('.om-char-group-rename').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var oldName = btn.dataset.group;
            var newName = prompt('重命名分组「' + oldName + '」：', oldName);
            if (newName === null) return;
            var dd = load();
            var result = renameCharGroup(dd, oldName, newName);
            if (!result.ok) {
                if (result.code === 'GROUP_NAME_EXISTS') toast('分组「' + newName.trim() + '」已存在', true);
                else if (result.code !== 'GROUP_NAME_UNCHANGED') toast('分组名称不能为空或使用保留名称', true);
                return;
            }
            var oldCollapseKey = 'g_' + oldName;
            var newCollapseKey = 'g_' + result.newName;
            if (Object.prototype.hasOwnProperty.call(collapsedGroups, oldCollapseKey)) {
                collapsedGroups[newCollapseKey] = collapsedGroups[oldCollapseKey];
                delete collapsedGroups[oldCollapseKey];
            }
            save(dd);
            renderCharDropdown(vbar, load(), query);
            toast('分组已重命名为「' + result.newName + '」');
        });
    });
    // 自定义分组删除：1 仅解散；2 连同组内角色衣柜删除
    dropdown.querySelectorAll('.om-char-group-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var groupName = btn.dataset.group;
            var dd = load();
            var memberSeen = Object.create(null);
            var members = dd.charGroups && Array.isArray(dd.charGroups[groupName])
                ? dd.charGroups[groupName].filter(function (name) {
                    if ((dd.charNames || []).indexOf(name) === -1 || memberSeen[name]) return false;
                    memberSeen[name] = true;
                    return true;
                })
                : [];
            var choice = prompt(
                '删除分组「' + groupName + '」（' + members.length + ' 个角色）：\n' +
                '1. 仅解散分组，保留角色衣柜\n' +
                '2. 删除分组及组内所有角色衣柜\n\n请输入 1 或 2：',
                '1'
            );
            if (choice === null) return;
            choice = choice.trim();
            if (choice !== '1' && choice !== '2') { toast('请输入 1 或 2', true); return; }
            var removeWardrobes = choice === '2';
            if (removeWardrobes) {
                var preview = members.slice(0, 8).join('、') + (members.length > 8 ? ' 等' : '');
                if (!confirm('确定删除分组「' + groupName + '」及组内所有角色衣柜？' + (preview ? '\n将删除：' + preview : '') + '\n此操作不可撤销。')) return;
            }
            var result = deleteCharGroup(dd, groupName, removeWardrobes);
            if (!result.ok) { toast('分组不存在或已被删除', true); return; }
            delete collapsedGroups['g_' + groupName];
            save(dd);
            renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
            toast(removeWardrobes
                ? '已删除分组及 ' + result.deletedNames.length + ' 个角色衣柜'
                : '已解散分组「' + groupName + '」，角色衣柜已保留');
        });
    });
    // 选中角色
    dropdown.querySelectorAll('.om-char-row').forEach(function (row) {
        row.addEventListener('click', function (e) {
            if (e.target.closest('.om-char-star') || e.target.closest('.om-char-actions')) return;
            var id = row.dataset.cn === SHARED_CHAR_KEY ? SHARED_CHAR_KEY : charIdByName(row.dataset.cn);
            if (!id) { toast('这个角色衣柜已不存在，请重新选择', true); return; }
            changeWardrobeView('char', id);
        });
    });
    // 收藏
    dropdown.querySelectorAll('.om-char-star').forEach(function (star) {
        star.addEventListener('click', function (e) {
            e.stopPropagation();
            var dd = load(); if (!dd.charFavorites) dd.charFavorites = [];
            var cn = star.dataset.cn; var idx = dd.charFavorites.indexOf(cn);
            if (idx !== -1) dd.charFavorites.splice(idx, 1); else dd.charFavorites.push(cn);
            save(dd); renderCharDropdown(vbar, load(), query);
        });
    });
    // 重命名
    dropdown.querySelectorAll('.om-char-rename').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation(); var cn = btn.dataset.cn;
            var nw = prompt('重命名角色「' + cn + '」：', cn);
            if (!nw || !nw.trim() || nw.trim() === cn) return; nw = nw.trim();
            var dd = load();
            if (dd.charNames.indexOf(nw) !== -1) { toast('角色「' + nw + '」已存在', true); return; }
            var idx = dd.charNames.indexOf(cn); if (idx !== -1) dd.charNames[idx] = nw;
            if (dd.chars && dd.chars[cn]) { dd.chars[nw] = dd.chars[cn]; delete dd.chars[cn]; }
            if (dd.charFavorites) { var fi = dd.charFavorites.indexOf(cn); if (fi !== -1) dd.charFavorites[fi] = nw; }
            if (dd.charGroups) { for (var g in dd.charGroups) { var gi = dd.charGroups[g].indexOf(cn); if (gi !== -1) dd.charGroups[g][gi] = nw; } }
            if (dd.currentChar === cn) dd.currentChar = nw;
            save(dd); renderViewbar(); renderCatbar(); renderGrid(); toast('已重命名为「' + nw + '」');
        });
    });
    // 分组移动
    dropdown.querySelectorAll('.om-char-move-group').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation(); var cn = btn.dataset.cn; var dd = load();
            if (!dd.charGroups) dd.charGroups = {};
            var gNamesList = Object.keys(dd.charGroups);
            if (gNamesList.length === 0) {
                var gname = prompt('还没有分组，输入新分组名称：');
                if (!gname || !gname.trim()) return;
                gname = gname.trim();
                if (!validNewCharGroupName(dd.charGroups, gname)) { toast('分组名称已存在、为空或使用了保留名称', true); return; }
                dd.charGroups[gname] = [cn]; save(dd); renderCharDropdown(vbar, load(), query);
                toast('已创建分组并移入'); return;
            }
            var currentGroup = '';
            for (var g in dd.charGroups) { if ((dd.charGroups[g] || []).indexOf(cn) !== -1) { currentGroup = g; break; } }
            var msg = '将「' + cn + '」移到：\n0. 不分组' + (currentGroup ? '（当前：' + currentGroup + '）' : '') + '\n';
            gNamesList.forEach(function (g, i) { msg += (i + 1) + '. ' + g + '\n'; });
            msg += (gNamesList.length + 1) + '. 新建分组';
            var choice = prompt(msg); if (choice === null) return;
            var ci = parseInt(choice);
            for (var g2 in dd.charGroups) { var ri = dd.charGroups[g2].indexOf(cn); if (ri !== -1) dd.charGroups[g2].splice(ri, 1); }
            if (ci > 0 && ci <= gNamesList.length) { dd.charGroups[gNamesList[ci - 1]].push(cn); toast('已移入「' + gNamesList[ci - 1] + '」'); }
            else if (ci === gNamesList.length + 1) {
                var ng = prompt('新分组名称：');
                if (!ng || !ng.trim()) return;
                ng = ng.trim();
                if (!validNewCharGroupName(dd.charGroups, ng)) { toast('分组名称已存在、为空或使用了保留名称', true); return; }
                dd.charGroups[ng] = [cn]; toast('已创建分组并移入');
            }
            else { toast('已移出分组'); }
            save(dd); renderCharDropdown(vbar, load(), query);
        });
    });
    // 删除
    dropdown.querySelectorAll('.om-char-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation(); var cn = btn.dataset.cn;
            if (!confirm('删除角色「' + cn + '」及其所有穿搭？')) return;
            var dd = load();
            if (dd.chars) delete dd.chars[cn];
            var idx = dd.charNames.indexOf(cn); if (idx !== -1) dd.charNames.splice(idx, 1);
            if (dd.charFavorites) { var fi = dd.charFavorites.indexOf(cn); if (fi !== -1) dd.charFavorites.splice(fi, 1); }
            if (dd.charGroups) { for (var g in dd.charGroups) { var gi = dd.charGroups[g].indexOf(cn); if (gi !== -1) dd.charGroups[g].splice(gi, 1); } }
            if (dd.currentChar === cn) dd.currentChar = SHARED_CHAR_KEY;
            save(dd); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus(); toast('已删除角色「' + cn + '」');
        });
    });
    // 点击外部关闭
    function closeOnOutside(e) {
        if (!vbar.contains(e.target)) {
            charPanelExpanded = false;
            var dd2 = vbar.querySelector('.om-char-dropdown');
            if (dd2) dd2.parentNode.removeChild(dd2);
            document.removeEventListener('click', closeOnOutside, true);
        }
    }
    setTimeout(function () { document.addEventListener('click', closeOnOutside, true); }, 50);
}

function validNewCharGroupName(groups, name) {
    if (!name || name === '__proto__' || name === 'prototype' || name === 'constructor') return false;
    return !Object.prototype.hasOwnProperty.call(groups || {}, name);
}

function addCharPrompt() {
    var name = prompt('输入角色名：');
    if (!name || !name.trim()) return; name = name.trim();
    if (name === SHARED_CHAR_KEY) { toast('此名称为系统保留，请换一个', true); return; }
    var dd = load();
    if (!dd.charNames) dd.charNames = [];
    if (dd.charNames.indexOf(name) !== -1) { toast('角色「' + name + '」已存在', true); return; }
    dd.charNames.push(name); dd.currentChar = name; save(dd);
    charPanelExpanded = false;
    renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
    toast('✅ 已添加角色「' + name + '」');
}

function renderCharPanel() { /* 兼容 */ }

// ── 分类栏渲染（使用新 API）────────────────────────────────
function renderCatbar() {
    return renderOutfitCatbar();
}

// ── 单品分类栏渲染 ─────────────────────────────────────────
function renderAccCatbar() {
    return renderAccessoryCatbar();
}


// ── 网格区渲染（使用新 API）────────────────────────────────
var refreshFrame = 0, refreshPartKey = null;
export function requestWardrobeRefresh(partKey) {
    if (partKey && partKey !== currentPartKey()) return;
    if (!document.getElementById('om-grid-area')) return;
    refreshPartKey = currentPartKey();
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(function () {
        refreshFrame = 0;
        var key = refreshPartKey; refreshPartKey = null;
        if (key !== currentPartKey()) return;
        renderGrid(); renderCatbar(); renderBottomStatus();
    });
}
function renderGrid() {
    var area = document.getElementById('om-grid-area'); if (!area) return;
    var meta = loadMeta();

    // 角色视角但没选角色
    if (meta.currentView === 'char' && !meta.currentChar) {
        area.innerHTML = '<div class="om-empty"><i class="fa-solid fa-masks-theater"></i><span>请先选择或添加一个角色</span></div>';
        return;
    }

    // 分包还没从 IndexedDB 读回来（切换角色/预设后的几十毫秒）：
    // 先占个位，读完由 onPartitionLoaded 钩子自动重绘，不会把空壳当数据渲染出去。
    var pk = currentPartKey();
    if (!isPartitionLoaded(pk)) {
        if (DB.partLoadErrors[pk]) {
            area.innerHTML = '<div class="om-empty"><span>衣柜载入失败，原有数据已保留</span><button type="button" class="om-btn om-btn-outline" data-retry-wardrobe>重新载入</button></div>';
            area.querySelector('[data-retry-wardrobe]').onclick = function () {
                delete DB.partLoadErrors[pk]; delete area.dataset.loadingPart; renderGrid();
            };
            delete area.dataset.loadingPart;
            return;
        }
        if (area.dataset.loadingPart === pk) return;
        area.dataset.loadingPart = pk;
        area.innerHTML = '<div class="om-empty"><i class="fa-solid fa-hourglass-half"></i><span>正在载入衣柜…</span></div>';
        ensurePartitionLoaded(pk, function (part) {
            if (area.dataset.loadingPart === pk) delete area.dataset.loadingPart;
            if (pk !== currentPartKey()) return;
            if (!part && !DB.partLoadErrors[pk]) DB.partLoadErrors[pk] = { message: '衣柜载入失败，请重试' };
            requestWardrobeRefresh(pk);
        });
        return;
    }
    delete area.dataset.loadingPart;
    // 释放未使用的衣柜缓存，保留当前衣柜与正在穿着的记录。
    try { maintainPartitionCache(); } catch (eMaint) {}

    var part = loadCurrent();

    // ── 单品模式：显示单品卡片 ──
    if (state.accMode) {
        renderAccGrid(area, part);
        return;
    }

    renderOutfitGrid(area, part);
}

// ── 单品网格渲染 ────────────────────────────────────────
function renderAccGrid(area, part) {
    return renderAccessoryGrid(area, part);
}


// ── 底栏状态（使用 loadActivePartitions 跨分包显示）────────
function renderBottomStatus() {
    return renderOutfitBottomStatus();
}

// ── 选择详情面板 ─────────────────────────────────────────
function buildDetailGroups() {
    return buildOutfitDetailGroups();
}

function toggleDetailPanel() {
    return toggleOutfitDetailPanel();
}

function openDetailPanel(groups) {
    return openOutfitDetailPanel(groups);
}

function closeDetailPanel() {
    return closeOutfitDetailPanel();
}


// ── 注册到共享桥 ─────────────────────────────────────────
export { openPopup, closePopup, renderGrid, renderCatbar, renderAccCatbar, renderViewbar, renderBottomStatus, preResolveActiveImages };

export function registerMainFn() {
    fn.setWardrobeBrowseMode = setWardrobeBrowseMode;
    fn.openPopup = openPopup;
    fn.closePopup = closePopup;
    fn.renderGrid = renderGrid;
    fn.requestWardrobeRefresh = requestWardrobeRefresh;
    fn.renderCatbar = renderCatbar;
    fn.renderAccCatbar = renderAccCatbar;
fn.syncAccToggleBtn = syncAccToggleBtn;
    fn.renderViewbar = renderViewbar;
    fn.renderBottomStatus = renderBottomStatus;
    fn.closeDetailPanel = closeDetailPanel;
    fn.preResolveActiveImages = preResolveActiveImages;
    fn.toggleDraftAcc = toggleDraftAcc;
    fn.draftHasAcc = draftHasAcc;
    fn.outfitsInternalClearKitDraft = clearKitDraft;
    fn.outfitsInternalIsCurrentKitFocus = isCurrentKitFocus;
    fn.outfitsInternalSetKitFocus = setKitFocus;
    fn.outfitsInternalEnsureKitFocusForAccMode = ensureKitFocusForAccMode;
    fn.outfitsInternalToggleDisabledAcc = toggleDisabledAcc;
    fn.outfitsInternalSaveFocusedKitDraft = saveFocusedKitDraft;
    fn.outfitsInternalRefreshDetailPanel = refreshDetailPanel;
    fn.accessoriesInternalUpdateBatchButtonState = updateBatchButtonState;
    fn.classifyAllUncategorized = classifyAllUncategorized;
    fn.applyUiPrefsToOverlay = applyUiPrefsToOverlay;
    fn.recordWearHistory = recordWearHistory;
}
