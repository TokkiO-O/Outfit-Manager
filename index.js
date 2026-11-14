// Outfit Manager · 二改版 | 前端注册、启动与宿主接入
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { injectCriticalStyles } from './src/styles/index.js';
import { initStorage, getStorageHealth, getCacheStats, setPartitionLoadedHandler } from './src/db/index.js';
import { toast } from './src/utils.js';
import { setupInjection } from './src/inject.js';
import { state, fn } from './src/bridge.js';
import { registerMainFn, preResolveActiveImages } from './src/ui-main.js';
import { registerSheetsFn, createSheet, closeSheet, getAllTagSuggestions } from './src/ui-sheets/index.js';
import { registerBatchFn, initBatchDeps } from './src/ui-batch.js';
import { injectFab, updateBtn, injectBtn, registerFabFn, FAB_ID, BTN_ID } from './src/ui-fab.js';
import { activateRecovery, deactivateRecovery, injectRecoveryBtn } from './src/ui-recovery.js';
import { installDiagnostics } from './src/diagnose.js';
import { installFeatures, refreshSyncBadge } from './src/ui-features.js';
import { initializeCompatibilityJournal } from './src/compatibility-journal.js';
import { initializeRuntimeErrors, captureRuntimeError } from './src/runtime-errors.js';

initializeRuntimeErrors();

// ── 注册跨模块函数 ─────────────────────────────────────
registerMainFn();
registerSheetsFn();
initBatchDeps(createSheet, closeSheet, getAllTagSuggestions);
registerBatchFn();
registerFabFn();

// ── 启动 ──────────────────────────────────────────────────
// 样式可以先注入（不依赖数据）
injectCriticalStyles();
initializeCompatibilityJournal();

// 初始化存储：探测后端 → 加载 meta → 迁移 → 预加载 partitions
// 所有依赖数据的操作（注入拦截、悬浮球、按钮）放在回调里
var normalUiStarted = false;
var recoveryBtnTimer = null;
var recoveryToastShown = false;
var backendUpdateToastShown = false;

function startNormalUi() {
    if (normalUiStarted) return;
    normalUiStarted = true;
    if (recoveryBtnTimer) {
        clearInterval(recoveryBtnTimer);
        recoveryBtnTimer = null;
    }
    deactivateRecovery();
    installFeatures();

    // 安装 fetch/XHR 拦截
    setupInjection();

    // 入口已存在时直接返回，避免重复读写布局与样式。
    function bootEntries(force) {
        var hasBtn = !!document.getElementById(BTN_ID);
        var hasFab = !!document.getElementById(FAB_ID);
        if (!force && hasBtn && hasFab) return;
        if (!hasBtn) {
            try { injectBtn(); } catch (e) { captureRuntimeError(e, { operation: 'interface', source: 'index.js' }); console.error('[outfit-manager] injectBtn', e); }
        }
        if (!hasFab) {
            try { injectFab(); } catch (e2) { captureRuntimeError(e2, { operation: 'interface', source: 'index.js' }); console.error('[outfit-manager] injectFab', e2); }
        }
        if (!hasBtn) {
            try { updateBtn(); } catch (e3) { captureRuntimeError(e3, { operation: 'interface', source: 'index.js' }); }
        }
    }
    setTimeout(function () { bootEntries(true); }, 200);
    setTimeout(function () { bootEntries(true); }, 800);
    setTimeout(function () { bootEntries(true); }, 2000);
    setInterval(function () { bootEntries(false); }, 3000);

    try { preResolveActiveImages(); } catch (e4) { captureRuntimeError(e4, { operation: 'load', source: 'index.js' }); }

    // 衣柜分包是「按需载入」的：切换角色/预设后，分包从 IndexedDB 读回来的那一刻
    // 通知界面重绘一次，避免停在「正在载入衣柜…」。
    setPartitionLoadedHandler(function (partKey) {
        try {
            if (typeof fn.requestWardrobeRefresh === 'function') fn.requestWardrobeRefresh(partKey);
        } catch (eLoad) { captureRuntimeError(eLoad, { operation: 'interface', source: 'index.js' }); }
    });

    // 性能自检入口：控制台执行 __omDiag() 输出一份环境/数据/渲染成本报告
    try { installDiagnostics(); } catch (e5) {}
}

function handleStorageInitialization(err) {
    if (!err) {
        var health = getStorageHealth();
        if (!recoveryToastShown && health.serverRecoveryResult && health.serverRecoveryResult.recovered === true) {
            recoveryToastShown = true;
            toast('检测到衣柜索引异常，已根据可信的后端数据安全恢复。');
        }
        if (!backendUpdateToastShown && health.serverMode && health.serverPluginUpdateRecommended) {
            backendUpdateToastShown = true;
            var currentVersion = health.serverPluginVersion || '旧版（未报告版本）';
            toast('当前连接的穿搭后端报告版本为 ' + currentVersion + '，暂以兼容模式运行。可在设置 → 调试重新检测；如已替换后端文件，请重启 SillyTavern。', true);
        }
        startNormalUi();
        return;
    }
    console.error('[outfit-manager] 初始化失败，已进入安全恢复模式：', err);
    captureRuntimeError(err, { operation: 'startup', source: 'index.js' });
    activateRecovery(err, startNormalUi);
    setTimeout(injectRecoveryBtn, 300);
    if (!recoveryBtnTimer) recoveryBtnTimer = setInterval(injectRecoveryBtn, 2000);
}

// 性能自检：启动耗时 + 缓存规模。卡的时候看一眼控制台就能知道是不是加载太重。
var bootT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
initStorage(function (err) {
    try {
        var ms = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - bootT0);
        var st = getCacheStats();
        window.__omPerf = { bootMs: ms, storage: st, serverMode: !!(getStorageHealth() || {}).serverMode };
        console.log('[outfit-manager] 启动耗时 ' + ms + 'ms · 分包 ' + st.partitions +
            ' · 穿搭 ' + st.outfits + ' 套 · 带图 ' + st.images + ' 张 · 角色 ' + st.chars +
            ' · ' + (window.__omPerf.serverMode ? '后端模式' : '本地模式') + ' · 性能补丁 7');
    } catch (ePerf) {}
    handleStorageInitialization(err || null);
});
