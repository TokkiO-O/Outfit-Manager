// Outfit Manager · 二改版 | 模块间共享的界面状态与函数入口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var state = {
    darkMode: false,
    lastClassifyUndo: null,
    actionUndoStack: [], // [{id,type,label,ts,partKey,payload}] 最多30
    curCat: '__all__',
    curSubCat: null,        // 当前子分类筛选，null=全部（在父分类下）
    catDrillParent: null,   // 分类下钻的父分类名，null=在顶级
    batchMode: false,
    batchSelected: [],
    searchOpen: false,
    searchQuery: '',
    filterOpen: false,
    filterNoCat: false,     // 筛选：未分类
    filterNoTag: false,     // 筛选：无标签
    filterThinTag: false,   // 筛选：标签不足3个
    filterNoDesc: false,    // 筛选：无描述
    filterFavorite: false,
    filterNoImg: false,
    detailOpen: false,
    classifyReviewQueue: [], // 低置信度待确认
    collapsedGroups: {},
    resolvedImages: {},
    gridSrcCache: {},   // 网格已显示过的图 src，防切分类闪白   // server模式下预解析的图片缓存 { outfitId: { url, dataUrl } }
    kitFocusPartKey: null,
    kitFocusOutfitId: null,
    kitDraftAccIds: [],
    kitDraftSourceKitId: null,
    kitDraftDirty: false
};

// 函数注册表：各模块把自己的函数注册进来，其他模块通过 fn.xxx() 调用
export var fn = {};
