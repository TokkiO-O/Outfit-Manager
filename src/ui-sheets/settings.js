// Outfit Manager · 二改版 | 原有设置分组与配置表单
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { DEFAULT_OUTFIT_PROMPT, DEFAULT_ACCESSORY_PROMPT } from '../default-prompts.js';
// ── 穿搭管理器 · 弹出面板 / 设置 ──────────────────────

import { callChatCompletions, openModelPicker } from '../api.js';
import { fn } from '../bridge.js';
import { SHARED_CHAR_KEY, SHARED_CHAR_LABEL } from '../data.js';
import { charNameById, currentPartKey, isServerMode, load, loadCurrent, loadMeta, save, saveCurrent, saveMeta, syncActivePartitions } from '../db/index.js';
import { esc, genId, toast } from '../utils.js';
import { openCatsSheet } from './cats.js';
import { openDataHealthSheet } from './data-health.js';
import { openAllKitsSheet } from './misc-sheets.js';
import { closeSheet, createSheet } from './sheet-base.js';
import { openStyleSuggestSheet } from './style-suggest.js';
import { openTagLexiconSheet } from './tag-lexicon.js';
import { describeBackend, recheckBackend } from '../db/capabilities.js';
import { DB } from '../db/state.js';

export function getSettingsDataStats() {
    var meta = loadMeta();
    var keys = ['user:__default__'];
    (meta.presets || []).forEach(function (p) { if (p && p.partKey && keys.indexOf(p.partKey) === -1) keys.push(p.partKey); });
    (meta.charIndex || []).forEach(function (ci) { if (ci && ci.partKey && keys.indexOf(ci.partKey) === -1) keys.push(ci.partKey); });

    // Opening settings must not start loading every wardrobe just to count it.
    var part = DB.partCache[currentPartKey()], os = part && part.outfits || [], accs = part && part.accessories || [];
    return {
        ready: !!part, wardrobes: keys.length,
        outfits: os.length,
        accessories: accs.length,
        images: os.filter(function (o) { return !!o.imageData; }).length + accs.filter(function (a) { return !!a.imageData; }).length,
        presets: (meta.presets || []).length,
        storage: isServerMode() ? '服务器存储' : '本地存储'
    };
}

export function buildPromptTemplateOptions(apiVision) {
    var list = apiVision.promptTemplates || [];
    if (list.length === 0) return '<option value="">暂无模板</option>';
    return '<option value="">选择模板…</option>' + list.map(function (tpl) {
        return '<option value="' + esc(tpl.id) + '"' + (apiVision.activePromptTemplateId === tpl.id ? ' selected' : '') + '>' + esc(tpl.name || '未命名模板') + '</option>';
    }).join('');
}

export function openSettingsSheet() {
    var d = load();
    var budget = Object.assign({ maxTextTokens: 1600, maxImages: 4, maxCandidates: 3 }, loadMeta().injectionBudget || {});
    var stats = getSettingsDataStats();
    var curTheme = d.uiTheme || 'default';
    var curCols = parseInt(d.gridCols, 10) || 0;
    var themeList = [
        { id: 'sakura', name: '樱绮花笺', desc: '蕾丝珍珠 · 华丽稳妥', preview: ['#f8c0d4', '#e8a0b4', '#c4b0e0', '#fff5f8'] },
        { id: 'y2k', name: '镭光千禧', desc: '镀铬镭射 · 冰蓝亮粉', preview: ['#ff5ec8', '#5ce1ff', '#1a1030', '#a060ff'] },
        { id: 'dopamine', name: '糖果晴空', desc: '马卡龙糖果 · 果冻大圆角', preview: ['#ff6b9d', '#ffb84d', '#7c9cff', '#fff5d6'] },
        { id: 'memphis', name: '几何游园', desc: '几何撞色 · 粗黑轮廓', preview: ['#ff2d78', '#ffd600', '#3d5afe', '#00bcd4'] },
        { id: 'minimal', name: '素影衣廊', desc: '大留白 · 黑白灰细线', preview: ['#1a1a1a', '#e6e6e6', '#9a9a9a', '#f7f7f8'] }
    ];
    if (['default','rose','matcha','teal','midnight','violet','mono','cream','amber','gold','salt','ocean'].indexOf(curTheme) !== -1) {
        var mapOld = { default:'sakura', rose:'sakura', matcha:'minimal', teal:'minimal', midnight:'y2k', violet:'y2k', mono:'minimal', cream:'minimal', amber:'minimal', gold:'minimal', salt:'y2k', ocean:'y2k' };
        curTheme = mapOld[curTheme] || 'sakura';
    }
    var themeHtml = themeList.map(function (th) {
        var bars = (th.preview || []).map(function (c) {
            return '<span style="background:' + c + '"></span>';
        }).join('');
        return '<button type="button" class="om-theme-card' + (curTheme === th.id ? ' on' : '') + '" data-theme="' + th.id + '">' +
            '<div class="om-theme-card-preview" style="background:' + ((th.preview && th.preview[3]) || '#fff') + '">' + bars + '</div>' +
            '<div class="om-theme-card-name">' + th.name + '</div>' +
            '<div class="om-theme-card-desc">' + th.desc + '</div></button>';
    }).join('');
    var accentPresets = ['#e8a0b4','#ff4dc8','#ff5c5c','#ff3d7f','#5c6bc0','#5ce1ff','#ffd060','#7c6cff','#20c997','#845ef7'];
    var curAccent = d.customAccent || '';
    var accentPresetHtml = accentPresets.map(function (c) {
        return '<button type="button" class="om-accent-preset' + (curAccent.toLowerCase() === c.toLowerCase() ? ' on' : '') + '" data-accent="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
    }).join('');

    var colsHtml = [[0, '自动'], [2, '2 件'], [3, '3 件'], [4, '4 件'], [5, '5 件'], [6, '6 件']].map(function (pair) {
        return '<option value="' + pair[0] + '"' + (curCols === pair[0] ? ' selected' : '') + '>' + pair[1] + '</option>';
    }).join('');

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-sliders"></i>设置</div>',

        '<div class="om-sec-title">发送与提示词</div>',
        '<div class="om-setting-row"><label>发送给 AI 的内容类型</label><select id="om-mode">',
        '<option value="text"' + (d.mode === 'text' ? ' selected' : '') + '>仅文字描述</option>',
        '<option value="image"' + (d.mode === 'image' ? ' selected' : '') + '>仅图片</option>',
        '<option value="both"' + (d.mode === 'both' ? ' selected' : '') + '>文字 + 图片</option>',
        '</select></div>',

        '<div class="om-setting-row"><label>注入位置 <span class="om-hint">Gemini/DeepSeek 建议选\"用户消息\"</span></label><select id="om-inject-pos">',
        '<option value="system"' + (d.injectPosition === 'system' ? ' selected' : '') + '>系统提示末尾</option>',
        '<option value="context"' + (d.injectPosition === 'context' ? ' selected' : '') + '>上下文末尾</option>',
        '<option value="user"' + (d.injectPosition === 'user' || !d.injectPosition ? ' selected' : '') + '>用户消息末尾（推荐）</option>',
        '</select></div>',

        '<div class="om-sub-sec">提示词 · 用户单套 <span class="om-hint">（User选了1套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{description}} → 替换为穿搭的文字描述</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-single" rows="3">' + esc(d.singleTemplate) + '</textarea></div>',

        '<div class="om-sub-sec">提示词 · 用户衣柜 <span class="om-hint">（User选了多套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{wardrobe}} → 替换为所有已选穿搭的列表</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-multi" rows="5">' + esc(d.multiTemplate) + '</textarea></div>',

        '<div class="om-sub-sec">提示词 · 角色单套 <span class="om-hint">（角色选了1套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{description}} → 描述</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-char-single" rows="3">' + esc(d.charSingleTemplate || '【{{charName}}的穿搭】\n{{description}}') + '</textarea></div>',

        '<div class="om-sub-sec">提示词 · 角色衣柜 <span class="om-hint">（角色选了多套时生效）</span></div>',
        '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{wardrobe}} → 穿搭列表</div>',
        '<div class="om-setting-row"><textarea id="om-tpl-char-multi" rows="5">' + esc(d.charMultiTemplate || '【{{charName}}的穿搭】\n{{wardrobe}}') + '</textarea></div>',

        '<div class="om-sub-sec">提示词 · 图片补充</div>',
        '<div class="om-setting-row"><label>单套+图片</label><textarea id="om-imgprompt" rows="2">' + esc(d.imagePrompt) + '</textarea></div>',
        '<div class="om-setting-row" style="margin-top:6px"><label>衣柜+图片</label><textarea id="om-multi-imgprompt" rows="2">' + esc(d.multiImagePrompt) + '</textarea></div>',

        '<div class="om-sub-sec"><i class="fa-solid fa-wand-magic-sparkles" style="margin-right:4px"></i>描述生成 API <span class="om-hint">（用于批量生成穿搭文字描述，需要 Vision 模型）</span></div>',
        '<div class="om-setting-row"><label>API 地址</label><input type="text" id="om-api-v-endpoint" placeholder="https://api.example.com/v1" value="' + esc(d.apiVision.endpoint) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:16px;width:100%;box-sizing:border-box;font-family:inherit" autocomplete="off" autocorrect="off" /></div>',
        '<div class="om-hint" style="margin:-2px 0 8px">填写兼容接口地址、密钥和支持图片输入的模型。可拉取模型列表，也可直接手动填写。</div>',
        '<div class="om-setting-row"><label>API Key</label><input type="password" id="om-api-v-key" placeholder="填写接口密钥" value="' + esc(d.apiVision.key) + '" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:16px;width:100%;box-sizing:border-box;font-family:inherit" autocomplete="off" /></div>',
        '<div class="om-setting-row"><label>模型名称</label><div style="display:flex;gap:6px;align-items:center"><input type="text" id="om-api-v-model" placeholder="手动填写模型名称，或从列表选择" value="' + esc(d.apiVision.model) + '" style="flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:16px;box-sizing:border-box;font-family:inherit" autocomplete="off" /><button class="om-btn om-btn-outline" id="om-api-v-model-fetch" style="font-size:.75em;white-space:nowrap;padding:7px 10px;flex-shrink:0"><i class="fa-solid fa-rotate"></i> 拉取</button></div></div>',
        '<div class="om-setting-row"><label>描述生成 Prompt</label><textarea id="om-api-v-prompt" rows="3" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">' + esc(d.apiVision.prompt) + '</textarea></div>',
        '<div class="om-setting-row"><label>单品描述 Prompt <span class="om-hint">{{accCategory}} = 单品分类名</span></label><textarea id="om-api-v-acc-prompt" rows="3" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit">' + esc(d.apiVision.accPrompt || '') + '</textarea></div>',
        '<div class="om-btn-row"><button type="button" class="om-btn om-btn-outline" id="om-api-v-prompt-reset">恢复两份默认描述提示词</button></div>',
        '<div class="om-setting-row"><label>Prompt 模板</label><select id="om-api-v-template" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit">' + buildPromptTemplateOptions(d.apiVision) + '</select></div>',
        '<div class="om-btn-row" style="margin-top:6px"><button class="om-btn om-btn-outline" id="om-api-v-template-save" style="font-size:.78em;flex:1 1 110px"><i class="fa-solid fa-floppy-disk"></i> 保存当前</button><button class="om-btn om-btn-outline" id="om-api-v-template-ren" style="font-size:.78em;flex:1 1 90px"><i class="fa-solid fa-pen"></i> 重命名</button><button class="om-btn om-btn-outline" id="om-api-v-template-del" style="font-size:.78em;flex:1 1 90px"><i class="fa-solid fa-trash"></i> 删除</button></div>',
        '<div class="om-setting-row om-row-inline"><label>覆盖已有描述</label><input type="checkbox" class="om-chk" id="om-api-v-overwrite"' + (d.apiVision.overwrite ? ' checked' : '') + ' /></div>',
        '<div class="om-setting-row om-row-inline"><label>代理无法连接时允许浏览器直连</label><input type="checkbox" class="om-chk" id="om-api-direct"' + (d.apiVision.allowDirectFallback ? ' checked' : '') + ' /></div>',
        '<div class="om-btn-row" style="margin-top:6px"><button class="om-btn om-btn-outline" id="om-api-v-test" style="font-size:.8em"><i class="fa-solid fa-flask-vial"></i> 测试连接</button></div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">外观主题</div>',
        '<div class="om-hint" style="margin-bottom:8px">主题改变背景、按钮、圆角与配饰色，不只换强调色</div>',
        '<div class="om-theme-cards">' + themeHtml + '</div>',
        '<div class="om-setting-row" style="margin-top:10px"><label>强调色微调</label>' +
        '<div class="om-accent-panel" style="flex:1">' +
        '<div class="om-accent-presets">' + accentPresetHtml + '</div>' +
        '<div class="om-accent-row">' +
        '<input type="color" id="om-custom-accent" value="' + esc(d.customAccent || '#e8a0b4') + '" title="取色" />' +
        '<input type="text" class="om-accent-hex" id="om-custom-accent-hex" value="' + esc(d.customAccent || '') + '" placeholder="#hex" maxlength="7" />' +
        '<button type="button" class="om-btn om-btn-outline" id="om-custom-accent-clear" style="font-size:.72em;padding:4px 8px">重置</button>' +
        '</div></div></div>',
        '<div class="om-setting-row"><label>每行显示</label><select id="om-grid-cols">' + colsHtml + '</select></div>',
        '<div class="om-hint">多选：框选/滑动 · 电脑快捷键 B 多选 · R 随机 · Esc 关闭</div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">智能工具</div>',
        '<div class="om-setting-row" style="gap:7px">',
        '<button class="om-btn om-btn-outline" id="om-style-suggest" style="width:100%;text-align:left"><i class="fa-solid fa-wand-magic-sparkles" style="margin-right:7px"></i>搭配建议（按季节/场景）…</button>',
        '<button class="om-btn om-btn-outline" id="om-tag-lexicon" style="width:100%;text-align:left"><i class="fa-solid fa-tags" style="margin-right:7px"></i>标签词库（合并/重命名）…</button>',
        '<button class="om-btn om-btn-outline" id="om-all-kits" style="width:100%;text-align:left"><i class="fa-solid fa-layer-group" style="margin-right:7px"></i>全部套装…</button>',
        '<button class="om-btn om-btn-outline" id="om-data-health" style="width:100%;text-align:left"><i class="fa-solid fa-stethoscope" style="margin-right:7px"></i>数据体检…</button>',
        '</div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">分类与数据</div>',
        '<div class="om-sub-sec">分类整理</div>',
        '<div class="om-setting-row" style="gap:7px">',
        '<button class="om-btn om-btn-outline" id="om-open-cats" style="width:100%;text-align:left"><i class="fa-solid fa-tags" style="margin-right:7px"></i>穿搭分类管理…</button>',
        '<button class="om-btn om-btn-outline" id="om-open-acc-cats" style="width:100%;text-align:left"><i class="fa-solid fa-gem" style="margin-right:7px"></i>单品分类管理…</button>',
        '</div>',

        '<div class="om-sub-sec">备份与数据</div>',
        '<div class="om-storage-info">' + (stats.ready ? '当前衣柜：' + stats.outfits + ' 套穿搭 / ' + stats.accessories + ' 件单品 / ' + stats.images + ' 张图片' : '当前衣柜尚未载入') + '<br>共 ' + stats.wardrobes + ' 个衣柜 / ' + stats.presets + ' 个预设 / ' + stats.storage + '</div>',
        '<div class="om-btn-row" style="margin-top:8px">',
        '<button class="om-btn om-btn-outline" id="om-exp"><i class="fa-solid fa-download"></i> 导出</button>',
        '<button class="om-btn om-btn-outline" id="om-imp"><i class="fa-solid fa-upload"></i> 导入</button>',
        '<button class="om-btn om-btn-danger" id="om-clear">清空穿搭</button>',
        '</div>',

        '<div class="om-divider"></div>',
        '<div class="om-sec-title">入口与悬浮球</div>',
        '<div class="om-setting-row"><label>入口显示</label><select id="om-entry-mode">' +
        '<option value="both"' + ((d.entryMode || 'both') === 'both' ? ' selected' : '') + '>侧栏 + 悬浮球</option>' +
        '<option value="fab"' + (d.entryMode === 'fab' ? ' selected' : '') + '>仅悬浮球</option>' +
        '<option value="sidebar"' + (d.entryMode === 'sidebar' ? ' selected' : '') + '>仅侧栏</option>' +
        '</select></div>',
        '<div class="om-hint" style="margin:-4px 0 8px">其它扩展弹窗打开时会自动隐藏悬浮球，避免挡操作</div>',
        '<div class="om-setting-row om-row-inline"><label>显示悬浮球</label><input type="checkbox" class="om-chk" id="om-show-ball"' + (d.showBall !== false && d.entryMode !== 'sidebar' ? ' checked' : '') + ' /></div>',
        '<div class="om-sub-sec">悬浮球自定义</div>',
        '<div class="om-field"><label>自定义图片 <span class="om-hint">支持 gif 动图、透明底 png</span></label>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<div id="om-fab-preview" style="width:48px;height:48px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        (d.fabImage ? '<img src="' + d.fabImage + '" style="width:100%;height:100%;object-fit:contain;" />' : '<div style="width:100%;height:100%;border-radius:50%;background:var(--SmartThemeQuoteColor,#7c6daf);display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-shirt" style="color:#fff;font-size:1.1em;"></i></div>') +
        '</div>' +
        '<div style="display:flex;gap:6px;flex:1;flex-wrap:wrap;">' +
        '<button class="om-btn om-btn-outline" id="om-fab-pick" style="font-size:.8em;flex:1 1 120px;"><i class="fa-solid fa-image"></i> 选择图片</button>' +
        '<button class="om-btn om-btn-outline" id="om-fab-reset" style="font-size:.8em;flex:1 1 120px;' + (d.fabImage ? '' : 'opacity:.35;pointer-events:none;') + '"><i class="fa-solid fa-rotate-left"></i> 恢复默认</button>' +
        '</div>' +
        '<input type="file" id="om-fab-file" accept="image/*" style="display:none" />' +
        '</div></div>',
        '<div class="om-field"><label>悬浮球大小：<span id="om-fab-size-val">' + (d.fabSize || 38) + 'px</span></label>' +
        '<input type="range" id="om-fab-size" min="28" max="64" value="' + (d.fabSize || 38) + '" style="width:100%;accent-color:var(--SmartThemeQuoteColor,#7c6daf);" /></div>',
        '<div class="om-divider"></div>',
        '<div class="om-sec-title">调试</div>',
        '<div class="om-sub-sec">注入预览与内容预算</div>',
        '<button type="button" class="om-btn om-btn-outline" id="om-debug-preview">查看注入预览</button>',
        '<p class="om-hint">限制每次发送的穿搭内容，保存后对下次生成生效。</p>',
        '<div class="om-setting-row"><label for="om-budget-text">文字上限（约 token）</label><input type="number" id="om-budget-text" min="100" max="32000" value="' + budget.maxTextTokens + '"></div>',
        '<div class="om-setting-row"><label for="om-budget-images">图片上限</label><input type="number" id="om-budget-images" min="0" max="12" value="' + budget.maxImages + '"></div>',
        '<div class="om-setting-row"><label for="om-budget-candidates">备用穿搭上限</label><input type="number" id="om-budget-candidates" min="1" max="20" value="' + budget.maxCandidates + '"></div>',
        '<label class="om-setting-row om-row-inline">附带备用穿搭文字<input type="checkbox" class="om-chk" id="om-budget-include"' + (budget.includeCandidates ? ' checked' : '') + '></label>',
        '<div class="om-sub-sec">卡顿排查</div>',
        '<button type="button" class="om-btn om-btn-outline" id="om-debug-perf">性能自检</button>',
        '<div class="om-sub-sec">保存状态与后端</div>',
        '<p class="om-hint" data-om-backend-info>' + esc(describeBackend(DB.backendInfo)) + '</p>',
        '<div class="om-debug-actions"><button type="button" class="om-btn om-btn-outline" id="om-debug-sync">保存状态 · <span data-om-sync-label></span></button><button type="button" class="om-btn om-btn-outline" id="om-debug-backend">重新检测后端</button></div>',
        '<div class="om-setting-row om-row-inline"><label>注入时显示 Toast 提示</label><input type="checkbox" class="om-chk" id="om-debug"' + (d.debug ? ' checked' : '') + ' /></div>',
    ].join(''), { compact: true, modal: true });

        // 设置页：折叠分组 + 电脑端左侧导航
        (function enhanceSettingsLayout() {
            var content = sheet.querySelector('.om-sheet-content');
            if (!content) return;
            var kids = Array.prototype.slice.call(content.children);
            var sections = [];
            var cur = null;
            kids.forEach(function (el) {
                if (el.classList && el.classList.contains('om-sheet-title')) return;
                if (el.classList && el.classList.contains('om-sec-title')) {
                    cur = { title: el, nodes: [] };
                    sections.push(cur);
                    return;
                }
                if (el.classList && el.classList.contains('om-divider')) {
                    // 分隔线留在当前分组内，不能断开否则后续块会露在布局外
                    if (cur) cur.nodes.push(el);
                    return;
                }
                if (cur) cur.nodes.push(el);
            });
            if (!sections.length) return;
            var layout = document.createElement('div');
            layout.className = 'om-settings-layout';
            var nav = document.createElement('div');
            nav.className = 'om-settings-nav';
            var main = document.createElement('div');
            main.className = 'om-settings-main';
            sections.forEach(function (sec, i) {
                var titleText = (sec.title.textContent || '').trim() || ('分组' + (i + 1));
                var navMap = {
                    '发送与提示词': '发送与提示词',
                    '基础与发送': '发送与提示词',
                    '基础发送': '发送与提示词',
                    '外观主题': '外观主题',
                    '智能工具': '智能工具',
                    '智能与数据': '智能工具',
                    '分类与数据': '分类与数据',
                    '分类整理': '分类与数据',
                    '备份与数据': '分类与数据',
                    '悬浮球': '悬浮球',
                    '调试': '调试',
                    '调试与其它': '调试'
                };
                var navLabel = navMap[titleText] || titleText;
                if (navLabel.length > 8) navLabel = navLabel.slice(0, 8);

                var pane = document.createElement('div');
                pane.className = 'om-settings-pane' + (i === 0 ? ' on' : '');
                pane.setAttribute('data-pane', String(i));
                var box = document.createElement('div');
                box.className = 'om-set-sec' + (i === 0 ? '' : ' collapsed');
                var hd = document.createElement('button');
                hd.type = 'button';
                hd.className = 'om-set-sec-hd';
                hd.innerHTML = '<span>' + titleText + '</span><i class="fa-solid fa-chevron-down chev"></i>';
                var bd = document.createElement('div');
                bd.className = 'om-set-sec-bd';
                sec.title.style.display = 'none';
                bd.appendChild(sec.title);
                sec.nodes.forEach(function (n) { bd.appendChild(n); });
                box.appendChild(hd);
                box.appendChild(bd);
                pane.appendChild(box);
                main.appendChild(pane);
                hd.addEventListener('click', function () {
                    box.classList.toggle('collapsed');
                });
                var navBtn = document.createElement('button');
                navBtn.type = 'button';
                navBtn.className = 'om-settings-nav-btn' + (i === 0 ? ' on' : '');
                navBtn.textContent = navLabel;
                navBtn.addEventListener('click', function () {
                    main.querySelectorAll('.om-settings-pane').forEach(function (p) { p.classList.remove('on'); });
                    nav.querySelectorAll('.om-settings-nav-btn').forEach(function (b) { b.classList.remove('on'); });
                    pane.classList.add('on');
                    navBtn.classList.add('on');
                    box.classList.remove('collapsed');
                });
                nav.appendChild(navBtn);
            });
            // remove dividers left in content
            Array.prototype.slice.call(content.querySelectorAll('.om-divider')).forEach(function (d) {
                if (d.parentNode === content) d.parentNode.removeChild(d);
            });
            layout.appendChild(nav);
            layout.appendChild(main);
            content.appendChild(layout);
            // 收走仍留在 content 里的残留块（避免永远露在顶上）
            Array.prototype.slice.call(content.children).forEach(function (el) {
                if (el === layout) return;
                if (el.classList && el.classList.contains('om-sheet-title')) return;
                if (main.lastElementChild) {
                    var bd = main.lastElementChild.querySelector('.om-set-sec-bd');
                    if (bd) bd.appendChild(el);
                }
            });
        })();

        sheet.querySelectorAll('.om-theme-card').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var theme = btn.dataset.theme || 'sakura';
            var m = loadMeta();
            m.uiTheme = theme;
            m.customAccent = ''; // 完整主题优先，清掉强调色覆盖
            saveMeta(m);
            sheet.querySelectorAll('.om-theme-card').forEach(function (b) { b.classList.toggle('on', b === btn); });
            sheet.querySelectorAll('.om-accent-preset').forEach(function (b) { b.classList.remove('on'); });
            var hexInp = sheet.querySelector('#om-custom-accent-hex');
            if (hexInp) hexInp.value = '';
            if (fn.applyUiPrefsToOverlay) fn.applyUiPrefsToOverlay();
            var nm = (btn.querySelector('.om-theme-card-name') || {}).textContent || theme;
            toast('已切换完整主题：' + nm);
        });
    });
    function setCustomAccent(val) {
        var m = loadMeta();
        m.customAccent = val || '';
        saveMeta(m);
        var colorInp = sheet.querySelector('#om-custom-accent');
        var hexInp = sheet.querySelector('#om-custom-accent-hex');
        if (colorInp && val) colorInp.value = val;
        if (hexInp) hexInp.value = val || '';
        sheet.querySelectorAll('.om-accent-preset').forEach(function (b) {
            b.classList.toggle('on', !!(val && b.getAttribute('data-accent').toLowerCase() === String(val).toLowerCase()));
        });
        if (fn.applyUiPrefsToOverlay) fn.applyUiPrefsToOverlay();
    }
    sheet.querySelectorAll('.om-accent-preset').forEach(function (btn) {
        btn.addEventListener('click', function () {
            setCustomAccent(btn.getAttribute('data-accent'));
            toast('已应用推荐色');
        });
    });
    var accentInp = sheet.querySelector('#om-custom-accent');
    if (accentInp) accentInp.addEventListener('input', function () {
        setCustomAccent(this.value || '');
    });
    var accentHex = sheet.querySelector('#om-custom-accent-hex');
    if (accentHex) accentHex.addEventListener('change', function () {
        var v = (this.value || '').trim();
        if (v && v.charAt(0) !== '#') v = '#' + v;
        if (v && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
            toast('颜色格式应为 #RRGGBB', true);
            return;
        }
        setCustomAccent(v);
    });
    var accentClr = sheet.querySelector('#om-custom-accent-clear');
    if (accentClr) accentClr.addEventListener('click', function () {
        setCustomAccent('');
        toast('已恢复主题默认色');
    });
    var sugBtn = sheet.querySelector('#om-style-suggest');
    if (sugBtn) sugBtn.addEventListener('click', function () { openStyleSuggestSheet(); });
    var tagLexBtn = sheet.querySelector('#om-tag-lexicon');
    if (tagLexBtn) tagLexBtn.addEventListener('click', function () { openTagLexiconSheet(); });
    var kitsBtn = sheet.querySelector('#om-all-kits');
    if (kitsBtn) kitsBtn.addEventListener('click', function () { openAllKitsSheet(); });
    var healthBtn = sheet.querySelector('#om-data-health');
    if (healthBtn) healthBtn.addEventListener('click', function () { openDataHealthSheet(); });
    var gridColsSel = sheet.querySelector('#om-grid-cols');
    if (gridColsSel) gridColsSel.addEventListener('change', function () {
        var m = loadMeta();
        m.gridCols = parseInt(this.value, 10) || 0;
        saveMeta(m);
        if (fn.applyUiPrefsToOverlay) fn.applyUiPrefsToOverlay();
        if (fn.renderGrid) fn.renderGrid();
        toast(m.gridCols ? ('每行 ' + m.gridCols + ' 件') : '每行自动');
    });
    sheet.querySelector('#om-mode').addEventListener('change', function () { var m = loadMeta(); m.mode = this.value; saveMeta(m); });
    sheet.querySelector('#om-inject-pos').addEventListener('change', function () { var m = loadMeta(); m.injectPosition = this.value; saveMeta(m); });
    sheet.querySelector('#om-tpl-single').addEventListener('input', function () { var m = loadMeta(); m.singleTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-tpl-multi').addEventListener('input', function () { var m = loadMeta(); m.multiTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-tpl-char-single').addEventListener('input', function () { var m = loadMeta(); m.charSingleTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-tpl-char-multi').addEventListener('input', function () { var m = loadMeta(); m.charMultiTemplate = this.value; saveMeta(m); });
    sheet.querySelector('#om-imgprompt').addEventListener('input', function () { var m = loadMeta(); m.imagePrompt = this.value; saveMeta(m); });
    sheet.querySelector('#om-multi-imgprompt').addEventListener('input', function () { var m = loadMeta(); m.multiImagePrompt = this.value; saveMeta(m); });

    // API Vision 配置
    sheet.querySelector('#om-api-direct').addEventListener('change', function () { var m = loadMeta(); m.apiVision.allowDirectFallback = this.checked; saveMeta(m); });
    sheet.querySelector('#om-api-v-endpoint').addEventListener('input', function () { var m = loadMeta(); m.apiVision.endpoint = this.value.trim(); saveMeta(m); });
    sheet.querySelector('#om-api-v-key').addEventListener('input', function () { var m = loadMeta(); m.apiVision.key = this.value.trim(); saveMeta(m); });
    sheet.querySelector('#om-api-v-model').addEventListener('input', function () { var m = loadMeta(); m.apiVision.model = this.value.trim(); saveMeta(m); });
    sheet.querySelector('#om-api-v-prompt').addEventListener('input', function () { var m = loadMeta(); m.apiVision.prompt = this.value; saveMeta(m); });
    sheet.querySelector('#om-api-v-acc-prompt').addEventListener('input', function () { var m = loadMeta(); m.apiVision.accPrompt = this.value; saveMeta(m); });
    sheet.querySelector('#om-api-v-prompt-reset').addEventListener('click', function () {
        var m = loadMeta();
        m.apiVision.prompt = DEFAULT_OUTFIT_PROMPT;
        m.apiVision.accPrompt = DEFAULT_ACCESSORY_PROMPT;
        m.apiVision.activePromptTemplateId = null;
        saveMeta(m);
        sheet.querySelector('#om-api-v-prompt').value = m.apiVision.prompt;
        sheet.querySelector('#om-api-v-acc-prompt').value = m.apiVision.accPrompt;
        sheet.querySelector('#om-api-v-template').value = '';
        toast('已恢复两份默认描述提示词；不会调用 API');
    });
    sheet.querySelector('#om-api-v-overwrite').addEventListener('change', function () { var m = loadMeta(); m.apiVision.overwrite = this.checked; saveMeta(m); });

    function refreshPromptTemplateSelect() {
        var m = loadMeta();
        var sel = sheet.querySelector('#om-api-v-template');
        if (sel) sel.innerHTML = buildPromptTemplateOptions(m.apiVision);
    }
    function findPromptTemplate(apiVision, id) {
        var list = apiVision.promptTemplates || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }
    sheet.querySelector('#om-api-v-template').addEventListener('change', function () {
        var id = this.value;
        if (!id) return;
        var m = loadMeta();
        var tpl = findPromptTemplate(m.apiVision, id);
        if (!tpl) { toast('模板不存在', true); refreshPromptTemplateSelect(); return; }
        m.apiVision.prompt = tpl.prompt || '';
        m.apiVision.accPrompt = tpl.accPrompt || '';
        m.apiVision.activePromptTemplateId = tpl.id;
        saveMeta(m);
        sheet.querySelector('#om-api-v-prompt').value = m.apiVision.prompt;
        sheet.querySelector('#om-api-v-acc-prompt').value = m.apiVision.accPrompt;
        toast('已切换到模板「' + (tpl.name || '未命名模板') + '」');
    });
    sheet.querySelector('#om-api-v-template-save').addEventListener('click', function () {
        var m = loadMeta();
        if (!Array.isArray(m.apiVision.promptTemplates)) m.apiVision.promptTemplates = [];
        var defaultName = '模板' + (m.apiVision.promptTemplates.length + 1);
        var name = prompt('模板名称：', defaultName);
        if (!name || !name.trim()) return;
        var tpl = {
            id: 'pt_' + genId(),
            name: name.trim(),
            prompt: sheet.querySelector('#om-api-v-prompt').value,
            accPrompt: sheet.querySelector('#om-api-v-acc-prompt').value
        };
        m.apiVision.prompt = tpl.prompt;
        m.apiVision.accPrompt = tpl.accPrompt;
        m.apiVision.promptTemplates.push(tpl);
        m.apiVision.activePromptTemplateId = tpl.id;
        saveMeta(m);
        refreshPromptTemplateSelect();
        toast('已保存 Prompt 模板');
    });
    sheet.querySelector('#om-api-v-template-ren').addEventListener('click', function () {
        var m = loadMeta();
        var id = sheet.querySelector('#om-api-v-template').value || m.apiVision.activePromptTemplateId;
        var tpl = findPromptTemplate(m.apiVision, id);
        if (!tpl) { toast('请先选择模板', true); return; }
        var name = prompt('重命名模板：', tpl.name || '未命名模板');
        if (!name || !name.trim()) return;
        tpl.name = name.trim();
        saveMeta(m);
        refreshPromptTemplateSelect();
        toast('已重命名模板');
    });
    sheet.querySelector('#om-api-v-template-del').addEventListener('click', function () {
        var m = loadMeta();
        var id = sheet.querySelector('#om-api-v-template').value || m.apiVision.activePromptTemplateId;
        var tpl = findPromptTemplate(m.apiVision, id);
        if (!tpl) { toast('请先选择模板', true); return; }
        if (!confirm('删除 Prompt 模板「' + (tpl.name || '未命名模板') + '」？\n当前 Prompt 内容不会被清空。')) return;
        m.apiVision.promptTemplates = (m.apiVision.promptTemplates || []).filter(function (t) { return t.id !== id; });
        if (m.apiVision.activePromptTemplateId === id) m.apiVision.activePromptTemplateId = null;
        saveMeta(m);
        refreshPromptTemplateSelect();
        toast('已删除模板');
    });

    sheet.querySelector('#om-api-v-test').addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) { toast('请先填写 API 地址、Key 和模型名称', true); return; }
        toast('正在测试（经酒馆服务端代理）…');
        callChatCompletions(m.apiVision, [{ role: 'user', content: '只回复OK' }], 16, function (err) {
            if (err) toast('❌ 连接失败：' + err, true);
            else toast('✅ 描述 API 连接成功！');
        });
    });
    // Vision 模型拉取按钮
    var vModelFetch = sheet.querySelector('#om-api-v-model-fetch');
    if (vModelFetch) vModelFetch.addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key) { toast('请先填写 API 地址和 Key', true); return; }
        openModelPicker(m.apiVision, function (model) {
            var m2 = loadMeta(); m2.apiVision.model = model; saveMeta(m2);
            var inp = sheet.querySelector('#om-api-v-model'); if (inp) inp.value = model;
        });
    });

    var entrySel = sheet.querySelector('#om-entry-mode');
    if (entrySel) entrySel.addEventListener('change', function () {
        var m = loadMeta();
        m.entryMode = this.value || 'both';
        // 与 entryMode 同步 showBall
        if (m.entryMode === 'sidebar') m.showBall = false;
        else if (m.entryMode === 'fab') m.showBall = true;
        else m.showBall = true;
        saveMeta(m);
        var ballChk = sheet.querySelector('#om-show-ball');
        if (ballChk) ballChk.checked = m.showBall !== false && m.entryMode !== 'sidebar';
        var oldFab = document.getElementById('om-fab-main'); if (oldFab && oldFab.parentNode) oldFab.parentNode.removeChild(oldFab);
        if (m.showBall !== false && m.entryMode !== 'sidebar' && fn.injectFab) fn.injectFab();
        if (fn.injectBtn) fn.injectBtn();
        toast(m.entryMode === 'sidebar' ? '仅侧栏入口' : (m.entryMode === 'fab' ? '仅悬浮球' : '侧栏 + 悬浮球'));
    });
    sheet.querySelector('#om-show-ball').addEventListener('change', function () {
        var m = loadMeta();
        m.showBall = this.checked;
        if (!this.checked && m.entryMode === 'fab') m.entryMode = 'sidebar';
        if (this.checked && m.entryMode === 'sidebar') m.entryMode = 'both';
        saveMeta(m);
        var oldFab = document.getElementById('om-fab-main'); if (oldFab && oldFab.parentNode) oldFab.parentNode.removeChild(oldFab);
        if (m.showBall && m.entryMode !== 'sidebar' && fn.injectFab) fn.injectFab();
    });

    // 悬浮球自定义
    var fabFileInp = sheet.querySelector('#om-fab-file');
    var fabResetBtn = sheet.querySelector('#om-fab-reset');
    function updateFabPreview(imgSrc) {
        var prev = sheet.querySelector('#om-fab-preview');
        if (imgSrc) {
            prev.innerHTML = '<img src="' + imgSrc + '" style="width:100%;height:100%;object-fit:contain;" />';
            fabResetBtn.style.opacity = ''; fabResetBtn.style.pointerEvents = '';
        } else {
            prev.innerHTML = '<div style="width:100%;height:100%;border-radius:50%;background:var(--SmartThemeQuoteColor,#7c6daf);display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-shirt" style="color:#fff;font-size:1.1em;"></i></div>';
            fabResetBtn.style.opacity = '.35'; fabResetBtn.style.pointerEvents = 'none';
        }
    }
    function refreshFab() {
        var oldFab = document.getElementById('om-fab-main'); if (oldFab) oldFab.parentNode.removeChild(oldFab);
        var m = loadMeta(); if (m.showBall !== false && fn.injectFab) fn.injectFab();
    }
    sheet.querySelector('#om-fab-pick').addEventListener('click', function () { fabFileInp.click(); });
    fabFileInp.addEventListener('change', function () {
        var file = fabFileInp.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            var dataUrl = e.target.result;
            // 不压缩：保留透明底 PNG 和 GIF 动画
            var m = loadMeta(); m.fabImage = dataUrl; saveMeta(m);
            updateFabPreview(dataUrl);
            refreshFab();
            toast('✨ 悬浮球已更新');
        };
        reader.readAsDataURL(file);
    });
    fabResetBtn.addEventListener('click', function () {
        var m = loadMeta(); m.fabImage = ''; saveMeta(m);
        updateFabPreview('');
        refreshFab();
        toast('悬浮球已恢复默认');
    });
    sheet.querySelector('#om-fab-size').addEventListener('input', function () {
        sheet.querySelector('#om-fab-size-val').textContent = this.value + 'px';
        var m = loadMeta(); m.fabSize = parseInt(this.value); saveMeta(m);
        refreshFab();
    });
    sheet.querySelector('#om-debug').addEventListener('change', function () { var m = loadMeta(); m.debug = this.checked; saveMeta(m); });
    function saveBudget() {
        var m = loadMeta();
        function number(id, fallback, min, max) {
            var input = sheet.querySelector(id), value = input.value === '' ? fallback : Number(input.value);
            value = Math.floor(Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback)));
            input.value = value; return value;
        }
        m.injectionBudget = { maxTextTokens: number('#om-budget-text', 1600, 100, 32000), maxImages: number('#om-budget-images', 4, 0, 12),
            maxCandidates: number('#om-budget-candidates', 3, 1, 20), includeCandidates: sheet.querySelector('#om-budget-include').checked };
        saveMeta(m);
    }
    sheet.querySelectorAll('[id^="om-budget-"]').forEach(function (el) { el.addEventListener('change', saveBudget); });
    sheet.querySelector('#om-debug-perf').onclick=function(){if(fn.openPerfSheet)fn.openPerfSheet();};
    sheet.querySelector('#om-debug-preview').onclick = function () { if (fn.openInjectionPreview) fn.openInjectionPreview(); };
    sheet.querySelector('#om-debug-sync').onclick = function () { if (fn.openSyncCenter) fn.openSyncCenter(); };
    sheet.querySelector('#om-debug-backend').onclick = function () {
        var control = this; control.disabled = true; control.textContent = '正在检测…';
        recheckBackend().then(function () {
            control.disabled = false; control.textContent = '重新检测后端';
            if (fn.refreshSyncBadge) fn.refreshSyncBadge();
        });
    };
    if (fn.refreshSyncBadge) fn.refreshSyncBadge();
    sheet.querySelector('#om-exp').addEventListener('click', function () { fn.exportData(); });
    sheet.querySelector('#om-imp').addEventListener('click', function () { fn.importData(); });
    sheet.querySelector('#om-clear').addEventListener('click', function () {
        var meta = loadMeta();
        var label = meta.currentView === 'char' && meta.currentChar
            ? '「' + (meta.currentChar === SHARED_CHAR_KEY ? SHARED_CHAR_LABEL : charNameById(meta.currentChar)) + '」的穿搭'
            : 'User 的穿搭';
        if (!confirm('确定清空' + label + '？（其他数据不受影响）')) return;
        var curP = loadCurrent();
        curP.outfits = []; curP.categories = []; curP.activeIds = [];
        saveCurrent(curP);
        syncActivePartitions(currentPartKey(), []);
        closeSheet(sheet); fn.renderCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn(); toast('已清空');
    });
    sheet.querySelector('#om-open-cats').addEventListener('click', function () {
        closeSheet(sheet); openCatsSheet(false);
    });
    sheet.querySelector('#om-open-acc-cats').addEventListener('click', function () {
        closeSheet(sheet); openCatsSheet(true);
    });
}

// ── 分类管理 Bottom Sheet ─────────────────────────────────
