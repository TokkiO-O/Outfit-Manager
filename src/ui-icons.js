// Outfit Manager · 二改版 | 主题图标与紧凑切换图标
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

var paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" stroke-width="3"/>',
    list: '<path d="m3 6 1.5 1.5L7 4M10 6h11M3 12h4M10 12h11M3 18h4M10 18h11"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
    more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
    shirt: '<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c0 4-8 4-8 0Z"/>',
    bulb: '<path d="M8 16a7 7 0 1 1 8 0l-1 3H9ZM9 22h6"/>',
    wand: '<path d="m4 21 13-13 3 3L7 24ZM4 3v4M2 5h4M17 1v4M15 3h4M21 16v4M19 18h4"/>',
    layers: '<path d="m12 3 10 6-10 6L2 9Zm-10 11 10 6 10-6M2 19l10 5 10-5"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7" cy="7" r="1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    undo: '<path d="m3 7 5-4M3 7l5 4M3 7h10a8 8 0 1 1-8 8"/>',
    health: '<path d="M6 3v5a6 6 0 0 0 12 0V3M4 3h4M16 3h4M12 14v2a5 5 0 0 0 10 0v-3"/><circle cx="21" cy="10" r="2"/>',
    gauge: '<path d="M3 18a10 10 0 1 1 18 0M5 15h2M17 15h2M12 5v2m0 7 5-5"/><circle cx="12" cy="15" r="2"/>',
    settings: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2" fill="var(--om-ac-paper)"/><circle cx="16" cy="12" r="2" fill="var(--om-ac-paper)"/><circle cx="10" cy="19" r="2" fill="var(--om-ac-paper)"/>'
};
paths.gem='<path d="m3 8 4-5h10l4 5-9 13ZM3 8h18M7 3l5 18 5-18"/>';
paths.masks='<path d="M3 3c3 2 6 2 9 0v8a4.5 4.5 0 0 1-9 0ZM12 7c3 2 6 2 9 0v9a4.5 4.5 0 0 1-9 0M6 8h1m2 0h1M6 12c1 1 2 1 3 0m6 0h1m2 0h1m-4 5c1-1 2-1 3 0"/>';
var map = { 'om-acc-toggle':'gem', 'om-search-toggle':'search','om-filter-toggle':'filter','om-view-toggle':'user','om-theme-toggle':'theme','om-x':'close',
    'om-random-pick':'dice','om-batch-toggle':'list','om-bottom-add':'plus','om-bottom-presets':'bookmark','om-bottom-more':'more',
    'om-chat-wardrobe-more':'shirt','om-scene-rec':'bulb','om-style-suggest-more':'wand','om-all-kits-more':'layers',
    'om-tag-lexicon-more':'tag','om-wear-hist':'clock','om-action-undo':'undo','om-data-health-more':'health','om-perf-check':'gauge','om-bottom-settings':'settings' };
export function decorateMainIcons(root, theme) {
    theme = theme || root.getAttribute('data-theme') || 'sakura';
    Object.keys(map).forEach(function (id) {
        var button = root.querySelector('#' + id);
        if (!button) return;
        var icon = button.querySelector('i'), line = button.querySelector('.om-line-icon');
        // The original solid glyphs belong to the plush and geometric themes.
        // Only minimal uses the thin-line set, and switching themes is reversible.
        if (theme !== 'minimal') {
            if (line) { var restored = document.createElement('i'); restored.className = line.getAttribute('data-original-icon') || 'fa-solid fa-shirt'; line.replaceWith(restored); }
            return;
        }
        if (!icon || line) return;
        var holder = document.createElement('span');
        var symbol = id === 'om-acc-toggle' ? button.getAttribute('data-icon') || 'gem' : id === 'om-view-toggle' && button.dataset.view === 'char' ? 'masks' : map[id];
        holder.innerHTML = '<svg class="om-line-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + paths[symbol] + '</svg>';
        holder.firstElementChild.setAttribute('data-original-icon', icon.className);
        icon.replaceWith(holder.firstElementChild);
    });
}
