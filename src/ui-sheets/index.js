// Outfit Manager · 二改版 | 弹出面板公开入口
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { fn } from '../bridge.js';

import { openContextMenu } from './context-menu.js';
import { getAllTagSuggestions } from './tag-panel.js';
import { openEditSheet } from './edit-sheet.js';
import { openPresetsSheet } from './presets.js';
import { openSettingsSheet } from './settings.js';
import { openCatsSheet } from './cats.js';
import { createSheet, closeSheet } from './sheet-base.js';
import { openLightbox } from './lightbox.js';
import { openAccContextMenu, openAccEditSheet } from './acc-sheets.js';
import { openStyleSuggestSheet } from './style-suggest.js';
import { openDataHealthSheet } from './data-health.js';
import { openImageSlimSheet } from './image-slim.js';
import { openTagLexiconSheet } from './tag-lexicon.js';
import {
    openWearHistorySheet, openSceneRecommendSheet, openAllKitsSheet, openPerfSheet
} from './misc-sheets.js';

export { openContextMenu, openEditSheet, openPresetsSheet, openSettingsSheet, openCatsSheet };
export { openAccContextMenu, openAccEditSheet };
export {
    createSheet, closeSheet, openLightbox, getAllTagSuggestions, openWearHistorySheet,
    openSceneRecommendSheet, openStyleSuggestSheet, openDataHealthSheet, openTagLexiconSheet,
    openAllKitsSheet, openPerfSheet, openImageSlimSheet
};

export function registerSheetsFn() {
    fn.openContextMenu = openContextMenu;
    fn.openEditSheet = openEditSheet;
    fn.openAccContextMenu = openAccContextMenu;
    fn.openAccEditSheet = openAccEditSheet;
    fn.openPresetsSheet = openPresetsSheet;
    fn.openSettingsSheet = openSettingsSheet;
    fn.openCatsSheet = openCatsSheet;
    fn.openLightbox = openLightbox;
    fn.openWearHistorySheet = openWearHistorySheet;
    fn.openStyleSuggestSheet = openStyleSuggestSheet;
    fn.openDataHealthSheet = openDataHealthSheet;
    fn.openPerfSheet = openPerfSheet;
    fn.openTagLexiconSheet = openTagLexiconSheet;
    fn.openAllKitsSheet = openAllKitsSheet;
    fn.openSceneRecommendSheet = openSceneRecommendSheet;
    fn.openImageSlimSheet = openImageSlimSheet;

    fn.createSheet = createSheet;
    fn.closeSheet = closeSheet;
}
