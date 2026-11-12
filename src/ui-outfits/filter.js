// Outfit Manager · 二改版 | 衣柜筛选与随机选择
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { fn, state } from '../bridge.js';
import { SHARED_CHAR_KEY, hasSubCats } from '../data.js';
import { currentPartKey, loadCurrent, loadMeta, loadPartition, saveCurrent, savePartition, syncActivePartitions } from '../db/index.js';
import { toast } from '../utils.js';
import { SH, clearKitDraft, preResolveActiveImages } from './core.js';
import { refreshDetailPanel, renderBottomStatus } from './detail.js';
import { recordWearHistory } from './history.js';

// ── 当前衣柜过滤列表（与网格一致）────────────────────────
export function getFilteredOutfits(part) {
    var allOutfits = (part && part.outfits) || [];
    var list;
    if (state.curCat && state.curCat !== '__all__') {
        list = allOutfits.filter(function (o) { return o.category === state.curCat; });
        if (state.curSubCat) {
            list = list.filter(function (o) { return o.subCategory === state.curSubCat; });
        }
    } else {
        list = allOutfits;
    }
    if (state.searchQuery) {
        var q = state.searchQuery.toLowerCase();
        list = list.filter(function (o) {
            return (o.name && o.name.toLowerCase().indexOf(q) !== -1) ||
                (o.category && o.category.toLowerCase().indexOf(q) !== -1) ||
                (o.sceneTag && o.sceneTag.toLowerCase().indexOf(q) !== -1) ||
                (o.description && o.description.toLowerCase().indexOf(q) !== -1);
        });
    }
    if (state.filterNoCat) {
        if (state.curCat === '__all__' && !state.catDrillParent) {
            list = list.filter(function (o) { return !o.category || !o.category.trim(); });
        } else {
            var curCatKey = state.catDrillParent || state.curCat;
            var cats = part.categories || [];
            if (hasSubCats(cats, curCatKey)) {
                list = list.filter(function (o) { return !o.subCategory || !o.subCategory.trim(); });
            }
        }
    }
    if (state.filterNoTag) { list = list.filter(function (o) { return !o.sceneTag || !o.sceneTag.trim(); }); }
    if (state.filterThinTag) {
        list = list.filter(function (o) {
            var tags = String(o.sceneTag || '').split(/[,，、/|]/).map(function (s) { return s.trim(); }).filter(Boolean);
            return tags.length > 0 && tags.length < 3;
        });
    }
    if (state.filterNoDesc) { list = list.filter(function (o) { return !o.description || !o.description.trim(); }); }
    if (state.filterFavorite) { list = list.filter(function (o) { return !!o.favorite; }); }
    if (state.filterNoImg) { list = list.filter(function (o) { return !o.imageData; }); }
    // 筛选和排序复用当前衣柜索引，避免反复建立大型映射表。
    var favs = [], rest = [];
    for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (it && it.favorite) favs.push(it); else rest.push(it);
    }
    return favs.length ? favs.concat(rest) : rest;
}

export function applyCharWardrobeMutex(activating) {
    if (!activating) return;
    var m = loadMeta();
    if (m.currentView !== 'char') return;
    if (m.currentChar === SHARED_CHAR_KEY) {
        (m.charIndex || []).forEach(function (ci) {
            if (ci.id !== SHARED_CHAR_KEY) {
                var cp = loadPartition(ci.partKey);
                if (cp.activeIds && cp.activeIds.length > 0) {
                    cp.activeIds = [];
                    savePartition(ci.partKey, cp);
                    syncActivePartitions(ci.partKey, []);
                }
            }
        });
    } else {
        var sharedPK = 'char:' + SHARED_CHAR_KEY;
        var sp = loadPartition(sharedPK);
        if (sp.activeIds && sp.activeIds.length > 0) {
            sp.activeIds = [];
            savePartition(sharedPK, sp);
            syncActivePartitions(sharedPK, []);
        }
    }
}

// ── 随机抽选：替换当前衣柜已选，并弹出预览 ──────────────
export function randomSelectOutfit() {
    if (state.batchMode) {
        toast('请先退出多选模式', true);
        return;
    }
    if (state.accMode) {
        toast('请先退出单品模式', true);
        return;
    }
    var meta = loadMeta();
    if (meta.currentView === 'char' && !meta.currentChar) {
        toast('请先选择角色', true);
        return;
    }
    var curP = loadCurrent();
    var list = getFilteredOutfits(curP);
    var withImg = list.filter(function (o) { return o && o.imageData; });
    var pool = withImg.length > 0 ? withImg : list;
    if (!pool || pool.length === 0) {
        toast('当前列表没有可抽选的穿搭', true);
        return;
    }
    var pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick || !pick.id) {
        toast('抽选失败，请重试', true);
        return;
    }
    // 替换当前衣柜已选
    clearKitDraft();
    curP.activeIds = [pick.id];
    applyCharWardrobeMutex(true);
    saveCurrent(curP);
    syncActivePartitions(currentPartKey(), curP.activeIds);
    fn.updateBtn();
    renderBottomStatus();
    fn.renderGrid();
    preResolveActiveImages();
    if (SH.detailPanelOpen) refreshDetailPanel();
    recordWearHistory(pick);
    toast('🎲 已替换为：' + (pick.name || '未命名'));
    if (pick.imageData && typeof fn.openLightbox === 'function') {
        fn.openLightbox(withImg.length > 0 ? withImg : [pick], pick.id, { showSelect: true });
    }
}
