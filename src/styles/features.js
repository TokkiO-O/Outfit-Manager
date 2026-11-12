// Outfit Manager · 二改版 | 聊天与保存状态面板样式
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var FEATURE_CSS = `
.om-sheet-modal{box-sizing:border-box}
.om-feature-content{min-width:0;line-height:1.65}
.om-feature-content .om-hint{opacity:.75!important;color:inherit!important}
.om-feature-card{margin:12px 0;padding:12px;border:1px solid rgba(127,127,127,.22);border-radius:12px;overflow-wrap:anywhere}
.om-current-heading{display:flex;flex-direction:column;gap:3px;margin-bottom:12px}.om-current-heading strong{font-size:1.1em}.om-current-heading small{opacity:.65}
.om-feature-content details{border-top:1px solid rgba(127,127,127,.18);padding:10px 0}.om-feature-content summary{cursor:pointer;font-weight:600}
.om-feature-content [data-extra-search]{width:100%;margin-top:8px}
.om-feature-actions,.om-debug-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.om-feature-content input:not([type=checkbox]),.om-feature-content select,.om-feature-content textarea{max-width:100%;min-width:0;box-sizing:border-box;border:1px solid rgba(127,127,127,.3);border-radius:7px;background:rgba(127,127,127,.08);color:inherit;padding:8px;font:inherit}
.om-feature-content textarea,.om-feature-content .om-field>input,.om-feature-content .om-field>select{width:100%}.om-feature-content textarea{resize:vertical;white-space:pre-wrap}
.om-feature-accessory{display:flex;gap:8px;align-items:center;margin:8px 0}.om-feature-accessory small{opacity:.65;margin-left:auto}
.om-feature-diff{display:grid;grid-template-columns:1fr 1fr;gap:10px}.om-feature-diff label{min-width:0}
.om-feature-notice{padding:10px;border-radius:8px;background:rgba(230,167,75,.12);margin:10px 0}.om-feature-error{color:#e78d78}
.om-feature-images{display:flex;gap:8px;flex-wrap:wrap}.om-feature-images img{width:90px;height:120px;object-fit:contain;border-radius:7px}
.om-feature-history{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.15)}.om-feature-history small{opacity:.65}
.om-feature-content .om-edit-foot{padding-top:12px;display:flex;gap:8px;flex-wrap:wrap}.om-feature-content .om-btn{min-height:36px}
.om-grid .om-lazy-img{transition:none!important}
#om-budget-text,#om-budget-images,#om-budget-candidates{width:100px;max-width:45%;box-sizing:border-box}
[data-om-sync-label][data-status="error"],[data-om-sync-label][data-status="conflict"]{color:#e58c55}
@media(max-width:550px){.om-feature-diff{grid-template-columns:1fr}.om-feature-content .om-btn{font-size:12px;padding:7px 9px}}
`;
