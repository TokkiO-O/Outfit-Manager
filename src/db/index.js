// Outfit Manager · 二改版 | 存储模块公开入口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export { genId8 } from './state.js';
export { loadMeta, saveMeta } from './meta.js';
export { setPartitionLoadedHandler, ensurePartitionLoaded, isPartitionLoaded, maintainPartitionCache, loadPartition, savePartition, ensurePartition, deletePartition } from './partitions.js';
export { currentUserPartKey, currentPartKey, switchWardrobeView, loadCurrent, saveCurrent, syncActivePartitions, syncCurrentUserActivePartition, loadActivePartitions, charNameById, charIdByName, charPartKey } from './view.js';
export { isServerMode, getImageUrlPrefix, getStorageHealth, getCacheStats, diagnoseServerRecovery, restoreServerSnapshot } from './health.js';
export { resolveImageForExternal, batchResolveImages, uploadImage } from './images.js';
export { initStorage } from './init.js';
export { load, save } from './legacy.js';
export { serverApi } from './server.js';
export { withLoadedPartitions } from './partitions.js';
