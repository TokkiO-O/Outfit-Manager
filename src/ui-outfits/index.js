// Outfit Manager · 二改版 | 穿搭界面公开入口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export { preResolveActiveImages } from './core.js';
export { recordWearHistory } from './history.js';
// autotag：无对外接口
export { pushActionUndo, openActionUndoSheet, autoTagUntagged, classifyAllUncategorized, setupBatchSwipeSelect } from './classify.js';
export { renderCatbar } from './catbar.js';
export { getFilteredOutfits, randomSelectOutfit } from './filter.js';
export { patchOutfitCardActive, renderOutfitGrid, disconnectOutfitGridObserver } from './grid.js';
export { renderBottomStatus, buildDetailGroups, refreshDetailPanel, toggleDetailPanel, openDetailPanel, closeDetailPanel, resetOutfitsUiState } from './detail.js';
