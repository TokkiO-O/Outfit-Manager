// Outfit Manager · 二改版 | 本地衣柜记录与共享衣柜初始化
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { defPartition } from '../data.js';
import { idbGet, idbGetOrCreate } from './idb.js';
import { DB } from './state.js';

export function readLocalPartition(key, cb) {
    function finish(value, error) {
        if (error) { cb(null, error); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.outfits) ||
            value.accessories !== undefined && !Array.isArray(value.accessories)) {
            cb(null, new Error('衣柜记录格式异常：' + key + '；原记录已保留')); return;
        }
        cb(value, null);
    }
    idbGet(key, function (raw, error) {
        if (error || raw !== null) { finish(raw, error); return; }
        // Older local installs added the built-in shared index without saving
        // its empty record. Eviction then made that virtual wardrobe unreadable.
        // Never generalise this repair to a user preset, named role, read error,
        // corrupt record, backend-owned partition or a known worn selection.
        var worn = DB.metaCache && DB.metaCache.activePartitions && DB.metaCache.activePartitions[key];
        var library = DB.libraryActiveIds[key];
        if (DB.serverMode || key !== 'char:__shared__' || worn && worn.length || library && library.length) {
            cb(null, new Error('衣柜记录缺失：' + key + '；原有数据未被覆盖，请从备份恢复')); return;
        }
        idbGetOrCreate(key, defPartition(), function (value, failure, created) {
            if (!failure && created) {
                DB.localPartitionRepairs = DB.localPartitionRepairs || [];
                if (!DB.localPartitionRepairs.includes(key)) DB.localPartitionRepairs.push(key);
            }
            finish(value, failure);
        });
    });
}
