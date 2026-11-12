// Outfit Manager · 二改版 | 存储缓存与连接状态
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

var ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function genId8() {
    var s = '';
    for (var i = 0; i < 8; i++) s += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
    return s;
}

// ── 常量 ─────────────────────────────────────────────────
// ── 常量 ─────────────────────────────────────────────────
export var DB_NAME = 'outfit_mgr_db';
export var DB_VERSION = 1;
export var STORE_NAME = 'data';
export var LS_KEY = 'outfit_mgr_v4';
export var SERVER_SEEN_KEY = 'outfit_mgr_server_seen';
// v1 旧 key（迁移用）
export var LEGACY_DATA_KEY = 'main';
export var SERVER_BASE = '/api/plugins/outfit-manager';
export var IMAGE_URL_PREFIX = SERVER_BASE + '/images/';
export var MIN_SERVER_PLUGIN_VERSION = '2.2.0';

// 时序参数（不可变；原文写在状态区里，拆出来更清楚）
export var SERVER_DEBOUNCE_MS = 1000;
export var SERVER_READ_MAX_ATTEMPTS = 3;
export var SERVER_READ_RETRY_MS = 150;

// ── 可变状态 ─────────────────────────────────────────────
export var DB = {
    dbInstance: null,
    metaCache: null,
    partCache: {},
    // 分包 LRU：从旧到新，只用于诊断（谁最近被用过）
    partLru: [],
    // 上一次驱逐时「正在看」的分包集合。用来判断哪个分包值得额外留一份：
    // 只有「刚刚还在看、现在切走了」的那个才留，其余一律驱逐。
    prevPinned: {},
    knownPartKeys: {},
    partColdStub: {},
    partLoadCbs: {},
    onPartitionLoaded: null,
    serverMode: false,
    serverVersion: 1,
    serverPluginVersion: null,
    serverPluginUpdateRecommended: false,
    serverSupportsPartitions: false,
    serverSupportsRecovery: false,
    serverSupportsPartitionTransactions: false,
    serverSupportsIncremental: false,
    backendInfo: null,
    remotePartRevisions: {},
    cachedPartRevisions: {},
    queuedPartitionJSON: {},
    libraryActiveIds: {},
    libraryPresetId: null,
    libraryDefaultsInitialized: false,
    syncState: 'idle',
    syncError: null,
    syncConflict: null,
    syncRetryCount: 0,
    sendingPartKeys: {},
    partLoadErrors: {},
    serverHydrated: false,
    serverInitFailed: false,
    lastInitializationError: null,
    serverRecoveryRevision: null,
    serverStorageState: null,
    serverRecoveryResult: null,
    suppressServerWrites: false,
    csrfToken: null,
    serverDirty: false,
    serverRevision: 0,
    serverDebounceTimer: null,
    serverPutInFlight: false,
    dirtyPartKeys: {},
    partRevisions: {},
    partFlushTimer: null,
    partFlushInFlight: false,
    deletedPartKeys: {},
    pendingPartitionDeletes: {},
    partitionDeleteRetryTimer: null,
    checkpointTimer: null
};

// ── 小工具 ───────────────────────────────────────────────
export function isPluginVersionAtLeast(value, minimum) {
    var actual = typeof value === 'string' ? value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/) : null;
    var required = typeof minimum === 'string' ? minimum.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
    if (!actual || !required) return false;
    for (var i = 1; i <= 3; i++) {
        var left = Number(actual[i]);
        var right = Number(required[i]);
        if (left > right) return true;
        if (left < right) return false;
    }
    // A prerelease of the minimum stable version is not considered current.
    return !actual[4];
}
