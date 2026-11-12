// Outfit Manager · 二改版 | 穿搭添加与编辑
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { generateSingleDescription } from '../api.js';
import { hydrateLocalImages } from '../db/local-images.js';
import { fn, state } from '../bridge.js';
import { ensureOutfitKits, findCatObj, getActiveKit, getCatNames, getKitAccessories, getSubCats, getViewCategories, partGetById } from '../data.js';
import { currentPartKey, load, loadCurrent, save, saveCurrent } from '../db/index.js';
import { compressImage, esc, genId, toast } from '../utils.js';
import { getPickedImageFiles, isImageFile, openImageSourcePicker } from './image-input.js';
import { closeSheet, createSheet } from './sheet-base.js';
import { getAllTagSuggestions, openTagPanel } from './tag-panel.js';

export function clearKitDraftIfOutfit(outfitId) {
    if (state.kitFocusPartKey === currentPartKey() && state.kitFocusOutfitId === outfitId) {
        state.kitFocusPartKey = null;
        state.kitFocusOutfitId = null;
        state.kitDraftAccIds = [];
        state.kitDraftSourceKitId = null;
        state.kitDraftDirty = false;
    }
}

export function buildEditKitManageHtml(outfit, part) {
    if (!outfit) return '';
    ensureOutfitKits(outfit);
    var kits = outfit.kits || [];
    var body = '';
    if (kits.length === 0) {
        body = '<div class="om-kit-empty">暂无套装</div>';
    } else {
        body = (outfit.activeKitId ? '<button class="om-btn om-btn-outline om-kit-deactivate" data-kit-action="deactivate"><i class="fa-solid fa-circle-minus"></i> 取消当前套装</button>' : '') +
        kits.map(function (kit) {
            var isActiveKit = outfit.activeKitId === kit.id;
            var accs = getKitAccessories(part, kit);
            var accHtml = accs.length === 0
                ? '<div class="om-kit-empty small">无单品</div>'
                : '<div class="om-edit-kit-accs">' + accs.map(function (acc) {
                    return '<button class="om-edit-kit-acc" data-kit-action="remove-acc" data-kit-id="' + esc(kit.id) + '" data-acc-id="' + esc(acc.id) + '" title="从套装移除">' + esc(acc.name) + '<i class="fa-solid fa-xmark"></i></button>';
                }).join('') + '</div>';
            return '<div class="om-edit-kit-row' + (isActiveKit ? ' active' : '') + '" data-kit-id="' + esc(kit.id) + '">' +
                '<div class="om-edit-kit-main">' +
                '<div class="om-edit-kit-name">' + esc(kit.name || '未命名套装') + (isActiveKit ? '<span class="om-edit-kit-active">当前</span>' : '') + '</div>' +
                '<div class="om-edit-kit-count">' + accs.length + ' 个单品</div>' +
                accHtml +
                '</div>' +
                '<div class="om-edit-kit-actions">' +
                (!isActiveKit ? '<button class="om-btn-sm" data-kit-action="activate" data-kit-id="' + esc(kit.id) + '" title="设为当前"><i class="fa-solid fa-circle-check"></i></button>' : '') +
                '<button class="om-btn-sm" data-kit-action="rename" data-kit-id="' + esc(kit.id) + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="om-btn-sm danger" data-kit-action="delete" data-kit-id="' + esc(kit.id) + '" title="删除"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
                '</div>';
        }).join('');
    }
    return '<div class="om-field" id="om-kit-manage-holder"><label>套装 / 单品 <span class="om-hint">当前穿搭</span></label>' + body + '</div>';
}

export function buildEditImageAreaHtml(outfit, part, imageData) {
    var normalPh = '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>';
    if (outfit) {
        ensureOutfitKits(outfit);
        var activeKit = getActiveKit(outfit);
        var kitAccs = activeKit ? getKitAccessories(part, activeKit) : [];
        if (activeKit && kitAccs.length > 0) {
            var mainImg = imageData
                ? '<img class="om-showcase-main-img" src="' + imageData + '" alt="' + esc(outfit.name || '穿搭') + '" />'
                : '<div class="om-imgph om-showcase-ph"><i class="fa-regular fa-image"></i><span>主体图片</span></div>';
            var accImgs = kitAccs.map(function (acc) {
                return acc.imageData
                    ? '<img class="om-showcase-acc-img" src="' + acc.imageData + '" title="' + esc(acc.name) + '" alt="' + esc(acc.name) + '" />'
                    : '<div class="om-showcase-acc-ph" title="' + esc(acc.name) + '">' + esc(acc.name) + '</div>';
            }).join('');
            return '<div class="om-showcase">' +
                '<div class="om-showcase-main">' + mainImg + '</div>' +
                '<div class="om-showcase-accs">' + accImgs + '</div>' +
                '</div>';
        }
    }
    return imageData ? '<img src="' + imageData + '" />' : normalPh;
}


export function openEditSheet(outfit, defaultCat, defaultSubCat) {
    var d = load(); // still need for tag suggestions (cross-partition)
    var curPart = loadCurrent();
    if (outfit) {
        outfit = partGetById(curPart, outfit.id) || outfit;
        ensureOutfitKits(outfit);
    }
    var editImgData = outfit ? (outfit.imageData || null) : null;
    var viewCats = curPart.categories || [];
    var catNames = getCatNames(viewCats);
    var catOpts = '<option value="">无分类</option>' +
        catNames.map(function (c) { return '<option value="' + esc(c) + '"' + (outfit && outfit.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

    // 当前选中的父分类
    var curParent = outfit ? (outfit.category || '') : (defaultCat || '');
    var curSub = outfit ? (outfit.subCategory || '') : (defaultSubCat || '');
    var subCats = curParent ? getSubCats(viewCats, curParent) : [];
    var subDisplay = subCats.length > 0 ? '' : 'display:none;';
    var subOpts = '<option value="">无子分类</option>' +
        subCats.map(function (sc) { return '<option value="' + esc(sc) + '"' + (sc === curSub ? ' selected' : '') + '>' + esc(sc) + '</option>'; }).join('');
    var kitManageHtml = outfit ? buildEditKitManageHtml(outfit, curPart) : '';
    var imageAreaHtml = buildEditImageAreaHtml(outfit, curPart, editImgData);

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-' + (outfit ? 'pen' : 'plus') + '"></i>' + (outfit ? '编辑穿搭' : '添加穿搭') + '</div>',
        '<div class="om-field"><label>穿搭名称 *</label><input type="text" id="om-dn" placeholder="如：白色蕾丝连衣裙" value="' + esc(outfit ? outfit.name : '') + '" /></div>',
        '<div class="om-field"><label>分类</label><div class="om-frow"><select id="om-dcat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field" id="om-subcat-field" style="' + subDisplay + '"><label>子分类</label><div class="om-frow"><select id="om-dsubcat">' + subOpts + '</select><button class="om-btn om-btn-outline" id="om-dnewsubcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field"><label>文字描述 <span class="om-hint">AI 注入用，越详细越好</span></label><textarea id="om-ddesc" rows="4" placeholder="如：白色蕾丝镂空连衣裙，领口略低，裙摆及膝……">' + esc(outfit ? outfit.description || '' : '') + '</textarea>' +
        '<button class="om-btn om-btn-outline" id="om-daidesc" style="font-size:.78em;margin-top:5px;align-self:flex-start"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述</button></div>',
        '<div class="om-field"><label>场景标签 <span class="om-hint">多套时 AI 据此选穿搭，如：外出 / 家居 / 睡前</span></label>',
        '<div style="display:flex;gap:6px;align-items:stretch;">',
        '<div class="om-suggest-wrap" style="flex:1"><input type="text" id="om-dscene" placeholder="外出 / 家居 / 睡前 / 运动" value="' + esc(outfit ? outfit.sceneTag || '' : '') + '" autocomplete="off" />',
        '<div class="om-suggest-list" id="om-scene-suggest" style="display:none"></div></div>',
        '<button class="om-tag-expand-btn" id="om-tag-expand"><i class="fa-solid fa-tags"></i> 管理</button>',
        '</div></div>',
        '<div class="om-field"><label>参考图片 <span class="om-hint">可选，自动压缩</span></label>',
        '<div class="om-imgarea" id="om-dimgarea">' + imageAreaHtml + '</div>',
        '<input type="file" id="om-dfile-album" accept="image/*" style="display:none" />',
        '<input type="file" id="om-dfile-any" style="display:none" />',
        '<div class="om-img-actions"><button class="om-btn om-btn-outline" id="om-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 导入图片</button>' +
        (!outfit ? '<button class="om-btn om-btn-outline" id="om-dbatch" style="font-size:.8em"><i class="fa-solid fa-images"></i> 批量导入</button>' : '') +
        (editImgData ? '<button class="om-btn om-btn-danger" id="om-dclr" style="font-size:.8em">删除图片</button>' : '') + '</div></div>',
        '<input type="file" id="om-dbatchfile-album" accept="image/*" multiple style="display:none" />',
        '<input type="file" id="om-dbatchfile-any" multiple style="display:none" />',
        kitManageHtml,
        '<div class="om-edit-foot"><button class="om-btn om-btn-outline" id="om-dcancel">取消</button><button class="om-btn om-btn-safe" id="om-dsave">保存</button></div>',
    ].join(''));

    function findKitById(target, kitId) {
        ensureOutfitKits(target);
        for (var ki = 0; ki < target.kits.length; ki++) {
            if (target.kits[ki].id === kitId) return target.kits[ki];
        }
        return null;
    }

    function refreshKitManageHolder() {
        if (!outfit) return;
        var p = loadCurrent();
        var target = partGetById(p, outfit.id);
        var holder = sheet.querySelector('#om-kit-manage-holder');
        if (!target || !holder) return;
        var scrollEl = sheet.querySelector('.om-sheet') || sheet;
        var keepTop = scrollEl.scrollTop || 0;
        ensureOutfitKits(target);
        holder.outerHTML = buildEditKitManageHtml(target, p);
        bindKitManageEvents();
        requestAnimationFrame(function () {
            scrollEl.scrollTop = keepTop;
        });
    }

    function refreshImageArea() {
        var area = sheet.querySelector('#om-dimgarea');
        if (!area) return;
        var p = loadCurrent();
        var target = outfit ? (partGetById(p, outfit.id) || outfit) : null;
        area.innerHTML = buildEditImageAreaHtml(target, p, editImgData);
        hydrateLocalImages(area);
    }

    function updateKitManage(mutator) {
        if (!outfit) return;
        var p = loadCurrent();
        var target = partGetById(p, outfit.id);
        if (!target) { toast('穿搭不存在', true); return; }
        ensureOutfitKits(target);
        var changed = mutator(target, p);
        if (changed === false) return;
        ensureOutfitKits(target);
        saveCurrent(p);
        fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn();
        refreshKitManageHolder();
        refreshImageArea();
    }

    function bindKitManageEvents() {
        var holder = sheet.querySelector('#om-kit-manage-holder');
        if (!holder) return;
        holder.querySelectorAll('[data-kit-action]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var action = btn.dataset.kitAction;
                var kitId = btn.dataset.kitId;
                if (action === 'deactivate') {
                    updateKitManage(function (target) {
                        target.activeKitId = null;
                        clearKitDraftIfOutfit(target.id);
                        toast('已取消套装');
                    });
                } else if (action === 'activate') {
                    updateKitManage(function (target) {
                        if (!findKitById(target, kitId)) return false;
                        target.activeKitId = kitId;
                        clearKitDraftIfOutfit(target.id);
                        toast('已切换套装');
                    });
                } else if (action === 'rename') {
                    updateKitManage(function (target) {
                        var kit = findKitById(target, kitId);
                        if (!kit) return false;
                        var nm = prompt('套装名称：', kit.name || '');
                        if (nm === null) return false;
                        nm = nm.trim();
                        if (!nm) { toast('名称不能为空', true); return false; }
                        kit.name = nm;
                        toast('已重命名');
                    });
                } else if (action === 'delete') {
                    updateKitManage(function (target) {
                        var kit = findKitById(target, kitId);
                        if (!kit) return false;
                        if (!confirm('删除套装「' + (kit.name || '未命名套装') + '」？')) return false;
                        target.kits = target.kits.filter(function (k) { return k.id !== kitId; });
                        if (target.activeKitId === kitId) target.activeKitId = target.kits[0] ? target.kits[0].id : null;
                        clearKitDraftIfOutfit(target.id);
                        toast('已删除套装');
                    });
                } else if (action === 'remove-acc') {
                    var accId = btn.dataset.accId;
                    updateKitManage(function (target) {
                        var kit = findKitById(target, kitId);
                        if (!kit) return false;
                        kit.accIds = (kit.accIds || []).filter(function (id) { return id !== accId; });
                        kit.disabledAccIds = (kit.disabledAccIds || []).filter(function (id) { return id !== accId; });
                        if (target.activeKitId === kitId) clearKitDraftIfOutfit(target.id);
                        toast('已从套装移除单品');
                    });
                }
            });
        });
    }
    bindKitManageEvents();

    // 设置默认分类
    if (defaultCat) {
        var sel = sheet.querySelector('#om-dcat'); if (sel) sel.value = defaultCat;
    }

    // 父分类切换时联动子分类下拉
    sheet.querySelector('#om-dcat').addEventListener('change', function () {
        var parentVal = this.value;
        var subField = sheet.querySelector('#om-subcat-field');
        var subSel = sheet.querySelector('#om-dsubcat');
        if (!parentVal) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
            return;
        }
        var dd = load();
        var subs = getSubCats(getViewCategories(dd), parentVal);
        if (subs.length === 0) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
        } else {
            subField.style.display = '';
            subSel.innerHTML = '<option value="">无子分类</option>' +
                subs.map(function (sc) { return '<option value="' + esc(sc) + '">' + esc(sc) + '</option>'; }).join('');
        }
    });

    // 场景标签建议
    var sceneInput = sheet.querySelector('#om-dscene');
    var suggestList = sheet.querySelector('#om-scene-suggest');
    var allTags = getAllTagSuggestions(d);
    function showSuggestions(val) {
        var v = val.trim().toLowerCase();
        var filtered = v ? allTags.filter(function (t) { return t.toLowerCase().indexOf(v) !== -1 && t.toLowerCase() !== v; }) : allTags;
        if (filtered.length === 0) { suggestList.style.display = 'none'; return; }
        suggestList.innerHTML = filtered.map(function (t) { return '<div class="om-suggest-item" data-val="' + esc(t) + '">' + esc(t) + '</div>'; }).join('');
        suggestList.style.display = 'block';
    }
    sceneInput.addEventListener('focus', function () { showSuggestions(this.value); });
    sceneInput.addEventListener('input', function () { showSuggestions(this.value); });
    sceneInput.addEventListener('blur', function () { setTimeout(function () { suggestList.style.display = 'none'; }, 150); });
    suggestList.addEventListener('mousedown', function (e) {
        var item = e.target.closest('.om-suggest-item');
        if (item) { sceneInput.value = item.dataset.val; suggestList.style.display = 'none'; }
    });

    // 标签管理面板按钮
    sheet.querySelector('#om-tag-expand').addEventListener('click', function () {
        openTagPanel(sceneInput);
    });

    // 图片处理
    var albumInp = sheet.querySelector('#om-dfile-album');
    var fileInp = sheet.querySelector('#om-dfile-any');
    var imgArea = sheet.querySelector('#om-dimgarea');
    function setImg(data) {
        editImgData = data;
        refreshImageArea();
        var clrOld = sheet.querySelector('#om-dclr'); var acts = sheet.querySelector('.om-img-actions');
        if (data && !clrOld && acts) {
            var b2 = document.createElement('button'); b2.className = 'om-btn om-btn-danger'; b2.id = 'om-dclr'; b2.style.fontSize = '.8em'; b2.textContent = '删除图片';
            b2.addEventListener('click', function () { setImg(null); }); acts.appendChild(b2);
        } else if (!data && clrOld) clrOld.parentNode.removeChild(clrOld);
    }
    function handleFile(f) {
        if (!isImageFile(f)) { toast('请选择图片文件', true); return; }
        var r = new FileReader(); r.onload = function (e) { compressImage(e.target.result, function (c) { setImg(c); }); }; r.readAsDataURL(f);
    }
    function bindSingleImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            var files = getPickedImageFiles(inp.files);
            if (files[0]) handleFile(files[0]);
            else if (inp.files && inp.files.length) toast('请选择图片文件', true);
            inp.value = '';
        });
    }
    function openSingleImagePicker() {
        openImageSourcePicker('导入图片', function () { albumInp.click(); }, function () { fileInp.click(); });
    }
    sheet.querySelector('#om-dpick').addEventListener('click', openSingleImagePicker);
    imgArea.addEventListener('click', openSingleImagePicker);
    bindSingleImageInput(albumInp);
    bindSingleImageInput(fileInp);
    imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
    imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
    imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer) handleFile(getPickedImageFiles(e.dataTransfer.files)[0]); });
    var clr = sheet.querySelector('#om-dclr'); if (clr) clr.addEventListener('click', function () { setImg(null); });

    // 批量导入按钮
    var batchBtn = sheet.querySelector('#om-dbatch');
    var batchAlbumInp = sheet.querySelector('#om-dbatchfile-album');
    var batchFileInp = sheet.querySelector('#om-dbatchfile-any');
    if (batchBtn) batchBtn.addEventListener('click', function () {
        openImageSourcePicker('批量导入', function () { batchAlbumInp.click(); }, function () { batchFileInp.click(); });
    });
    function bindBatchImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            var files = getPickedImageFiles(inp.files);
            if (files.length === 0) { toast('未选择图片', true); inp.value = ''; return; }
            closeSheet(sheet);
            fn.openBatchImportModal(files);
            inp.value = '';
        });
    }
    bindBatchImageInput(batchAlbumInp);
    bindBatchImageInput(batchFileInp);

    // AI 生成描述按钮
    sheet.querySelector('#om-daidesc').addEventListener('click', function () {
        var imgData = editImgData;
        if (!imgData) { toast('请先上传图片', true); return; }
        var dd = load();
        if (!dd.apiVision.endpoint || !dd.apiVision.key || !dd.apiVision.model) { toast('请先在设置中配置"描述生成 API"', true); return; }
        var btn = sheet.querySelector('#om-daidesc');
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
        var tmpOutfit = { name: sheet.querySelector('#om-dn').value || '穿搭', imageData: imgData };
        generateSingleDescription(tmpOutfit, function (err, result) {
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述';
            if (err) { toast('生成失败：' + err, true); return; }
            if (result.description) sheet.querySelector('#om-ddesc').value = result.description;
            var nameInp = sheet.querySelector('#om-dn');
            if (result.name && (!nameInp.value.trim() || nameInp.value.trim() === '穿搭')) nameInp.value = result.name;
            toast('✅ 已生成');
        });
    });

    sheet.querySelector('#om-dnewcat').addEventListener('click', function () {
        var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
        var dd = load(); var vc = getViewCategories(dd);
        var names = getCatNames(vc);
        if (names.indexOf(name) === -1) { vc.push({ name: name, children: [] }); save(dd); fn.renderCatbar(); }
        var sel = sheet.querySelector('#om-dcat'); var ex = false;
        for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
        if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
        sel.value = name;
        // 触发联动
        sel.dispatchEvent(new Event('change'));
        toast('分类「' + name + '」已添加');
    });

    // 新建子分类
    sheet.querySelector('#om-dnewsubcat').addEventListener('click', function () {
        var parentVal = sheet.querySelector('#om-dcat').value;
        if (!parentVal) { toast('请先选择父分类', true); return; }
        var scName = prompt('新子分类名称（属于「' + parentVal + '」）：'); if (!scName || !scName.trim()) return; scName = scName.trim();
        var dd = load(); var vc = getViewCategories(dd);
        var catObj = findCatObj(vc, parentVal);
        if (catObj) {
            if (!catObj.children) catObj.children = [];
            if (catObj.children.indexOf(scName) === -1) { catObj.children.push(scName); save(dd); fn.renderCatbar(); }
        }
        var subSel = sheet.querySelector('#om-dsubcat'); var ex2 = false;
        for (var j = 0; j < subSel.options.length; j++) { if (subSel.options[j].value === scName) { ex2 = true; break; } }
        if (!ex2) { var opt2 = document.createElement('option'); opt2.value = scName; opt2.textContent = scName; subSel.appendChild(opt2); }
        subSel.value = scName;
        sheet.querySelector('#om-subcat-field').style.display = '';
        toast('子分类「' + scName + '」已添加');
    });

    sheet.querySelector('#om-dcancel').addEventListener('click', function () { closeSheet(sheet); });
    sheet.querySelector('#om-dsave').addEventListener('click', function () {
        var name = sheet.querySelector('#om-dn').value.trim();
        if (!name) { toast('请输入穿搭名称', true); return; }
        var cat = sheet.querySelector('#om-dcat').value;
        var subCat = sheet.querySelector('#om-dsubcat').value;
        var desc = sheet.querySelector('#om-ddesc').value.trim();
        var scene = sheet.querySelector('#om-dscene').value.trim();
        var curP = loadCurrent();
        if (outfit) {
            // 编辑已有穿搭 - 在当前 partition 中查找
            for (var i = 0; i < curP.outfits.length; i++) {
                if (curP.outfits[i].id === outfit.id) {
                    Object.assign(curP.outfits[i], { name: name, category: cat, subCategory: subCat, description: desc, sceneTag: scene, imageData: editImgData }); break;
                }
            }
        } else {
            // 新增穿搭 - 放入当前 partition
            var newOutfit = { id: genId(), name: name, category: cat, subCategory: subCat, description: desc, sceneTag: scene, imageData: editImgData, kits: [], activeKitId: null, createdAt: Date.now() };
            curP.outfits.unshift(newOutfit);
        }
        saveCurrent(curP); closeSheet(sheet); toast('✨ 已保存：' + name); fn.renderCatbar(); fn.renderGrid(); fn.renderBottomStatus(); fn.updateBtn();
    });
}

// ── 预设 Bottom Sheet ─────────────────────────────────────
