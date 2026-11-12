// Outfit Manager · 二改版 | 主题细节、对比度与静止显示规则
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

export var ATELIER_CSS = `
.om-overlay.om-ornate{color:var(--om-ac-body);--om-on-primary:#fff;--om-accent:var(--om-ac-primary);--om-text:var(--om-ac-body);--om-border:var(--om-ac-border-light);--om-bg-solid:var(--om-ac-content);--om-glass:var(--om-ac-paper);--om-glass-strong:var(--om-ac-paper);--om-head-bg:var(--om-ac-paper);filter:none!important}
.om-overlay.om-ornate .om-box{isolation:isolate;filter:none!important}
.om-overlay.om-ornate :is(.om-head,.om-bottombar,.om-bottom-status,.om-more-sheet,.om-sheet,.om-sheet-box,.om-modal-box,.om-card,.om-viewchip,.om-catchip,.om-catbtn,.om-filter-chip,.om-icon-btn,.om-dock-btn,.om-detail-panel,.om-btn){backdrop-filter:none!important;-webkit-backdrop-filter:none!important;animation:none!important;transition:none!important}
.om-overlay.om-ornate :is(.om-card,.om-add-card):hover{transform:none!important}
.om-overlay.om-ornate :is(.om-fs,.om-logo-sparkle,.om-logo-sparkle2,.om-lace-edge){animation:none!important}
.om-overlay.om-ornate .om-grid-area{background:transparent!important;overflow-anchor:none;filter:none!important}
.om-overlay.om-ornate .om-grid .om-lazy-img{opacity:1!important;transition:none!important;animation:none!important}
.om-overlay.om-ornate .om-card-img{background:var(--om-ac-secondary);overflow:hidden!important}
.om-overlay.om-ornate .om-card-info{background:var(--om-ac-paper)!important}
.om-overlay.om-ornate .om-card-name{color:var(--om-ac-ink)!important}
.om-overlay.om-ornate .om-card-tag{color:var(--om-ac-muted)!important}
.om-overlay.om-ornate :is(.om-sheet,.om-sheet-box,.om-modal-box,.om-more-sheet,.om-detail-panel){background-color:var(--om-ac-paper)!important;color:var(--om-ac-body)!important;filter:none!important}
.om-overlay.om-ornate :is(.om-feature-card,.om-set-sec,.om-theme-card){background:var(--om-ac-paper)!important;color:var(--om-ac-body)!important}
.om-overlay.om-ornate :is(.om-sheet-title,.om-sec-title,.om-set-sec-hd,.om-theme-card-name){color:var(--om-ac-ink)!important}
.om-overlay.om-ornate :is(.om-hint,.om-theme-card-desc){color:var(--om-ac-muted)!important}
.om-overlay.om-ornate :is(input:not([type=checkbox]):not([type=range]):not([type=color]),textarea,select){background:var(--om-ac-input)!important;color:var(--om-ac-ink)!important;border-color:var(--om-ac-border)!important;max-width:100%;caret-color:var(--om-ac-primary)}
.om-overlay.om-ornate :is(input,textarea,select):focus-visible{outline:2px solid var(--om-ac-primary);outline-offset:2px}
.om-overlay.om-ornate input[type=checkbox]{accent-color:var(--om-ac-primary)}
.om-overlay.om-ornate .om-icon-btn{opacity:1}
.om-overlay.om-ornate .om-btn{min-height:36px}
.om-overlay.om-ornate button:disabled{opacity:.45;cursor:default}
.om-overlay.om-ornate [hidden]{display:none!important}
.om-wear-label{display:inline-flex;font-size:9px;line-height:1.4;border:1px solid var(--om-ac-border);border-radius:5px;padding:2px 6px;margin-bottom:4px;color:var(--om-ac-muted);background:var(--om-ac-secondary)}
.om-wear-label.current{background:var(--om-ac-primary);color:var(--om-on-primary);border-color:var(--om-ac-primary)}
.om-status-text{flex:1;min-width:0}
.om-status-mode{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;font:inherit;font-size:11px;line-height:1;padding:7px 8px;min-height:30px;color:var(--om-ac-ink);background:var(--om-ac-paper);border:1.5px solid var(--om-ac-border);border-radius:999px;cursor:pointer}
.om-status-mode[aria-pressed=true]{color:var(--om-ac-primary);background:var(--om-ac-primary-bg);border-color:var(--om-ac-primary)}
.om-status-mode i{font-size:10px}
.om-overlay.om-ornate .om-bottom-status{gap:7px;padding:5px 9px}
.om-overlay.om-ornate .om-status-clear{font-size:10px;padding:5px 7px;color:var(--om-ac-body);background:var(--om-ac-paper);border-color:var(--om-ac-border)}
.om-overlay.om-ornate .om-current-heading{position:relative;padding-right:32px}
.om-current-heading::after{position:absolute;right:0;top:1px;display:grid;place-items:center;width:23px;height:23px;font-size:13px}
.om-line-icon{width:19px;height:19px;flex-shrink:0;color:inherit;overflow:visible}
.om-dock-primary .om-line-icon{width:25px;height:25px}
.om-more-item .om-line-icon{width:18px;height:18px}
.om-import-row{padding:12px 0;border-bottom:1px solid var(--om-ac-border);overflow-wrap:anywhere}
.om-import-row small{display:block;color:var(--om-ac-muted);margin-top:4px}

/* 樱绮花笺: porcelain pink, pearl rims, floral seals and lace. */
.om-overlay.om-ornate.om-theme-sakura{--om-ac-muted:#987386;--om-ac-paper:#fff8fb;--om-ac-content:#fff4f8;--om-ac-input:#fffafd}
.om-overlay.om-ornate.om-theme-sakura .om-box{border-radius:30px!important;box-shadow:0 0 0 2px #fff,0 0 0 5px #f6dce8,0 14px 38px #c897ad30!important}
.om-overlay.om-ornate.om-theme-sakura .om-head{background:linear-gradient(180deg,#fffafd,#fff1f7)!important}
.om-overlay.om-ornate.om-theme-sakura .om-icon-btn{background:linear-gradient(160deg,#fff,#fff0f6)!important;border:2px solid #f0d8e4!important;border-radius:50%!important;box-shadow:0 3px 0 #e8c0d0,inset 0 1px 0 #fff!important}
.om-overlay.om-ornate.om-theme-sakura .om-dock-btn{background:linear-gradient(170deg,#fff,#fff2f8)!important;border:2px solid #f0d8e4!important;border-radius:20px!important;box-shadow:0 4px 0 #e8c0d0,inset 0 1px 0 #fff!important}
.om-overlay.om-ornate.om-theme-sakura .om-dock-primary{background:linear-gradient(155deg,#fbd5e3,var(--om-ac-primary) 65%,#d69bb7)!important;border:3px solid #fff!important;border-radius:50%!important;box-shadow:0 5px 0 #cf8da7,0 8px 15px #e8a0b435!important}
.om-overlay.om-ornate.om-theme-sakura .om-bottom-status{background:linear-gradient(180deg,#fff,#fff4f9)!important;border:2px solid #f0d8e4!important;border-radius:999px!important;box-shadow:0 3px 0 #e8c0d0!important}
.om-overlay.om-ornate.om-theme-sakura .om-feature-card{border:1.5px solid #efd2e1;border-radius:16px;box-shadow:0 3px 0 #f4dce8}
.om-overlay.om-ornate.om-theme-sakura .om-current-heading::after{content:"✿";color:#cc83a5;background:#fff1f7;border:1px solid #eecbdb;border-radius:50% 50% 6px 50%}
.om-overlay.om-ornate.om-theme-sakura .om-tag-method{border-radius:18px;background:linear-gradient(160deg,#fff,#fff4f9);box-shadow:0 3px 0 #f0d3e2}
.om-overlay.om-ornate.om-theme-sakura .om-tag-stats>div{border-radius:15px;background:#fff4f9;border-bottom:2px solid #efcfdf}

/* 镭光千禧: dark digital ground, chrome capsules, holographic square seals.
   The sheen is static: no live blur, moving scanlines or pulsing glow. */
.om-overlay.om-ornate.om-theme-y2k{--om-ac-primary:#ff6acb;--om-ac-primary-hover:#ff9bdd;--om-ac-primary-active:#dc48a6;--om-ac-primary-bg:#382137;--om-ac-lavender:#5ce1ff;--om-ac-lavender-soft:#1e364c;--om-ac-ink:#eef5ff;--om-ac-body:#ccd6ef;--om-ac-muted:#a0afcf;--om-ac-border:#4c4c76;--om-ac-border-light:#494966;--om-ac-paper:#1b1b34;--om-ac-content:#0e1024;--om-ac-secondary:#242641;--om-ac-input:#24243d;--om-ac-shadow:#080b1a;--om-ac-focus:#5ce1ff;--om-btn-radius:999px;--om-card-radius:22px;--om-btn-grad:linear-gradient(120deg,#ff7bd2,#c2b4ff 48%,#7aeaff)}
.om-overlay.om-ornate.om-theme-y2k .om-box{background:radial-gradient(ellipse at 0 0,#402348 0,transparent 53%),radial-gradient(ellipse at 100% 100%,#173c4a 0,transparent 50%),#0e1024!important;border:1.5px solid #6b7199!important;border-radius:26px!important;box-shadow:inset 0 1px 0 #d8e6ff55,0 12px 35px #07091566!important}
.om-overlay.om-ornate.om-theme-y2k :is(.om-head,.om-bottombar){background:linear-gradient(120deg,#25203c,#171c32 65%,#202d40)!important;border-color:#625373!important;box-shadow:inset 0 1px 0 #d4e6ff2b!important}
.om-overlay.om-ornate.om-theme-y2k .om-head::before{content:"";height:2px;background:linear-gradient(90deg,#ff6acb,#7beaff)!important}
.om-overlay.om-ornate.om-theme-y2k .om-head::after{content:"✦  ◇  ✦";color:#83e7ff;text-shadow:none}
.om-overlay.om-ornate.om-theme-y2k .om-head-title{background:none!important;-webkit-text-fill-color:unset!important;color:#e8e9ff!important;text-shadow:1px 1px 0 #6b326e;filter:none!important;letter-spacing:.05em}
.om-overlay.om-ornate.om-theme-y2k .om-logo-svg{filter:none!important}
.om-overlay.om-ornate.om-theme-y2k #omLogoBg stop:first-child{stop-color:#ff8de2}.om-overlay.om-ornate.om-theme-y2k #omLogoBg stop:last-child{stop-color:#77dbff}
.om-overlay.om-ornate.om-theme-y2k :is(.om-icon-btn,.om-dock-btn){background:linear-gradient(155deg,#59617f 0,#363852 16%,#24273f 47%,#1c2037 70%,#3a4561 100%)!important;border:1.5px solid #9aabc2!important;border-radius:999px!important;color:#f0f6ff!important;box-shadow:inset 0 1px 1px #f1f9ff77,inset 0 -2px 0 #12182f,0 3px 0 #070b1b!important}
.om-overlay.om-ornate.om-theme-y2k .om-dock-primary{background:linear-gradient(145deg,#ffd6f1,#b6b9f6 50%,#80e6f9)!important;border:2px solid #e5efff!important;border-radius:50%!important;color:#29213e!important;box-shadow:0 4px 0 #515b91,inset 0 2px 0 #ffffffaa!important}
.om-overlay.om-ornate.om-theme-y2k :is(.om-viewchip,.om-catchip,.om-catbtn,.om-filter-chip){background:#25253f!important;border:1px solid #596080!important;color:#dce7ff!important;border-radius:999px!important;box-shadow:inset 0 1px 0 #c3e9ff20!important}
.om-overlay.om-ornate.om-theme-y2k :is(.om-viewchip.on,.om-catchip.on,.om-catbtn.on,.om-filter-chip.on){background:linear-gradient(120deg,#9f417c,#5e529d)!important;border-color:#f3a4dc!important;color:#fff!important;box-shadow:inset 0 1px 0 #ffd9f54d!important}
.om-overlay.om-ornate.om-theme-y2k .om-card{border:1.5px solid #566783!important;border-radius:22px!important;background:#1b1b34!important;box-shadow:0 5px 0 #080e20,inset 0 1px 0 #d8efff33!important}
.om-overlay.om-ornate.om-theme-y2k .om-card.on{border-color:#ff89d5!important;box-shadow:0 0 0 2px #ff89d54d,0 5px 0 #44254c!important}
.om-overlay.om-ornate.om-theme-y2k .om-card-info{background:linear-gradient(145deg,#282641,#1d2138)!important}
.om-overlay.om-ornate.om-theme-y2k .om-bottom-status{background:linear-gradient(115deg,#29243e,#1b2c40)!important;border:1.5px solid #67748e!important;border-radius:999px;box-shadow:inset 0 1px 0 #c1eaff30!important}
.om-overlay.om-ornate.om-theme-y2k .om-bottombar::before{content:"✦ · ◇ · ✦ · ◇ · ✦";color:#8ae8ff}
.om-overlay.om-ornate.om-theme-y2k :is(.om-sheet,.om-sheet-box,.om-modal-box,.om-more-sheet){background:#1b1b34!important;border:1.5px solid #657597!important;border-radius:22px!important;box-shadow:0 10px 34px #05091877,inset 0 1px 0 #c5eaff35!important}
.om-overlay.om-ornate.om-theme-y2k .om-sheet-title::before,.om-overlay.om-ornate.om-theme-y2k .om-current-heading::after{content:"✦";color:#a7eaff}
.om-overlay.om-ornate.om-theme-y2k :is(.om-sheet-box,.om-modal-box)::after{content:"◇  ✦  ◇";color:#a9dfff}
.om-overlay.om-ornate.om-theme-y2k .om-sticker-badge{background:linear-gradient(135deg,#baf3ff,#b3a7f5 48%,#ffa9df)!important;border:1px solid #f3f9ff!important;border-radius:4px!important;box-shadow:1px 2px 0 #55578f!important}
.om-overlay.om-ornate.om-theme-y2k .om-sticker-badge::after{content:"✦"!important;color:#282542!important;text-shadow:none!important}
.om-overlay.om-ornate.om-theme-y2k .om-current-heading::after{background:linear-gradient(135deg,#a4d9fb,#dd9dcd);color:#26203c;border:1px solid #e2f0ff;border-radius:4px;transform:rotate(-7deg)}
.om-overlay.om-ornate.om-theme-y2k :is(.om-btn-outline,.om-tag-method){background:linear-gradient(155deg,#3b3d59,#20263d)!important;border:1px solid #69789c!important;color:#e5efff!important;box-shadow:inset 0 1px 0 #d7edff33,0 2px 0 #0b0d20!important}
.om-overlay.om-ornate.om-theme-y2k .om-btn-safe{background:var(--om-btn-grad)!important;color:#29213e!important;border:1px solid #e1efff!important;box-shadow:0 3px 0 #4a4270!important}
.om-overlay.om-ornate.om-theme-y2k .om-feature-card{border:1px solid #575578;border-radius:17px;box-shadow:inset 0 1px 0 #b4d8f514}
.om-overlay.om-ornate.om-theme-y2k .om-tag-method{border-radius:16px!important}
.om-overlay.om-ornate.om-theme-y2k .om-tag-stats>div{border:1px solid #4d567d;background:linear-gradient(140deg,#2d2849,#21354a);border-radius:14px}

/* 糖果晴空: soft rainbow frame, plush jelly buttons, yellow ring charms. */
.om-overlay.om-ornate.om-theme-dopamine{--om-ac-primary:#ed669e;--om-ac-primary-hover:#f49abf;--om-ac-primary-active:#d64e8a;--om-ac-primary-bg:#fff0f6;--om-ac-lavender:#8e9de8;--om-ac-lavender-soft:#f0f1ff;--om-ac-ink:#684957;--om-ac-body:#775b69;--om-ac-muted:#987b86;--om-ac-border:#f2c8d9;--om-ac-border-light:#f8dce7;--om-ac-paper:#fffdfd;--om-ac-content:#fff5ed;--om-ac-secondary:#fff1e4;--om-ac-input:#fffafa;--om-ac-shadow:#f4bdd3;--om-ac-focus:#ffe492;--om-btn-radius:24px;--om-card-radius:25px;--om-btn-grad:linear-gradient(150deg,#ffc6dc,#ee8bb4 58%,#dc76a7)}
.om-overlay.om-ornate.om-theme-dopamine .om-box{background:linear-gradient(165deg,#ffe9f1 0,#fff1cb 28%,#e7f1fc 62%,#e6faef 100%) padding-box,linear-gradient(120deg,#ffc7dd,#ffe09a,#a5d6c7,#a9c8f8,#ffbcd4) border-box!important;border:4px solid transparent!important;border-radius:30px!important;box-shadow:0 12px 35px #ec94b22b!important}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-head,.om-bottombar){background:#fffafd!important;box-shadow:inset 0 1px 0 #fff!important}
.om-overlay.om-ornate.om-theme-dopamine .om-head{border-bottom:4px solid #ffe58e!important}
.om-overlay.om-ornate.om-theme-dopamine .om-head-title{color:#e96a9e!important;font-weight:800!important;background:none!important;-webkit-text-fill-color:unset!important}
.om-overlay.om-ornate.om-theme-dopamine .om-head::after{content:"♡  ·  ✧  ·  ♡";color:#efa4bf;opacity:.55;text-shadow:none}
.om-overlay.om-ornate.om-theme-dopamine .om-bottombar{border-top:4px solid #f4c3d8!important}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-icon-btn,.om-dock-btn){background:linear-gradient(160deg,#fff,#fff7fb)!important;border:2.5px solid #f6d4e2!important;border-radius:24px!important;color:#765865!important;box-shadow:0 5px 0 #f5bfd5,inset 0 1px 0 #fff,0 7px 12px #efa4bf18!important}
.om-overlay.om-ornate.om-theme-dopamine .om-icon-btn{border-radius:50%!important}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-icon-btn,.om-dock-btn):active{transform:translateY(2px)!important;box-shadow:0 2px 0 #f5bfd5!important}
.om-overlay.om-ornate.om-theme-dopamine .om-dock-primary{background:var(--om-btn-grad)!important;border:3px solid #fff!important;border-radius:50%!important;color:#fff!important;box-shadow:0 5px 0 #d681aa,inset 0 2px 0 #ffe7f2!important}
.om-overlay.om-ornate.om-theme-dopamine .om-dock-primary .om-sticker-badge{display:none!important}
.om-overlay.om-ornate.om-theme-dopamine .om-sticker-badge{background:#ffe993!important;border:2px solid #fff!important;border-radius:8px!important;box-shadow:0 2px 0 #e8bb78!important;min-width:16px;height:16px;transform:rotate(-8deg)!important}
.om-overlay.om-ornate.om-theme-dopamine .om-sticker-badge::after{content:"●"!important;font-size:9px!important;line-height:14px!important;color:#78606e!important;text-shadow:none}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-viewchip,.om-catchip,.om-catbtn,.om-filter-chip){background:linear-gradient(#fff,#fff8fb)!important;border:2px solid #f4d2df!important;border-radius:999px!important;color:#896575!important;box-shadow:0 3px 0 #f5cddd!important}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-viewchip.on,.om-catchip.on,.om-catbtn.on,.om-filter-chip.on){background:linear-gradient(#f7b4ce,#ed90b6)!important;border-color:#dd8db1!important;color:#fff!important;box-shadow:inset 0 0 0 2px #ffdce9,0 3px 0 #d994b5!important}
.om-overlay.om-ornate.om-theme-dopamine .om-card{border:2px solid #fff0f6!important;border-radius:25px!important;background:#fffdfd!important;box-shadow:0 7px 0 #f9d8e5,0 12px 20px #f2afc32b!important}
.om-overlay.om-ornate.om-theme-dopamine .om-card.on{border-color:#e88bb3!important;box-shadow:0 7px 0 #f2b2cd,0 0 0 2px #ed90b63b!important}
.om-overlay.om-ornate.om-theme-dopamine .om-card-info{border-top:0!important;padding:9px 8px!important}
.om-overlay.om-ornate.om-theme-dopamine .om-bottom-status{background:linear-gradient(#fff,#fff6fb)!important;border:2.5px solid #f0d3e0!important;border-radius:999px!important;color:#856674!important;box-shadow:0 3px 0 #efc2d5!important}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-sheet,.om-sheet-box,.om-modal-box,.om-more-sheet){background:#fffafd!important;border:2.5px solid #f5d0e0!important;border-radius:25px!important;box-shadow:0 5px 0 #f3c0d7,0 12px 32px #ba7d9630!important}
.om-overlay.om-ornate.om-theme-dopamine .om-sheet-title::before{content:"●";color:#e9b75c}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-sheet-box,.om-modal-box)::after{content:"♡  ●  ♡";color:#eba2bf}
.om-overlay.om-ornate.om-theme-dopamine .om-feature-card{border:2px solid #f7d4e3;border-radius:20px;box-shadow:0 4px 0 #fae1ec}
.om-overlay.om-ornate.om-theme-dopamine .om-current-heading::after{content:"●";background:#ffe993;color:#78606e;border:2px solid #fff;border-radius:8px;box-shadow:0 2px 0 #e8bb78;transform:rotate(-8deg)}
.om-overlay.om-ornate.om-theme-dopamine :is(.om-btn-outline,.om-tag-method){background:linear-gradient(#fff,#fff7fb)!important;border:2px solid #f5cfdf!important;color:#896173!important;box-shadow:0 3px 0 #efc1d4!important}
.om-overlay.om-ornate.om-theme-dopamine .om-btn-safe{background:var(--om-btn-grad)!important;color:#fff!important;border:2px solid #f8b9d3!important;box-shadow:0 3px 0 #d990b1!important}
.om-overlay.om-ornate.om-theme-dopamine .om-tag-method{border-radius:20px!important}
.om-overlay.om-ornate.om-theme-dopamine .om-tag-stats>div{border-radius:19px;background:#fff0f6;box-shadow:0 3px 0 #f7d7e5}
.om-overlay.om-ornate.om-theme-dopamine .om-tag-stats>div:nth-child(2){background:#fff3d4;box-shadow:0 3px 0 #f2dfac}
.om-overlay.om-ornate.om-theme-dopamine .om-tag-stats>div:nth-child(3){background:#eef0ff;box-shadow:0 3px 0 #dce0f6}

/* 几何游园: square cuts, black outlines, offset blocks and colour bars. */
.om-overlay.om-ornate.om-theme-memphis{--om-ac-primary:#e72e70;--om-ac-primary-hover:#f36397;--om-ac-primary-active:#b91d53;--om-ac-primary-bg:#fff0f5;--om-ac-lavender:#3d5afe;--om-ac-lavender-soft:#edf0ff;--om-ac-ink:#1b1c22;--om-ac-body:#36343d;--om-ac-muted:#68646c;--om-ac-border:#25262e;--om-ac-border-light:#25262e;--om-ac-paper:#fffef9;--om-ac-content:#fffbed;--om-ac-secondary:#fff2b8;--om-ac-input:#fffef9;--om-ac-shadow:#5ac9d0;--om-btn-radius:3px;--om-card-radius:5px;--om-btn-grad:#e72e70}
.om-overlay.om-ornate.om-theme-memphis .om-box{background-color:#fffbed!important;background-image:radial-gradient(circle,#27283838 1px,transparent 1.4px)!important;background-size:18px 18px!important;border:3px solid #25262e!important;border-radius:7px!important;box-shadow:6px 6px 0 #f6d343,11px 11px 0 #57c7d2!important}
.om-overlay.om-ornate.om-theme-memphis .om-head{background:#ffe16d!important;border-bottom:3px solid #25262e!important;box-shadow:none!important}
.om-overlay.om-ornate.om-theme-memphis .om-head-title{background:none!important;-webkit-text-fill-color:unset!important;color:#25262e!important;font-weight:900!important;text-shadow:none!important}
.om-overlay.om-ornate.om-theme-memphis .om-head::after{content:"▲  ●  ■  ◆";color:#25262e;opacity:.55;text-shadow:none}
.om-overlay.om-ornate.om-theme-memphis .om-bottombar{background:#fffef9!important;border-top:3px solid #25262e!important;box-shadow:none!important}
.om-overlay.om-ornate.om-theme-memphis .om-bottombar::before{content:"▲ · ● · ■ · ◆ · ▲";color:#e72e70}
.om-overlay.om-ornate.om-theme-memphis :is(.om-icon-btn,.om-dock-btn){background:#fffef9!important;color:#25262e!important;border:2.5px solid #25262e!important;border-radius:4px!important;box-shadow:3px 3px 0 #f6d343!important}
.om-overlay.om-ornate.om-theme-memphis .om-dock-primary{background:var(--om-ac-primary)!important;color:#fff!important;border:2.5px solid #25262e!important;border-radius:4px!important;box-shadow:4px 4px 0 #5268d5!important}
.om-overlay.om-ornate.om-theme-memphis :is(.om-viewchip,.om-catchip,.om-catbtn,.om-filter-chip){background:#fffef9!important;border:2px solid #25262e!important;border-radius:3px!important;color:#25262e!important;box-shadow:2px 2px 0 #61ccd3!important}
.om-overlay.om-ornate.om-theme-memphis :is(.om-viewchip.on,.om-catchip.on,.om-catbtn.on,.om-filter-chip.on){background:#445bd8!important;color:#fff!important;box-shadow:2px 2px 0 #25262e!important}
.om-overlay.om-ornate.om-theme-memphis .om-card{border:2.5px solid #25262e!important;border-radius:5px!important;box-shadow:4px 4px 0 #61ccd3!important}
.om-overlay.om-ornate.om-theme-memphis .om-card.on{border-color:#25262e!important;box-shadow:4px 4px 0 #f6d343,0 0 0 2px #e72e70!important}
.om-overlay.om-ornate.om-theme-memphis .om-card-info{border-top:2px solid #25262e}
.om-overlay.om-ornate.om-theme-memphis .om-bottom-status{border:2px solid #25262e!important;border-radius:4px!important;background:#fff9db!important;box-shadow:3px 3px 0 #f6d343!important}
.om-overlay.om-ornate.om-theme-memphis .om-status-mode{border:1.5px solid #25262e;border-radius:2px;box-shadow:1px 1px 0 #61ccd3}
.om-overlay.om-ornate.om-theme-memphis :is(.om-sheet,.om-sheet-box,.om-modal-box,.om-more-sheet){background:#fffef9!important;border:3px solid #25262e!important;border-radius:5px!important;box-shadow:5px 5px 0 #ee6e97!important}
.om-overlay.om-ornate.om-theme-memphis .om-sheet-title::before{content:"▲";color:#445bd8}
.om-overlay.om-ornate.om-theme-memphis :is(.om-sheet-box,.om-modal-box)::after{content:"▲  ●  ■";color:#25262e}
.om-overlay.om-ornate.om-theme-memphis .om-feature-card{border:2px solid #25262e;border-radius:4px;box-shadow:3px 3px 0 #61ccd3}
.om-overlay.om-ornate.om-theme-memphis .om-current-heading::after{content:"▲";background:#ffe16d;color:#25262e;border:2px solid #25262e;box-shadow:2px 2px 0 #ee6e97;transform:rotate(7deg)}
.om-overlay.om-ornate.om-theme-memphis :is(.om-btn-outline,.om-tag-method){background:#fffef9!important;border:2px solid #25262e!important;border-radius:3px!important;color:#25262e!important;box-shadow:2px 2px 0 #f6d343!important}
.om-overlay.om-ornate.om-theme-memphis .om-btn-safe{background:var(--om-ac-primary)!important;border:2px solid #25262e!important;border-radius:3px!important;color:#fff!important;box-shadow:3px 3px 0 #5268d5!important}
.om-overlay.om-ornate.om-theme-memphis .om-tag-stats>div{border:2px solid #25262e;background:#fff9da;border-radius:3px;box-shadow:2px 2px 0 #61ccd3}
.om-overlay.om-ornate.om-theme-memphis .om-sticker-badge{border:2px solid #25262e!important;box-shadow:2px 2px 0 #25262e!important;border-radius:1px!important}

/* 素影衣廊: black/white, quiet hairlines and spacious square controls. */
.om-overlay.om-ornate.om-theme-minimal{--om-ac-primary:#303330;--om-ac-primary-hover:#565b56;--om-ac-primary-active:#151815;--om-ac-primary-bg:#f0f1ee;--om-ac-lavender:#777e77;--om-ac-lavender-soft:#f1f2f0;--om-ac-ink:#292d29;--om-ac-body:#555b55;--om-ac-muted:#7d837d;--om-ac-border:#d9ddd7;--om-ac-border-light:#e4e7e1;--om-ac-paper:#fffefa;--om-ac-content:#f5f5f1;--om-ac-secondary:#f0f1ec;--om-ac-input:#fffefa;--om-ac-shadow:#e5e7e0;--om-btn-radius:5px;--om-card-radius:7px;--om-btn-grad:#303330}
.om-overlay.om-ornate.om-theme-minimal .om-box{background:#f5f5f1!important;border:1px solid #e1e4dc!important;border-radius:12px!important;box-shadow:0 10px 30px #22291e0d!important}
.om-overlay.om-ornate.om-theme-minimal :is(.om-lace-edge,.om-float-stickers,.om-sticker-badge,.om-logo-sparkle,.om-logo-ribbon){display:none!important}
.om-overlay.om-ornate.om-theme-minimal :is(.om-box,.om-head,.om-sheet-title,.om-modal-box,.om-sheet-box,.om-bottombar)::before,.om-overlay.om-ornate.om-theme-minimal :is(.om-box,.om-head,.om-modal-box,.om-sheet-box,.om-bottombar)::after{content:none!important;display:none!important}
.om-overlay.om-ornate.om-theme-minimal .om-head{background:#fffefa!important;border-bottom:1px solid #e1e4dc!important;box-shadow:none!important;padding-top:15px;padding-bottom:15px}
.om-overlay.om-ornate.om-theme-minimal .om-head-title{background:none!important;-webkit-text-fill-color:unset!important;color:#303330!important;font-weight:500!important;letter-spacing:.08em!important;text-shadow:none!important}
.om-overlay.om-ornate.om-theme-minimal .om-logo-svg{filter:grayscale(1)!important;opacity:.7}
.om-overlay.om-ornate.om-theme-minimal :is(.om-icon-btn,.om-dock-btn,.om-btn-outline){background:#fffefa!important;color:#505650!important;border:1px solid #dce0d8!important;border-radius:5px!important;box-shadow:none!important;font-weight:500!important}
.om-overlay.om-ornate.om-theme-minimal :is(.om-dock-primary,.om-btn-safe){background:var(--om-ac-primary)!important;color:#fff!important;border:1px solid var(--om-ac-primary)!important;border-radius:5px!important;box-shadow:none!important;font-weight:500!important}
.om-overlay.om-ornate.om-theme-minimal :is(.om-viewchip,.om-catchip,.om-catbtn,.om-filter-chip){background:#fffefa!important;color:#686e68!important;border:1px solid #dde1d9!important;border-radius:5px!important;box-shadow:none!important;font-weight:500!important}
.om-overlay.om-ornate.om-theme-minimal :is(.om-viewchip.on,.om-catchip.on,.om-catbtn.on,.om-filter-chip.on){background:#303330!important;color:#fff!important;border-color:#303330!important;box-shadow:none!important;font-weight:500!important}
.om-overlay.om-ornate.om-theme-minimal .om-card{background:#fffefa!important;border:1px solid #e2e5de!important;border-radius:7px!important;box-shadow:none!important}
.om-overlay.om-ornate.om-theme-minimal .om-card.on{border:1px solid #525d50!important;box-shadow:0 0 0 1px #525d50!important}
.om-overlay.om-ornate.om-theme-minimal .om-card-info{border-top:1px solid #e9ebe5;padding:12px 10px!important}
.om-overlay.om-ornate.om-theme-minimal .om-card-name{font-weight:550!important}
.om-overlay.om-ornate.om-theme-minimal .om-bottombar{background:#fffefa!important;border-top:1px solid #e1e4dc!important;box-shadow:none!important}
.om-overlay.om-ornate.om-theme-minimal .om-bottom-status{background:#f6f7f2!important;border:1px solid #e2e6dc!important;border-radius:5px!important;box-shadow:none!important}
.om-overlay.om-ornate.om-theme-minimal .om-status-mode{border-radius:3px}
.om-overlay.om-ornate.om-theme-minimal :is(.om-sheet,.om-sheet-box,.om-modal-box,.om-more-sheet){background:#fffefa!important;border:1px solid #dce0d6!important;border-radius:10px!important;box-shadow:0 12px 35px #20271d14!important}
.om-overlay.om-ornate.om-theme-minimal .om-feature-card{border:1px solid #dce0d6;border-radius:7px;box-shadow:none}
.om-overlay.om-ornate.om-theme-minimal .om-current-heading::after{content:none}
.om-overlay.om-ornate.om-theme-minimal .om-tag-method{border-radius:6px!important;background:#fffefa!important;box-shadow:none!important}
.om-overlay.om-ornate.om-theme-minimal :is(input:not([type=checkbox]):not([type=range]):not([type=color]),textarea,select){border-radius:5px!important;box-shadow:none!important;border-width:1px!important}
.om-overlay.om-ornate.om-theme-minimal .om-tag-stats>div{background:#f5f6f1;border-radius:5px;border:1px solid #e6e9e0}

/* Dark versions keep the same silhouettes and ornaments, with opaque ink/paper. */
.om-overlay.om-ornate.om-theme-sakura.om-dark{--om-ac-paper:#30212b;--om-ac-content:#21171e;--om-ac-input:#392733;--om-ac-secondary:#392734;--om-ac-ink:#f6deeb;--om-ac-body:#e9c8da;--om-ac-muted:#caadbf;--om-ac-primary:#efa9c9;--om-ac-primary-bg:#4a2e42;--om-ac-border:#745267;--om-ac-border-light:#67465c;--om-ac-shadow:#181019;--om-on-primary:#3c2331}
.om-overlay.om-ornate.om-theme-dopamine.om-dark{--om-ac-paper:#322636;--om-ac-content:#211b2b;--om-ac-input:#3e2f42;--om-ac-secondary:#493245;--om-ac-ink:#ffecf1;--om-ac-body:#f0d1df;--om-ac-muted:#ceb4c5;--om-ac-primary:#f7a2c9;--om-ac-primary-bg:#54334b;--om-ac-border:#7a566d;--om-ac-border-light:#6c4d65;--om-ac-shadow:#1b1424;--om-on-primary:#3d2335}
.om-overlay.om-ornate.om-theme-memphis.om-dark{--om-ac-paper:#252a36;--om-ac-content:#191e29;--om-ac-input:#303849;--om-ac-secondary:#384153;--om-ac-ink:#f9f4df;--om-ac-body:#e3e4ef;--om-ac-muted:#bdc5d9;--om-ac-primary:#ff83b1;--om-ac-primary-bg:#4c3047;--om-ac-border:#b8c7df;--om-ac-border-light:#a9bad5;--om-ac-shadow:#0b1220;--om-on-primary:#251f32}
.om-overlay.om-ornate.om-theme-minimal.om-dark{--om-ac-paper:#222322;--om-ac-content:#171817;--om-ac-input:#2d2e2d;--om-ac-secondary:#2e302d;--om-ac-ink:#f0f1ed;--om-ac-body:#d8dad5;--om-ac-muted:#b8bdb4;--om-ac-primary:#e1e4dc;--om-ac-primary-bg:#3b3e38;--om-ac-border:#565b52;--om-ac-border-light:#444940;--om-ac-shadow:#111410;--om-on-primary:#252922}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine,.om-theme-memphis,.om-theme-minimal) .om-box{background:var(--om-ac-content)!important;border-color:var(--om-ac-border)!important}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine,.om-theme-memphis,.om-theme-minimal) :is(.om-head,.om-bottombar,.om-bottom-status,.om-icon-btn,.om-dock-btn,.om-card,.om-sheet,.om-modal-box,.om-sheet-box,.om-more-sheet,.om-btn-outline){background:var(--om-ac-paper)!important;color:var(--om-ac-ink)!important;border-color:var(--om-ac-border)!important}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine,.om-theme-memphis,.om-theme-minimal) :is(.om-head-title,.om-logo-text){color:var(--om-ac-ink)!important}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine,.om-theme-memphis,.om-theme-minimal) :is(.om-viewchip,.om-catchip,.om-catbtn,.om-filter-chip){background:var(--om-ac-secondary)!important;color:var(--om-ac-body)!important;border-color:var(--om-ac-border)!important}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine,.om-theme-memphis,.om-theme-minimal) :is(.om-viewchip.on,.om-catchip.on,.om-catbtn.on,.om-filter-chip.on,.om-dock-primary,.om-btn-safe){background:var(--om-ac-primary)!important;color:var(--om-on-primary)!important;border-color:var(--om-ac-primary)!important}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine,.om-theme-memphis,.om-theme-minimal) :is(.om-tag-method,.om-tag-stats>div){background:var(--om-ac-secondary)!important;color:var(--om-ac-ink)!important;border-color:var(--om-ac-border)!important}
.om-overlay.om-ornate.om-dark:is(.om-theme-sakura,.om-theme-dopamine) :is(.om-icon-btn,.om-dock-btn,.om-bottom-status,.om-card,.om-tag-method,.om-tag-stats>div){box-shadow:0 3px 0 var(--om-ac-shadow),inset 0 1px 0 #ffffff16!important}
.om-overlay.om-ornate.om-dark .om-card.on{border-color:var(--om-ac-primary)!important}
.om-overlay.om-ornate.om-dark.om-theme-memphis .om-feature-card{border-color:#9aabc6}
.om-overlay.om-ornate.om-dark.om-theme-minimal .om-card-info{border-color:#3b4735}
.om-overlay.om-ornate.om-dark.om-theme-minimal .om-feature-card{border-color:#46523f}

/* Counts first; eight text rows only when expanded. */
.om-tag-workspace{padding-top:3px}
.om-tag-intro{margin:6px 0 16px}
.om-tag-methods{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:5px 0 18px}
.om-tag-method{display:flex;align-items:center;justify-content:flex-start;gap:10px;padding:13px 15px;text-align:left;font:inherit;color:var(--om-ac-body);background:var(--om-ac-paper);border:1.5px solid var(--om-ac-border);cursor:pointer}
.om-tag-method>i{font-size:20px;color:var(--om-ac-primary)}
.om-tag-method>span{font-size:14px;font-weight:700}.om-tag-method small{display:block;font-size:11px;font-weight:500;color:var(--om-ac-muted);margin-top:2px}
.om-overlay.om-ornate .om-tag-method.on{outline:2px solid var(--om-ac-primary);outline-offset:2px}
.om-tag-scope{display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:12px;margin:12px 0}
.om-tag-scope select{max-width:76%!important;flex:1;font-size:12px!important}
.om-tag-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:15px 0}
.om-tag-stats>div{padding:12px 5px;text-align:center;min-width:0}
.om-tag-stats strong{display:block;font:600 27px/1.2 Georgia,serif;color:var(--om-ac-ink)}
.om-tag-stats span{display:block;font-size:11px;margin-top:5px;color:var(--om-ac-muted)}
.om-tag-progress{font-size:12px;margin:8px 0;overflow-wrap:anywhere}.om-tag-progress:empty{display:none}
.om-tag-vision{border-top:1px solid var(--om-ac-border);padding-top:5px;margin-top:12px}
.om-tag-details{margin-top:14px}.om-tag-details>summary{font-size:12px;list-style-position:inside}
.om-tag-details>summary span{font-weight:400;color:var(--om-ac-muted)}
.om-tag-review-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0;font-size:11px}
.om-tag-review-tools label{display:flex;align-items:center;gap:8px}.om-tag-review-tools select{font-size:11px!important}.om-tag-review-tools>span{color:var(--om-ac-muted)}
.om-tag-row{padding:12px 0;border-bottom:1px solid var(--om-ac-border)}
.om-tag-row-title{display:flex;align-items:center;gap:7px;font-size:13px;overflow-wrap:anywhere}
.om-tag-row-change{display:flex;align-items:center;gap:8px;font-size:11px;margin:6px 0;color:var(--om-ac-muted);overflow-wrap:anywhere}
.om-tag-row-change strong{color:var(--om-ac-ink)}
.om-tag-row [data-tag-value]{width:100%;font-size:12px!important}
.om-tag-row .om-hint{margin:5px 0;font-size:11px}
.om-tag-footer{padding-top:16px!important;margin-top:4px}
.om-tag-footer #om-tags-apply{flex:1}.om-tag-footnote{font-size:11px;margin:10px 0 0}
@media(max-width:550px){.om-tag-methods{gap:10px}.om-tag-method{padding:11px 10px;gap:8px}.om-tag-method>i{font-size:17px}.om-tag-method>span{font-size:13px}.om-tag-stats{gap:8px}.om-tag-scope{gap:8px}.om-tag-review-tools{flex-wrap:wrap}.om-overlay.om-ornate .om-bottom-status{gap:5px;padding-left:6px;padding-right:6px}.om-status-mode{padding:6px;gap:3px;font-size:10px}.om-status-text{font-size:11px}.om-overlay.om-ornate .om-status-clear{padding:5px;font-size:9px}}
`;
