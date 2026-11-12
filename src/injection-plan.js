// Outfit Manager · 二改版 | 穿搭文本、图片与内容预算
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { getActiveKit, getKitForCurrent, getKitAccessories } from './data.js';
import { resolveAccessorySlots } from './slots.js';
import { getWornKit, rankSceneOutfits } from './chat-state.js';

export function estimateTokens(text) {
    var value = String(text || '');
    var cjk = (value.match(/[\u2e80-\u9fff\uac00-\ud7af]/g) || []).length;
    return Math.ceil(cjk + (value.length - cjk) / 4);
}

export function trimToTokenBudget(text, budget) {
    if (estimateTokens(text) <= budget) return text;
    var characters = Array.from(text), lo = 0, hi = characters.length;
    while (lo < hi) {
        var mid = Math.ceil((lo + hi) / 2);
        if (estimateTokens(characters.slice(0, mid).join('') + '…') <= budget) lo = mid;
        else hi = mid - 1;
    }
    return characters.slice(0, lo).join('') + '…';
}

export function buildInjectionPlan(owners, meta, options) {
    options = options || {};
    var budget = Object.assign({ maxTextTokens: 1600, maxImages: 4, maxCandidates: 3, includeCandidates: false }, meta.injectionBudget || {});
    budget.maxTextTokens = Math.max(100, Math.min(32000, Number(budget.maxTextTokens) || 1600));
    budget.maxImages = Math.max(0, Math.min(12, Number(budget.maxImages) || 0));
    budget.maxCandidates = Math.max(1, Math.min(20, Number(budget.maxCandidates) || 3));
    var control = options.wardrobeControl;
    var controlTokens = control ? estimateTokens(control.text) : 0;
    if (controlTokens > budget.maxTextTokens - 100) { control = null; controlTokens = 0; }
    var textParts = [], imageGroups = [], rows = [], warnings = [], imageCount = 0;
    var useText = meta.mode === 'text' || meta.mode === 'both';
    var useImages = meta.mode === 'image' || meta.mode === 'both';
    (owners || []).forEach(function (owner) {
        var current = options.chat && options.chat.current[owner.partKey];
        var outfits = owner.outfits || [];
        var worn = current && outfits.find(function (item) { return item.id === current.outfitId; });
        var ranked = rankSceneOutfits(outfits, options.scene || '');
        var chosen = worn ? [worn] : options.chat ? [] : ranked.slice(0, budget.maxCandidates).map(function (item) { return item.outfit; });
        var candidates = worn && !control && budget.includeCandidates && !current.locked
            ? ranked.filter(function (item) { return item.outfit.id !== worn.id; }).slice(0, budget.maxCandidates).map(function (item) { return item.outfit; }) : [];
        var images = [], ownerLines = [];
        chosen.forEach(function (outfit) {
            var hidden = current && current.outfitId === outfit.id ? (current.hiddenAccIds || []) : [];
            var extra = current && current.outfitId === outfit.id ? (current.extraAccIds || []) : [];
            var kit = getKitForCurrent(outfit,current);
            var accessories = kit ? getKitAccessories(owner.partition, kit).filter(function (item) {
                return (kit.disabledAccIds || []).indexOf(item.id) === -1 && hidden.indexOf(item.id) === -1;
            }) : [];
            extra.forEach(function (id) {
                var item = (owner.partition.accessories || []).find(function (acc) { return acc.id === id; });
                if (item && hidden.indexOf(id) === -1 && !accessories.some(function (acc) { return acc.id === id; })) accessories.push(item);
            });
            var resolved = resolveAccessorySlots(accessories, meta.slotRules);
            if (resolved.conflicts.length) warnings.push(owner.name + '有互斥单品，已采用最后选中的单品。');
            var accessoryText = resolved.items.map(function (item) { return '[' + (item.category || '单品') + '] ' + (item.description || item.name || ''); }).join('\n');
            var removed = hidden.map(function (id) { return (owner.partition.accessories || []).find(function (acc) { return acc.id === id; }); }).filter(Boolean);
            var description = (outfit.description || '') + (accessoryText ? '\n' + accessoryText : '') +
                (removed.length ? '\n临时穿着状态：已摘下/脱下' + removed.map(function (item) { return item.name; }).join('、') + '。原描述涉及这些单品时，以此状态为准。' : '');
            var image = options.resolveImage ? options.resolveImage(outfit) : outfit.imageData;
            var imageReady = typeof image === 'string' && /^(data:image\/|https?:\/\/)/.test(image);
            if (useImages && outfit.imageData && !imageReady) warnings.push(outfit.name + '的图片尚未就绪，本次使用文字描述。');
            if (useText || (useImages && !imageReady)) ownerLines.push({ outfit: outfit, description: description });
            if (useImages && imageReady) {
                if (imageCount < budget.maxImages) { images.push(Object.assign({}, outfit, { imageData: image })); imageCount++; }
                else {
                    warnings.push('图片数量达到上限，' + (outfit.name || '穿搭') + '已改用文字。');
                    if (!useText) ownerLines.push({ outfit: outfit, description: description });
                }
            }
            rows.push({ owner: owner.name, partKey: owner.partKey, id: outfit.id, name: outfit.name || '穿搭', current: !!worn, locked: !!(current && current.locked), accessories: resolved.items.map(function (item) { return item.name; }) });
        });
        if (worn && current.locked) textParts.push('[' + owner.name + '] 当前穿搭已锁定，场景变化也不要自行换装。');
        if (ownerLines.length === 1) {
            textParts.push((owner.tplSingle || '[{{charName}}当前穿着]\n{{description}}')
                .replace(/\{\{charName\}\}/g, owner.name).replace('{{description}}', ownerLines[0].description));
        } else if (ownerLines.length > 1) {
            var lines = ownerLines.map(function (item, index) { return '[穿搭' + (index + 1) + '] ' + (item.outfit.sceneTag ? '【场景：' + item.outfit.sceneTag + '】' : '') + '\n' + item.description; });
            textParts.push((owner.tplMulti || '[{{charName}}的可选穿搭]\n{{wardrobe}}').replace(/\{\{charName\}\}/g, owner.name).replace('{{wardrobe}}', lines.join('\n\n')));
        }
        if (candidates.length) textParts.push('[' + owner.name + '备用穿搭，尚未换上]\n' + candidates.map(function (item) { return (item.name || '穿搭') + '（' + (item.sceneTag || '无标签') + '）：' + (item.description || ''); }).join('\n') + '\n只有确认换装后才描述为正在穿着。');
        if (images.length) imageGroups.push({ name: owner.name, outfits: images, isMulti: images.length > 1 });
    });
    if (options.wardrobeControl && !control) warnings.push('内容预算不足以发送完整候选衣柜，本次保持当前穿搭；请在调试中提高文字上限。');
    var imageBlocks = [], imageTextBudget = controlTokens;
    function imageText(value) {
        var available = Math.max(0, budget.maxTextTokens - imageTextBudget - 50);
        var text = available > 1 ? trimToTokenBudget(value, Math.min(available, Math.max(20, Math.floor(budget.maxTextTokens / 4)))) : '';
        if (text) { imageBlocks.push({ type: 'text', text: text }); imageTextBudget += estimateTokens(text); }
    }
    if (imageGroups.length > 1) imageText('=== 穿搭图片参考 ===');
    imageGroups.forEach(function (group) {
        imageText('[' + group.name + (group.isMulti ? '的可选穿搭]' : '当前穿着]'));
        group.outfits.forEach(function (outfit, index) {
            if (group.isMulti) imageText('(穿搭' + (index + 1) + ')' + (outfit.sceneTag ? ' [场景：' + outfit.sceneTag + ']' : ''));
            imageBlocks.push({ type: 'image_url', image_url: { url: outfit.imageData } });
        });
    });
    if (imageGroups.length) imageText(imageGroups.some(function (group) { return group.isMulti; }) ? meta.multiImagePrompt || '' : meta.imagePrompt || '');
    if (imageGroups.length > 1) imageText('=== 穿搭图片结束 ===');
    var text = textParts.filter(Boolean).join('\n\n---\n\n');
    var rawTokens = estimateTokens(text);
    if (rawTokens > budget.maxTextTokens - imageTextBudget) {
        text = trimToTokenBudget(text, budget.maxTextTokens - imageTextBudget);
        warnings.push('文字超过预算，已缩短。可在注入预览中调高预算或精简描述。');
    }
    if (control) text = control.text + '\n\n' + text;
    var previewText = text + (imageBlocks.length ? '\n' + imageBlocks.filter(function (block) { return block.type === 'text'; }).map(function (block) { return block.text; }).join('\n') : '');
    return { text: text, previewText: previewText, imageGroups: imageGroups, imageBlocks: imageBlocks, imageCount: imageCount, rows: rows,
        wardrobeControl: control, estimatedTextTokens: estimateTokens(text) + imageTextBudget - controlTokens, originalTextTokens: rawTokens + imageTextBudget,
        warnings: Array.from(new Set(warnings)), budget: budget };
}
