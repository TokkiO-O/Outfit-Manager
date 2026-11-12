// Outfit Manager · 二改版 | 存储检测与启动加载
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { SHARED_CHAR_KEY, defMeta, defPartition, ensureMetaDefaults, ensurePartDefaults } from '../data.js';
import { idbGet, idbPutBatch } from './idb.js';
import { loadMeta } from './meta.js';
import { migrateFromV1, splitServerDataToPartitions } from './migrate.js';
import { maintainPartitionCache, savePartition } from './partitions.js';
import { preloadAllPartitions } from './preload.js';
import { detectServer, scheduleServerCheckpoint, scheduleServerPut, serverGetData } from './server.js';
import { serverGetPartition, serverGetPartitionKeys, serverPutPartition, serverPutPartitionDataset } from './server-partitions.js';
import { DB, LEGACY_DATA_KEY, LS_KEY } from './state.js';
import { initFromServerIncremental } from './lazy-init.js';

//  启动初始化
// ══════════════════════════════════════════════════════════

export function loadFromLS() {
    try { var r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
export function removeLSData() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

export function hasRealOutfitData(d) {
    if (!d || typeof d !== 'object') return false;
    if (Array.isArray(d.outfits) && d.outfits.length > 0) return true;
    if (d.chars && typeof d.chars === 'object') {
        for (var cn in d.chars) {
            var cd = d.chars[cn];
            if (cd && Array.isArray(cd.outfits) && cd.outfits.length > 0) return true;
        }
    }
    if (Array.isArray(d.presets)) {
        for (var i = 0; i < d.presets.length; i++) {
            var p = d.presets[i];
            if (p && Array.isArray(p.outfits) && p.outfits.length > 0) return true;
        }
    }
    return false;
}

export function initStorage(cb) {
    DB.serverHydrated = false;
    DB.serverInitFailed = false;
    DB.lastInitializationError = null;
    DB.serverPluginVersion = null;
    DB.serverPluginUpdateRecommended = false;
    DB.serverStorageState = null;
    DB.serverRecoveryResult = null;
    DB.serverSupportsPartitionTransactions = false;
    DB.serverSupportsIncremental = false;
    detectServer(function (result) {
        DB.serverMode = !!result.installed;

        if (!result.ok) {
            failServerInitialization(
                '后端状态检测失败，请检查服务器后重试',
                result,
                cb,
                'SERVER_STATUS_FAILED'
            );
            return;
        }

        if (DB.serverMode && DB.serverSupportsPartitions) {
            if (DB.serverStorageState && ['HEALTHY', 'NEW_INSTALL', 'META_MISSING', 'META_CORRUPT'].indexOf(DB.serverStorageState) === -1) {
                failServerInitialization('后端返回了未知的数据健康状态，已停止初始化。', { storageState: DB.serverStorageState }, cb, 'STORAGE_STATE_INVALID');
                return;
            }
            if (DB.serverStorageState === 'META_MISSING' || DB.serverStorageState === 'META_CORRUPT') {
                failServerInitialization(
                    DB.serverStorageState === 'META_MISSING'
                        ? '检测到衣柜分包存在但 meta 索引缺失，且没有可信来源可自动恢复。'
                        : '后端 meta 索引损坏或与衣柜分包关系不合法。',
                    { storageState: DB.serverStorageState, recoveryResult: DB.serverRecoveryResult },
                    cb,
                    DB.serverStorageState
                );
                return;
            }
            // v2 后端：只有完整 hydrate 成功才允许入口启动可写 UI
            initFromServerV2(function (err) { cb(err || null); });
            return;
        }

        if (DB.serverMode) {
            // v1 后端：从后端拉取完整数据 → 拆成 meta + partitions 缓存到本地
            serverGetData(function (serverData) {
                if (hasRealOutfitData(serverData)) {
                    splitServerDataToPartitions(serverData, function () {
                        preloadAllPartitions(function () { cb(null); });
                    });
                    return;
                }
                // 后端无数据：检查本地
                initLocal(function () {
                    // 如果本地有数据，上传到后端
                    if (Object.keys(DB.partCache).length > 0) {
                        scheduleServerPut();
                        try { console.log('[outfit-manager] 已将本地数据迁移到后端。'); } catch (e) {}
                    }
                    cb(null);
                });
            });
            return;
        }

        // 本地模式
        initLocal(function () { cb(null); });
    });
}

export function clearServerWriteQueue() {
    if (DB.partFlushTimer) clearTimeout(DB.partFlushTimer);
    DB.partFlushTimer = null;
    DB.dirtyPartKeys = {};
}

export function failServerInitialization(message, details, cb, code) {
    DB.serverHydrated = false;
    DB.serverInitFailed = true;
    if (DB.checkpointTimer) clearTimeout(DB.checkpointTimer);
    DB.checkpointTimer = null;
    clearServerWriteQueue();
    var err = new Error(message);
    err.details = details || null;
    err.code = code || 'SERVER_INIT_FAILED';
    DB.lastInitializationError = err;
    try { console.error('[outfit-manager] 后端初始化已中止：' + message, details || ''); } catch (e) {}
    cb(err);
}

export function validateMetaPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'meta 不是 JSON 对象';
    if (data._version !== 2) return 'meta._version 必须严格等于 2';
    var arrayFields = ['presets', 'charIndex', 'charFavorites'];
    for (var i = 0; i < arrayFields.length; i++) {
        var field = arrayFields[i];
        if (!Object.prototype.hasOwnProperty.call(data, field) || !Array.isArray(data[field])) return 'meta.' + field + ' 缺失或类型无效';
    }
    if (!data.activePartitions || typeof data.activePartitions !== 'object' || Array.isArray(data.activePartitions)) {
        return 'meta.activePartitions 缺失或类型无效';
    }
    if (!data.charGroups || typeof data.charGroups !== 'object' || Array.isArray(data.charGroups)) {
        return 'meta.charGroups 缺失或类型无效';
    }
    if (!Object.prototype.hasOwnProperty.call(data, 'activePresetId') || (data.activePresetId !== null && typeof data.activePresetId !== 'string')) return 'meta.activePresetId 类型无效';
    if (data.currentView !== 'user' && data.currentView !== 'char') return 'meta.currentView 类型无效';
    if (typeof data.currentChar !== 'string') return 'meta.currentChar 类型无效';
    if (data.mode !== undefined && ['text', 'image', 'both'].indexOf(data.mode) === -1) return 'meta.mode 类型无效';
    if (data.injectPosition !== undefined && ['user', 'system', 'context'].indexOf(data.injectPosition) === -1) return 'meta.injectPosition 类型无效';
    var stringSettings = ['singleTemplate', 'multiTemplate', 'charSingleTemplate', 'charMultiTemplate', 'imagePrompt', 'multiImagePrompt', 'fabImage'];
    for (var settingIndex = 0; settingIndex < stringSettings.length; settingIndex++) {
        if (data[stringSettings[settingIndex]] !== undefined && typeof data[stringSettings[settingIndex]] !== 'string') return 'meta.' + stringSettings[settingIndex] + ' 类型无效';
    }
    if (data.debug !== undefined && typeof data.debug !== 'boolean') return 'meta.debug 类型无效';
    if (data.showBall !== undefined && typeof data.showBall !== 'boolean') return 'meta.showBall 类型无效';
    if (data.fabSize !== undefined && (typeof data.fabSize !== 'number' || !Number.isFinite(data.fabSize))) return 'meta.fabSize 类型无效';
    if (data.tagOrder !== undefined && (!Array.isArray(data.tagOrder) || data.tagOrder.some(function (item) { return typeof item !== 'string'; }))) return 'meta.tagOrder 类型无效';
    if (data.fabPos !== undefined && data.fabPos !== null && (!data.fabPos || typeof data.fabPos !== 'object' || Array.isArray(data.fabPos) ||
        typeof data.fabPos.top !== 'number' || !Number.isFinite(data.fabPos.top) || typeof data.fabPos.left !== 'number' || !Number.isFinite(data.fabPos.left))) return 'meta.fabPos 类型无效';
    if (data.apiVision !== undefined && (!data.apiVision || typeof data.apiVision !== 'object' || Array.isArray(data.apiVision))) return 'meta.apiVision 类型无效';
    if (data.apiVision && typeof data.apiVision === 'object' && !Array.isArray(data.apiVision)) {
        var visionStrings = ['endpoint', 'key', 'model', 'prompt', 'accPrompt'];
        for (var visionIndex = 0; visionIndex < visionStrings.length; visionIndex++) {
            if (data.apiVision[visionStrings[visionIndex]] !== undefined && typeof data.apiVision[visionStrings[visionIndex]] !== 'string') return 'meta.apiVision.' + visionStrings[visionIndex] + ' 类型无效';
        }
        if (data.apiVision.promptTemplates !== undefined && !Array.isArray(data.apiVision.promptTemplates)) return 'meta.apiVision.promptTemplates 类型无效';
        if (data.apiVision.activePromptTemplateId !== undefined && data.apiVision.activePromptTemplateId !== null && typeof data.apiVision.activePromptTemplateId !== 'string') return 'meta.apiVision.activePromptTemplateId 类型无效';
        if (data.apiVision.overwrite !== undefined && typeof data.apiVision.overwrite !== 'boolean') return 'meta.apiVision.overwrite 类型无效';
    }

    var presetIds = {};
    for (var j = 0; j < data.presets.length; j++) {
        var preset = data.presets[j];
        if (!preset || typeof preset.id !== 'string' || !preset.id || typeof preset.name !== 'string' || !preset.name ||
            preset.partKey !== 'user:' + preset.id || !isListedPartitionKey(preset.partKey) || presetIds[preset.id]) {
            return 'meta.presets 包含无效或重复索引';
        }
        presetIds[preset.id] = true;
    }
    if (typeof data.activePresetId === 'string' && !presetIds[data.activePresetId]) return 'meta.activePresetId 未引用现有预设';

    var charIds = {};
    var charNames = {};
    var sharedCount = 0;
    for (var n = 0; n < data.charIndex.length; n++) {
        var item = data.charIndex[n];
        if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name || !isListedPartitionKey(item.partKey)) return 'meta.charIndex 包含无效索引';
        if (item.id === SHARED_CHAR_KEY) {
            sharedCount++;
            if (item.name !== SHARED_CHAR_KEY || item.partKey !== 'char:__shared__') return 'meta.charIndex 的通用衣柜索引无效';
        } else if (!/^c_[A-Za-z0-9]{8}$/.test(item.id) || item.partKey !== 'char:' + item.id || item.name === SHARED_CHAR_KEY) {
            return 'meta.charIndex 包含无效角色索引';
        }
        if (charIds[item.id] || charNames[item.name]) return 'meta.charIndex 包含重复索引';
        charIds[item.id] = true;
        charNames[item.name] = true;
    }
    if (sharedCount > 1) return 'meta.charIndex 包含重复通用衣柜索引';
    if (data.currentChar && !charIds[data.currentChar]) return 'meta.currentChar 未引用现有角色';
    if (data.currentView === 'char' && (!data.currentChar || !charIds[data.currentChar])) return '角色视角未引用现有角色';
    for (var f = 0; f < data.charFavorites.length; f++) if (!charIds[data.charFavorites[f]] || data.charFavorites[f] === SHARED_CHAR_KEY) return 'meta.charFavorites 包含无效角色引用';
    for (var groupName in data.charGroups) {
        if (!Array.isArray(data.charGroups[groupName])) return 'meta.charGroups 包含无效分组';
        for (var g = 0; g < data.charGroups[groupName].length; g++) if (!charIds[data.charGroups[groupName][g]] || data.charGroups[groupName][g] === SHARED_CHAR_KEY) return 'meta.charGroups 包含无效角色引用';
    }
    var active = data.activePartitions || {};
    for (var key in active) {
        if (!isListedPartitionKey(key) || !Array.isArray(active[key]) || active[key].some(function (id) { return typeof id !== 'string'; })) return 'meta.activePartitions 包含无效分包引用';
    }
    return null;
}

export function validatePartitionPayload(data, key) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return key + ' 不是 JSON 对象';
    var arrayFields = ['outfits', 'categories', 'activeIds', 'accessories', 'accCategories'];
    for (var i = 0; i < arrayFields.length; i++) {
        var field = arrayFields[i];
        if (!Object.prototype.hasOwnProperty.call(data, field) || !Array.isArray(data[field])) return key + '.' + field + ' 缺失或类型无效';
    }
    if (data.activeIds.some(function (id) { return typeof id !== 'string'; })) return key + '.activeIds 类型无效';
    if (new Set(data.activeIds).size !== data.activeIds.length) return key + '.activeIds 包含重复 id';
    for (var listIndex = 0; listIndex < 2; listIndex++) {
        var listName = listIndex === 0 ? 'outfits' : 'accessories';
        var ids = {};
        for (var n = 0; n < data[listName].length; n++) {
            var item = data[listName][n];
            if (!item || typeof item.id !== 'string' || !item.id || ids[item.id]) return key + '.' + listName + ' 包含无效或重复 id';
            ids[item.id] = true;
        }
    }
    var outfitIds = {};
    for (var outfitIndex = 0; outfitIndex < data.outfits.length; outfitIndex++) outfitIds[data.outfits[outfitIndex].id] = true;
    for (var activeIndex = 0; activeIndex < data.activeIds.length; activeIndex++) {
        if (!outfitIds[data.activeIds[activeIndex]]) return key + '.activeIds 引用了不存在的穿搭';
    }
    return null;
}

export function collectRequiredPartKeys(meta) {
    var required = ['user:__default__'];
    function add(key) {
        if (typeof key === 'string' && required.indexOf(key) === -1) required.push(key);
    }
    (meta.presets || []).forEach(function (item) { if (item) add(item.partKey); });
    (meta.charIndex || []).forEach(function (item) { if (item) add(item.partKey); });
    var active = meta.activePartitions || {};
    for (var key in active) add(key);
    return required;
}

export function validateHydratedRelations(meta, parts) {
    var expected = collectRequiredPartKeys(meta);
    var active = meta.activePartitions || {};
    var activeUserKey = meta.activePresetId ? 'user:' + meta.activePresetId : 'user:__default__';
    for (var i = 0; i < expected.length; i++) {
        var key = expected[i];
        var part = parts[key];
        if (!part) return 'meta 引用的衣柜分包缺失：' + key;
        var ids = part.activeIds || [];
        var tracked = Object.prototype.hasOwnProperty.call(active, key) ? active[key] : null;
        var shouldTrack = key.indexOf('char:') === 0 || key === activeUserKey;
        if (shouldTrack && ids.length > 0) {
            if (!tracked || tracked.length !== ids.length) return 'meta.activePartitions 与分包不一致：' + key;
            for (var n = 0; n < ids.length; n++) if (tracked[n] !== ids[n]) return 'meta.activePartitions 与分包不一致：' + key;
        }
        if ((!shouldTrack || ids.length === 0) && tracked && tracked.length > 0) return 'meta.activePartitions 包含不应激活的分包：' + key;
    }
    for (var activeKey in active) if (expected.indexOf(activeKey) === -1) return 'meta.activePartitions 引用了索引外分包：' + activeKey;
    return null;
}

export function isListedPartitionKey(key) {
    return typeof key === 'string' && /^(user:(__default__|[A-Za-z0-9_-]+)|char:(__shared__|c_[A-Za-z0-9]{8}))$/.test(key);
}

export function normalizeHydratedServerState() {
    var meta = loadMeta();
    collectRequiredPartKeys(meta).forEach(function (key) {
        if (!DB.partCache[key] && !DB.knownPartKeys[key]) savePartition(key, defPartition());
    });
}

// v2 后端启动：keys 成功后先加载 meta，再加载并验证全部现存 partition。
export function initFromServerV2(cb) {
    if (DB.serverSupportsIncremental) { initFromServerIncremental(cb); return; }
    serverGetPartitionKeys(function (keysResult) {
        if (!keysResult.ok) {
            failServerInitialization('后端分包索引读取失败，请刷新或检查服务器', keysResult, cb, 'PARTITION_KEYS_READ_FAILED');
            return;
        }
        var keys = keysResult.data;
        if (keys.length === 0) {
            // 只有成功读取到明确的空 keys，才可判定为全新后端并上传本地数据。
            initLocal(function () {
                DB.serverHydrated = true;
                DB.serverInitFailed = false;
                DB.suppressServerWrites = true;
                try { normalizeHydratedServerState(); }
                finally { DB.suppressServerWrites = false; }
                uploadLocalToServerV2(function (ok) {
                    if (!ok) {
                        failServerInitialization('初始化后端时有分包写入失败；本地数据仍保留，服务器写入已锁定。', null, cb, 'INITIAL_UPLOAD_FAILED');
                        return;
                    }
                    try { console.log('[outfit-manager] 已初始化空 v2 后端。'); } catch (e) {}
                    scheduleServerCheckpoint();
                    cb(null);
                });
            });
            return;
        }

        var seen = {};
        for (var i = 0; i < keys.length; i++) {
            if (typeof keys[i] !== 'string' || seen[keys[i]] || (keys[i] !== 'meta' && !isListedPartitionKey(keys[i]))) {
                failServerInitialization('后端返回了无效的分包索引', keysResult, cb, 'PARTITION_KEYS_INVALID');
                return;
            }
            seen[keys[i]] = true;
        }

        var partKeys = keys.filter(function (key) { return key !== 'meta'; });
        if (!seen.meta) {
            var orphanMessage = partKeys.length > 0
                ? '检测到衣柜分包存在但 meta 索引缺失，需要恢复索引。'
                : '后端 meta 索引缺失';
            failServerInitialization(orphanMessage, { keys: keys }, cb, 'META_MISSING');
            return;
        }

        serverGetPartition('meta', function (metaResult) {
            if (!metaResult.ok || !metaResult.found) {
                failServerInitialization('后端 meta 读取失败，请刷新或检查服务器', metaResult, cb, 'META_READ_FAILED');
                return;
            }
            var validationError = validateMetaPayload(metaResult.data);
            if (validationError) {
                failServerInitialization('后端 meta 数据无效：' + validationError, metaResult, cb, 'META_SCHEMA_INVALID');
                return;
            }

            var hydratedMeta;
            try { hydratedMeta = ensureMetaDefaults(metaResult.data); }
            catch (err) {
                failServerInitialization('后端 meta 数据规范化失败', { error: err && err.message }, cb, 'META_NORMALIZE_FAILED');
                return;
            }

            var requiredKeys = collectRequiredPartKeys(hydratedMeta);
            var missingKeys = requiredKeys.filter(function (key) { return !seen[key]; });
            if (missingKeys.length > 0) {
                failServerInitialization('meta 引用的衣柜分包缺失：' + missingKeys.join(', '), { keys: keys, missingKeys: missingKeys }, cb, 'PARTITION_MISSING');
                return;
            }

            var pending = partKeys.length;
            var failed = false;
            var hydratedParts = {};
            if (pending === 0) {
                failServerInitialization('后端已有 meta，但没有必要的衣柜分包', { keys: keys }, cb, 'PARTITIONS_EMPTY');
                return;
            }

            partKeys.forEach(function (key) {
                serverGetPartition(key, function (partResult) {
                    if (failed) return;
                    if (!partResult.ok || !partResult.found) {
                        failed = true;
                        failServerInitialization('后端衣柜分包读取失败：' + key, partResult, cb, 'PARTITION_READ_FAILED');
                        return;
                    }
                    var partValidationError = validatePartitionPayload(partResult.data, key);
                    if (partValidationError) {
                        failed = true;
                        failServerInitialization('后端衣柜分包数据无效：' + partValidationError, partResult, cb, 'PARTITION_SCHEMA_INVALID');
                        return;
                    }
                    try { hydratedParts[key] = ensurePartDefaults(partResult.data); }
                    catch (err) {
                        failed = true;
                        failServerInitialization('后端衣柜分包规范化失败：' + key, { error: err && err.message }, cb, 'PARTITION_NORMALIZE_FAILED');
                        return;
                    }
                    pending--;
                    if (pending === 0) {
                        var relationError = validateHydratedRelations(hydratedMeta, hydratedParts);
                        if (relationError) {
                            failed = true;
                            failServerInitialization('后端 meta 引用关系无效：' + relationError, { keys: keys }, cb, 'META_CORRUPT');
                            return;
                        }
                        // 所有读取完成前不触碰现有缓存；此处才原子切换 hydrate 结果。
                        DB.metaCache = hydratedMeta;
                        DB.partCache = hydratedParts;
                        DB.deletedPartKeys = {};
                        // 记录所有已知分包：被驱逐后靠这个判断「能按需读回来」
                        for (var ki = 0; ki < partKeys.length; ki++) DB.knownPartKeys[partKeys[ki]] = true;
                        var entries = [{ key: 'meta', value: DB.metaCache }];
                        partKeys.forEach(function (partKey) {
                            entries.push({ key: partKey, value: DB.partCache[partKey] });
                        });
                        idbPutBatch(entries, function () {
                            DB.serverHydrated = true;
                            DB.serverInitFailed = false;
                            normalizeHydratedServerState();
                            // 全部落盘后，只留当前衣柜 + 在穿的，其余释放内存
                            maintainPartitionCache();
                            scheduleServerCheckpoint();
                            cb(null);
                        });
                    }
                });
            });
        });
    });
}

// 本地数据上传到 v2 后端（本地→server 迁移）
export function uploadLocalToServerV2(cb) {
    // 新后端走显式 meta+partitions 事务；旧 v2 后端保持兼容，并至少确保 meta 最后提交。
    if (DB.serverSupportsPartitionTransactions) serverPutPartitionDataset(cb);
    else uploadLocalPartitionsSequentially(cb);
}

export function uploadLocalPartitionsSequentially(cb) {
    var meta = DB.metaCache || defMeta();
    var keys = collectRequiredPartKeys(meta).concat(['meta']);
    var index = 0;
    function next(ok) {
        if (ok === false) { cb(false); return; }
        if (index >= keys.length) { cb(true); return; }
        var key = keys[index++];
        var value = key === 'meta' ? DB.metaCache : DB.partCache[key];
        if (!value) { cb(false); return; }
        serverPutPartition(key, value, next);
    }
    next(true);
}

export function initLocal(cb) {
    // 检查是否已有 v2 meta
    idbGet('meta', function (existingMeta) {
        if (existingMeta && existingMeta._version >= 2) {
            // 已是 v2 分包格式
            DB.metaCache = ensureMetaDefaults(existingMeta);
            preloadAllPartitions(function () { cb(); });
            return;
        }

        // 检查旧 v1 key
        idbGet(LEGACY_DATA_KEY, function (oldData) {
            if (oldData && hasRealOutfitData(oldData)) {
                // v1 → v2 迁移
                migrateFromV1(oldData, function () {
                    preloadAllPartitions(function () { cb(); });
                });
                return;
            }

            // 检查 localStorage（极旧版本）
            var lsData = loadFromLS();
            if (lsData && hasRealOutfitData(lsData)) {
                migrateFromV1(lsData, function () {
                    removeLSData();
                    preloadAllPartitions(function () { cb(); });
                });
                return;
            }

            // 全新安装：创建空 meta + 空默认 partition
            DB.metaCache = defMeta();
            DB.metaCache.charIndex = [{ id: SHARED_CHAR_KEY, name: SHARED_CHAR_KEY, partKey: 'char:__shared__' }];
            DB.partCache['user:__default__'] = defPartition();
            DB.partCache['char:__shared__'] = defPartition();
            DB.knownPartKeys['user:__default__'] = true;
            DB.knownPartKeys['char:__shared__'] = true;
            idbPutBatch([
                { key: 'meta', value: DB.metaCache },
                { key: 'char:__shared__', value: DB.partCache['char:__shared__'] },
                { key: 'user:__default__', value: DB.partCache['user:__default__'] }
            ], function () { cb(); });
        });
    });
}

// ══════════════════════════════════════════════════════════
