// Outfit Manager · 二改版 | 批量操作与选中状态的主题适配
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var REFINEMENT_CSS = `
/* Preserve each theme's silhouette; make active text and icons explicit. */
.om-overlay.om-ornate .om-dock-btn.on>span:not(.om-sticker-badge),
.om-overlay.om-ornate .om-dock-btn.on>:is(i,svg){color:inherit!important;opacity:1!important;-webkit-text-fill-color:currentColor!important}
.om-overlay.om-ornate.om-theme-sakura .om-dock-btn.on{background:linear-gradient(160deg,#f8c8dd,#eaa4c2)!important;color:#5b2944!important;border-color:#d88eb2!important;box-shadow:0 4px 0 #ce86a6,inset 0 1px 0 #fff5fa!important}
.om-overlay.om-ornate.om-theme-y2k .om-dock-btn.on{background:linear-gradient(145deg,#ffd4f3,#c8c9ff 48%,#a1f0ff)!important;color:#29213e!important;border-color:#e6f6ff!important;box-shadow:0 3px 0 #535b8e,inset 0 1px 0 #fff!important}
.om-overlay.om-ornate.om-theme-dopamine .om-dock-btn.on{background:linear-gradient(160deg,#ffd2e3,#f2a6c5)!important;color:#633247!important;border-color:#dc82a9!important;box-shadow:0 4px 0 #de90b2,inset 0 1px 0 #fff5fa!important}
.om-overlay.om-ornate.om-theme-memphis .om-dock-btn.on{background:#3158bb!important;color:#fff!important;border-color:#202b44!important;box-shadow:3px 4px 0 #202b44!important}
.om-overlay.om-ornate.om-theme-minimal .om-dock-btn.on{background:#303330!important;color:#fff!important;border-color:#303330!important;box-shadow:none!important}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine,.om-theme-memphis,.om-theme-minimal) .om-dock-btn.on{background:var(--om-ac-primary)!important;color:var(--om-on-primary)!important;border-color:var(--om-ac-primary)!important}

/* Only the review list scrolls. The summary, pager and confirmation stay visible. */
.om-overlay .om-sheet.om-import-review{display:flex;flex-direction:column;overflow:hidden!important;max-height:88dvh!important}
.om-import-review>.om-sheet-handle{flex-shrink:0}
.om-import-review>.om-sheet-content{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding-bottom:16px}
.om-import-review .om-sheet-title{flex-shrink:0;margin-bottom:10px}
.om-import-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.om-import-content>p{flex-shrink:0;margin:4px 0 10px;font-size:12px;line-height:1.5}
.om-import-scroll{min-height:60px;max-height:46dvh;overflow:auto;overscroll-behavior:contain;padding-right:5px;scrollbar-gutter:stable}
.om-import-content :is(#om-import-pages,.om-import-footer,#om-import-save-status){flex-shrink:0}
.om-import-footer{position:relative!important;padding-top:12px!important;margin:0!important;background:var(--om-ac-paper);gap:10px}
.om-import-footer>button{flex:1}
#om-import-pages .om-debug-actions{margin:8px 0 0;justify-content:center}
#om-import-save-status:empty{display:none}
.om-overlay .om-modal-box:has(#om-model-search){display:flex;flex-direction:column;min-height:0;gap:10px;overflow:hidden}
.om-overlay .om-modal-box:has(#om-model-search)>div:has(>.om-model-item){min-height:0;flex:1;overscroll-behavior:contain}
.om-overlay .om-modal-box:has(#om-batch-start,#om-acc-batch-start){max-height:84dvh;overflow:auto}
@media(max-height:580px){.om-import-scroll{max-height:31dvh}.om-import-content>p{font-size:11px;margin-bottom:5px}.om-import-review>.om-sheet-content{padding-bottom:10px}.om-import-review .om-sheet-title{margin-bottom:6px}}
.om-overlay .om-batch-compact{overflow:hidden!important;flex-wrap:nowrap!important;gap:8px;padding:8px 12px;min-width:0}
.om-batch-compact .om-batch-info{flex-shrink:0;color:var(--om-ac-ink);font-size:12px}
.om-batch-selection{display:flex;gap:4px;flex-shrink:0}
.om-batch-menu-open{margin-left:auto;min-height:32px;font-weight:700;flex-shrink:0;color:var(--om-ac-ink)!important;border-color:var(--om-ac-border)!important;background:var(--om-ac-paper)!important}
.om-batch-menu section{margin:12px 0 16px}.om-batch-menu h3{font-size:12px;color:var(--om-ac-muted);margin:0 0 8px;font-weight:600}
.om-batch-menu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.om-batch-menu-item{display:flex;gap:9px;align-items:flex-start;text-align:left;padding:12px 10px;min-height:76px;border:1.5px solid var(--om-ac-border);border-radius:var(--om-btn-radius,12px);background:var(--om-ac-secondary);color:var(--om-ac-ink);font:inherit;cursor:pointer;min-width:0}
.om-batch-menu-item>i{margin-top:2px;font-size:15px;color:var(--om-ac-primary)}
.om-batch-menu-item>span{min-width:0}.om-batch-menu-item strong{display:block;font-size:13px;line-height:1.4;font-weight:650}.om-batch-menu-item small{display:block;font-size:11px;line-height:1.5;color:var(--om-ac-muted);margin-top:4px}
.om-batch-menu-item.danger>i{color:#b94360}.om-batch-menu .om-edit-foot{margin-top:12px;padding-top:10px}
.om-overlay.om-theme-sakura .om-batch-menu-item{border-radius:17px;box-shadow:0 3px 0 var(--om-ac-border-light);background:var(--om-ac-paper)}
.om-overlay.om-theme-y2k .om-batch-menu-item{border-radius:18px;box-shadow:inset 0 1px 0 #effaff22;background:linear-gradient(150deg,#383b58,#20243b)}
.om-overlay.om-theme-dopamine .om-batch-menu-item{border-radius:20px;box-shadow:0 3px 0 var(--om-ac-border-light);background:var(--om-ac-paper)}
.om-overlay.om-theme-memphis .om-batch-menu-item{border-radius:4px;border-width:2px;box-shadow:3px 3px 0 var(--om-ac-border)}
.om-overlay.om-theme-minimal .om-batch-menu-item{border-radius:5px;border-width:1px;background:var(--om-ac-paper)}
.om-api-confirm-count{font-size:14px;color:var(--om-ac-ink)}.om-api-confirm-count strong{font-size:32px;font-weight:700;margin-right:6px}
.om-overlay .om-progress-chip{pointer-events:auto;backdrop-filter:none!important;background:var(--om-ac-paper);color:var(--om-ac-ink);border-color:var(--om-ac-border)}
#om-classify-custom{width:100%;margin-top:6px}#om-classify-cost{font-size:13px;line-height:1.6}#om-classify-stop{font-size:11px;padding:4px 9px;min-height:28px;margin-top:6px}
@media(max-width:550px){.om-overlay .om-batch-compact{gap:6px;padding:7px 10px}.om-batch-compact .om-batch-btn{font-size:11px;padding:5px 8px}.om-batch-menu-item{padding:10px 9px;gap:7px}.om-batch-menu-grid{gap:8px}}
`;
