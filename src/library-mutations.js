// Outfit Manager · 二改版 | 衣柜修改的原子提交
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DB } from './db/state.js';
import { idbPutBatch } from './db/idb.js';
import { scheduleServerPutKey } from './db/server-partitions.js';
import { copyJson } from './json-data.js';
import { applyChatPartition, metaForStorage, partitionForStorage } from './chat-state.js';
export async function commitWardrobeChanges(parts,meta) {
    if(DB.serverInitFailed||DB.syncConflict)throw new Error('请先处理保存或同步问题');
    var stored={},entries=[];
    Object.keys(parts).forEach(function(key){stored[key]=partitionForStorage(key,copyJson(parts[key]));entries.push({key:key,value:stored[key]});});
    if(meta)entries.push({key:'meta',value:metaForStorage(meta)});
    var ok=await new Promise(function(resolve){idbPutBatch(entries,resolve);});
    if(!ok)throw new Error('本地保存未完成，原有衣柜已保留');
    if(meta){DB.metaCache=copyJson(meta);scheduleServerPutKey('meta');}
    Object.keys(stored).forEach(function(key){DB.libraryActiveIds[key]=(stored[key].activeIds||[]).slice();DB.partCache[key]=applyChatPartition(key,stored[key]);DB.knownPartKeys[key]=true;delete DB.partColdStub[key];delete DB.partLoadErrors[key];scheduleServerPutKey(key);});
    return true;
}
