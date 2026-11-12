// Outfit Manager · 二改版 | 单品添加、编辑与图片描述
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { SLOT_LABELS, accessorySlot, exclusiveAccessory } from '../slots.js';
import { hydrateLocalImages } from '../db/local-images.js';

import { generateSingleAccDescription } from '../api.js';
import { fn, state } from '../bridge.js';
import { cleanAccIdFromKits, findCatObj, getCatNames, getSubCats, partGetAccById } from '../data.js';
import { currentPartKey, isServerMode, loadCurrent, loadMeta, loadPartition, saveCurrent, savePartition, uploadImage } from '../db/index.js';
import { compressImage, esc, genId, getPopupLayer, toast, mountPopup } from '../utils.js';
import { getPickedImageFiles, isImageFile, openImageSourcePicker } from './image-input.js';
import { openLightbox } from './lightbox.js';
import { closeSheet, createSheet } from './sheet-base.js';

export function openAccContextMenu(acc) {
    if (!acc) return;
    var selected = fn.draftHasAcc ? fn.draftHasAcc(acc.id) : false;
    var sheet = createSheet([
        '<div class="om-ctx-outfit-name"><i class="fa-solid fa-gem" style="margin-right:6px;opacity:.5;"></i>' + esc(acc.name) + '</div>',
        selected
            ? '<div class="om-ctx-item" id="om-accctx-wear"><i class="fa-solid fa-circle-xmark"></i>取消选择</div>'
            : '<div class="om-ctx-item" id="om-accctx-wear"><i class="fa-solid fa-circle-check"></i>选择单品</div>',
        acc.imageData ? '<div class="om-ctx-item" id="om-accctx-view"><i class="fa-solid fa-expand"></i>查看大图</div>' : '',
        '<div class="om-ctx-item" id="om-accctx-edit"><i class="fa-solid fa-pen"></i>编辑</div>',
        '<div class="om-ctx-item" id="om-accctx-move"><i class="fa-solid fa-arrow-right-arrow-left"></i>移动到…</div>',
        acc.imageData ? '<div class="om-ctx-item" id="om-accctx-aidesc"><i class="fa-solid fa-wand-magic-sparkles"></i>AI 生成描述</div>' : '',
        '<div class="om-ctx-item danger" id="om-accctx-del"><i class="fa-solid fa-trash"></i>删除</div>',
    ].join(''));

    var wearEl = sheet.querySelector('#om-accctx-wear');
    if (wearEl) wearEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (fn.toggleDraftAcc) fn.toggleDraftAcc(acc.id);
    });

    var editEl = sheet.querySelector('#om-accctx-edit');
    if (editEl) editEl.addEventListener('click', function () {
        closeSheet(sheet);
        openAccEditSheet(acc, acc.category || '');
    });

    var viewEl = sheet.querySelector('#om-accctx-view');
    if (viewEl) viewEl.addEventListener('click', function () {
        closeSheet(sheet);
        openLightbox([acc], acc.id);
    });

    var aiEl = sheet.querySelector('#om-accctx-aidesc');
    if (aiEl) aiEl.addEventListener('click', function () {
        var m = loadMeta();
        if (!m.apiVision.endpoint || !m.apiVision.key || !m.apiVision.model) {
            toast('请先在设置中配置"描述生成 API"', true); closeSheet(sheet); return;
        }
        closeSheet(sheet);
        toast('正在生成单品描述...');
        generateSingleAccDescription(acc, function (err, result) {
            if (err) { toast('生成失败：' + err, true); return; }
            var curP = loadCurrent();
            var target = partGetAccById(curP, acc.id);
            if (!target) { toast('未找到单品数据', true); return; }
            if (result.description) target.description = result.description;
            if (result.name && result.name.trim()) target.name = result.name.trim();
            saveCurrent(curP);
            fn.renderGrid();
            toast('✅ 已生成：' + target.name);
        });
    });

    var moveEl = sheet.querySelector('#om-accctx-move');
    if (moveEl) moveEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (fn.openAccMoveToPanel) {
            fn.openAccMoveToPanel([acc.id], function () {
                fn.renderAccCatbar();
                fn.renderGrid();
                fn.renderBottomStatus();
            });
        }
    });

    var delEl = sheet.querySelector('#om-accctx-del');
    if (delEl) delEl.addEventListener('click', function () {
        closeSheet(sheet);
        if (!confirm('确定删除单品「' + acc.name + '」？\n引用此单品的套装方案将自动移除该单品。')) return;
        var curP = loadCurrent();
        curP.accessories = (curP.accessories || []).filter(function (a) { return a.id !== acc.id; });
        cleanAccIdFromKits(curP, acc.id);
        if (state.kitFocusPartKey === currentPartKey()) {
            state.kitDraftAccIds = (state.kitDraftAccIds || []).filter(function (id) { return id !== acc.id; });
        }
        saveCurrent(curP);
        fn.renderAccCatbar(); fn.renderGrid(); fn.renderBottomStatus(); toast('已删除');
    });
}

// ── 单品批量导入弹窗 ─────────────────────────────────────
export function openAccBatchImportModal(files, defaultCat, defaultSubCat) {
    files = (files || []).filter(function (f) { return f && f.type && f.type.indexOf('image') === 0; });
    if (files.length === 0) { toast('未选择图片', true); return; }

    var targetPartKey = currentPartKey();
    var curP = loadPartition(targetPartKey);
    var meta = loadMeta();
    var cats = curP.accCategories || [];
    var catNames = getCatNames(cats);
    var catOpts = '<option value="">无分类</option>' +
        catNames.map(function (c) { return '<option value="' + esc(c) + '"' + (c === defaultCat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var subCats = defaultCat ? getSubCats(cats, defaultCat) : [];
    var subOpts = '<option value="">无子分类</option>' +
        subCats.map(function (sc) { return '<option value="' + esc(sc) + '"' + (sc === defaultSubCat ? ' selected' : '') + '>' + esc(sc) + '</option>'; }).join('');
    var hasApi = !!(meta.apiVision.endpoint && meta.apiVision.key && meta.apiVision.model);

    var modal = document.createElement('div');
    modal.className = 'om-modal';
    modal.style.setProperty('z-index', '2147483647', 'important');
    modal.innerHTML = '<div class="om-modal-box" style="background:' + (state.darkMode ? '#1e1e24' : '#ececef') + ';color:' + (state.darkMode ? '#eee' : '#111') + ';max-height:80vh">' +
        '<div class="om-modal-title"><i class="fa-solid fa-images" style="margin-right:6px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>批量导入单品</div>' +
        '<div style="font-size:.82em;opacity:.7;margin-bottom:8px">已选择 ' + files.length + ' 张图片，将自动压缩</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;max-height:120px;overflow-y:auto;margin-bottom:10px" id="om-acc-bimport-preview"></div>' +
        '<div class="om-field" style="margin-bottom:8px"><label style="font-size:.82em;font-weight:600">导入到分类</label><select id="om-acc-bimport-cat" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit">' + catOpts + '</select></div>' +
        '<div class="om-field" id="om-acc-bimport-sub-field" style="margin-bottom:8px;' + (defaultCat ? '' : 'display:none;') + '"><label style="font-size:.82em;font-weight:600">导入到子分类</label><select id="om-acc-bimport-sub" style="background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;font-family:inherit">' + subOpts + '</select></div>' +
        (hasApi ? '<label style="display:flex;align-items:center;gap:6px;font-size:.82em;cursor:pointer;margin-bottom:6px"><input type="checkbox" id="om-acc-bimport-ai" /> 导入后选择生成描述和名称（调用 API）</label>' : '<div style="font-size:.78em;opacity:.4;margin-bottom:6px">配置"描述生成 API"后可选择生成描述和名称</div>') +
        '<div id="om-acc-bimport-hint" style="display:none;color:#e57373;font-size:.78em;margin-bottom:8px">请先选择单品分类，再生成 AI 描述和名称</div>' +
        '<div id="om-acc-bimport-status" style="display:none;margin:8px 0;font-size:.82em"></div>' +
        '<div class="om-btn-row" style="margin-top:6px" id="om-acc-bimport-actions">' +
        '<button class="om-btn om-btn-safe" id="om-acc-bimport-start"><i class="fa-solid fa-file-import"></i> 开始导入</button>' +
        '<button class="om-btn om-btn-outline" id="om-acc-bimport-close">取消</button></div></div>';

    var _mp = getPopupLayer();
    modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
    mountPopup(modal, _mp);

    modal.addEventListener('click', function (e) { if (e.target === modal && !modal.dataset.running) _mp.removeChild(modal); });
    modal.querySelector('#om-acc-bimport-close').addEventListener('click', function () { if (!modal.dataset.running) _mp.removeChild(modal); });

    var previewEl = modal.querySelector('#om-acc-bimport-preview');
    files.forEach(function (f) {
        var thumb = document.createElement('div');
        thumb.style.cssText = 'width:52px;height:52px;border-radius:6px;overflow:hidden;background:rgba(127,127,127,.1);flex-shrink:0;';
        var reader = new FileReader();
        reader.onload = function (e) { thumb.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover" />'; };
        reader.readAsDataURL(f);
        previewEl.appendChild(thumb);
    });

    modal.querySelector('#om-acc-bimport-cat').addEventListener('change', function () {
        var parentVal = this.value;
        var subField = modal.querySelector('#om-acc-bimport-sub-field');
        var subSel = modal.querySelector('#om-acc-bimport-sub');
        var hint = modal.querySelector('#om-acc-bimport-hint');
        if (hint) hint.style.display = 'none';
        if (!parentVal) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
            return;
        }
        var cp = loadPartition(targetPartKey);
        var subs = getSubCats(cp.accCategories || [], parentVal);
        subSel.innerHTML = '<option value="">无子分类</option>' +
            subs.map(function (sc) { return '<option value="' + esc(sc) + '">' + esc(sc) + '</option>'; }).join('');
        subField.style.display = '';
    });

    modal.querySelector('#om-acc-bimport-start').addEventListener('click', function () {
        var cat = modal.querySelector('#om-acc-bimport-cat').value;
        var subCat = modal.querySelector('#om-acc-bimport-sub') ? modal.querySelector('#om-acc-bimport-sub').value || '' : '';
        var useAI = hasApi && modal.querySelector('#om-acc-bimport-ai') && modal.querySelector('#om-acc-bimport-ai').checked;
        var hintEl = modal.querySelector('#om-acc-bimport-hint');
        if (useAI && !cat) {
            if (hintEl) hintEl.style.display = 'block';
            return;
        }
        if (hintEl) hintEl.style.display = 'none';

        modal.dataset.running = '1';
        modal.querySelector('#om-acc-bimport-start').disabled = true;
        modal.querySelector('#om-acc-bimport-start').textContent = '导入中...';
        modal.querySelector('#om-acc-bimport-close').textContent = '请等待...';
        var statusEl = modal.querySelector('#om-acc-bimport-status');
        statusEl.style.display = 'block';

        var baseCount = (loadPartition(targetPartKey).accessories || []).length;
        var importedAccs = [];
        var newIds = [];

        function prepareImageForStorage(compressed, idx, cb) {
            if (!isServerMode()) { cb(null, compressed); return; }
            statusEl.textContent = '上传中... ' + (idx + 1) + '/' + files.length;
            uploadImage(compressed, function (err, imageData) {
                if (err || !imageData || imageData.indexOf('data:image/') === 0) {
                    cb('图片上传失败/后端写入失败');
                    return;
                }
                cb(null, imageData);
            });
        }

        function showImportFailure(msg) {
            var text = msg || '保存失败/空间不足/后端写入失败';
            delete modal.dataset.running;
            statusEl.innerHTML = '<div style="color:#e57373">' + esc(text) + '</div>';
            toast(text, true);
            modal.querySelector('#om-acc-bimport-start').disabled = false;
            modal.querySelector('#om-acc-bimport-start').textContent = '重新导入';
            modal.querySelector('#om-acc-bimport-close').textContent = '取消';
        }

        function verifyImportedIds(ids) {
            var savedPart = loadPartition(targetPartKey);
            var accs = savedPart.accessories || [];
            for (var v = 0; v < ids.length; v++) {
                var found = false;
                for (var a = 0; a < accs.length; a++) {
                    if (accs[a].id === ids[v]) { found = true; break; }
                }
                if (!found) return false;
            }
            return true;
        }

        function finishImport() {
            var importedList = importedAccs.filter(function (a) { return !!a; });
            var idList = newIds.filter(function (id) { return !!id; });
            if (importedList.length === 0) {
                showImportFailure('图片读取或上传失败');
                return;
            }
            var p = loadPartition(targetPartKey);
            if (!Array.isArray(p.accessories)) p.accessories = [];
            p.accessories = importedList.concat(p.accessories);
            savePartition(targetPartKey, p);
            if (!verifyImportedIds(idList)) {
                showImportFailure('保存失败/空间不足/后端写入失败');
                return;
            }
            fn.renderAccCatbar(); fn.renderGrid();
            statusEl.innerHTML = '<div style="color:#4caf50;font-weight:600">已导入 ' + importedList.length + ' 个单品</div>';
            if (useAI && fn.openAccBatchDescModal) {
                _mp.removeChild(modal);
                fn.openAccBatchDescModal(idList, { autoName: true });
            } else {
                delete modal.dataset.running;
                modal.querySelector('#om-acc-bimport-actions').innerHTML = '<button class="om-btn om-btn-safe" id="om-acc-bimport-done">完成</button>';
                modal.querySelector('#om-acc-bimport-done').addEventListener('click', function () { _mp.removeChild(modal); });
            }
        }

        function processNext(idx) {
            if (idx >= files.length) { finishImport(); return; }
            statusEl.textContent = '压缩中... ' + (idx + 1) + '/' + files.length;
            var reader = new FileReader();
            reader.onload = function (e) {
                compressImage(e.target.result, function (compressed) {
                    prepareImageForStorage(compressed, idx, function (err, imageData) {
                        if (!err) {
                            var id = 'a_' + genId().substring(0, 8);
                            importedAccs[idx] = {
                                id: id,
                                name: '单品' + (baseCount + idx + 1),
                                category: cat,
                                subCategory: subCat,
                                description: '',
                                imageData: imageData,
                                createdAt: Date.now()
                            };
                            newIds[idx] = id;
                        }
                        processNext(idx + 1);
                    });
                });
            };
            reader.onerror = function () {
                processNext(idx + 1);
            };
            reader.readAsDataURL(files[idx]);
        }
        processNext(0);
    });
}

// ── 单品编辑弹窗 ─────────────────────────────────────────
export function openAccEditSheet(acc, defaultCat) {
    var editImgData = acc ? (acc.imageData || null) : null;
    var curPart = loadCurrent();
    var accCats = curPart.accCategories || [];
    var catNames = getCatNames(accCats);
    var catOpts = '<option value="">无分类</option>' +
        catNames.map(function (c) { return '<option value="' + esc(c) + '"' + (acc && acc.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

    var curParent = acc ? (acc.category || '') : (defaultCat || '');
    var curSub = acc ? (acc.subCategory || '') : '';
    var subCats = curParent ? getSubCats(accCats, curParent) : [];
    var subDisplay = curParent ? '' : 'display:none;';
    var subOpts = '<option value="">无子分类</option>' +
        subCats.map(function (sc) { return '<option value="' + esc(sc) + '"' + (sc === curSub ? ' selected' : '') + '>' + esc(sc) + '</option>'; }).join('');

    var sheet = createSheet([
        '<div class="om-sheet-title"><i class="fa-solid fa-' + (acc ? 'pen' : 'plus') + '"></i>' + (acc ? '编辑单品' : '添加单品') + '</div>',
        '<div class="om-field"><label>单品名称 *</label><input type="text" id="om-acc-dn" placeholder="如：黑色贝雷帽" value="' + esc(acc ? acc.name : '') + '" /></div>',
        '<div class="om-field"><label>分类 <span class="om-hint">分类名将作为注入标签</span></label><div class="om-frow"><select id="om-acc-dcat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-acc-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field" id="om-acc-subcat-field" style="' + subDisplay + '"><label>子分类</label><div class="om-frow"><select id="om-acc-dsubcat">' + subOpts + '</select><button class="om-btn om-btn-outline" id="om-acc-dnewsubcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
        '<div class="om-field"><label>佩戴槽位</label><select id="om-acc-slot">' + Object.keys(SLOT_LABELS).map(function (key) { return '<option value="' + key + '"' + (accessorySlot(acc || {}) === key ? ' selected' : '') + '>' + SLOT_LABELS[key] + '</option>'; }).join('') + '</select><label><input type="checkbox" id="om-acc-exclusive"' + (exclusiveAccessory(acc || {}) ? ' checked' : '') + '> 此槽位只保留一件（戒指等可关闭）</label></div>',
        '<div class="om-field"><label>文字描述 <span class="om-hint">AI 注入用，越详细越好</span></label><textarea id="om-acc-ddesc" rows="4" placeholder="如：黑色羊毛贝雷帽，帽檐微微偏右，帽身有一枚复古金属别针……">' + esc(acc ? acc.description || '' : '') + '</textarea>' +
        '<button class="om-btn om-btn-outline" id="om-acc-dai" style="font-size:.78em;margin-top:5px;align-self:flex-start"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述</button></div>',
        '<div class="om-field"><label>参考图片 <span class="om-hint">可选，自动压缩</span></label>',
        '<div class="om-imgarea" id="om-acc-dimgarea">' + (editImgData ? '<img src="' + editImgData + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>') + '</div>',
        '<input type="file" id="om-acc-dfile-album" accept="image/*" style="display:none" />',
        '<input type="file" id="om-acc-dfile-any" style="display:none" />',
        '<div class="om-img-actions"><button class="om-btn om-btn-outline" id="om-acc-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 导入图片</button>' +
        (!acc ? '<button class="om-btn om-btn-outline" id="om-acc-dbatch" style="font-size:.8em"><i class="fa-solid fa-images"></i> 批量导入</button>' : '') +
        (editImgData ? '<button class="om-btn om-btn-danger" id="om-acc-dclr" style="font-size:.8em">删除图片</button>' : '') + '</div></div>',
        '<input type="file" id="om-acc-dbatchfile-album" accept="image/*" multiple style="display:none" />',
        '<input type="file" id="om-acc-dbatchfile-any" multiple style="display:none" />',
        '<div class="om-edit-foot"><button class="om-btn om-btn-outline" id="om-acc-dcancel">取消</button><button class="om-btn om-btn-safe" id="om-acc-dsave">保存</button></div>',
    ].join(''));

    sheet.querySelector('#om-acc-slot').addEventListener('change', function () {
        sheet.querySelector('#om-acc-exclusive').checked = exclusiveAccessory({ slot: this.value });
    });
    // 默认分类
    if (defaultCat) {
        var sel = sheet.querySelector('#om-acc-dcat'); if (sel) sel.value = defaultCat;
    }

    // 父分类联动子分类
    sheet.querySelector('#om-acc-dcat').addEventListener('change', function () {
        var parentVal = this.value;
        var subField = sheet.querySelector('#om-acc-subcat-field');
        var subSel = sheet.querySelector('#om-acc-dsubcat');
        if (!parentVal) {
            subField.style.display = 'none';
            subSel.innerHTML = '<option value="">无子分类</option>';
            return;
        }
        // 有父分类就始终显示子分类区域（方便新建）
        subField.style.display = '';
        var cp = loadCurrent();
        var subs = getSubCats(cp.accCategories || [], parentVal);
        subSel.innerHTML = '<option value="">无子分类</option>' +
            subs.map(function (sc) { return '<option value="' + esc(sc) + '">' + esc(sc) + '</option>'; }).join('');
    });

    // 图片处理
    var albumInp = sheet.querySelector('#om-acc-dfile-album');
    var fileInp = sheet.querySelector('#om-acc-dfile-any');
    var imgArea = sheet.querySelector('#om-acc-dimgarea');
    function setImg(data) {
        editImgData = data;
        imgArea.innerHTML = data ? '<img src="' + data + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>';
        hydrateLocalImages(imgArea);
        var clrOld = sheet.querySelector('#om-acc-dclr'); var acts = sheet.querySelector('.om-img-actions');
        if (data && !clrOld && acts) {
            var b2 = document.createElement('button'); b2.className = 'om-btn om-btn-danger'; b2.id = 'om-acc-dclr'; b2.style.fontSize = '.8em'; b2.textContent = '删除图片';
            b2.addEventListener('click', function () { setImg(null); }); acts.appendChild(b2);
        } else if (!data && clrOld) clrOld.parentNode.removeChild(clrOld);
    }
    function handleFile(f) {
        if (!isImageFile(f)) { toast('请选择图片文件', true); return; }
        var r = new FileReader(); r.onload = function (e) { compressImage(e.target.result, function (c) { setImg(c); }); }; r.readAsDataURL(f);
    }
    function bindSingleAccImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            var files = getPickedImageFiles(inp.files);
            if (files[0]) handleFile(files[0]);
            else if (inp.files && inp.files.length) toast('请选择图片文件', true);
            inp.value = '';
        });
    }
    function openSingleAccImagePicker() {
        openImageSourcePicker('导入图片', function () { albumInp.click(); }, function () { fileInp.click(); });
    }
    sheet.querySelector('#om-acc-dpick').addEventListener('click', openSingleAccImagePicker);
    imgArea.addEventListener('click', openSingleAccImagePicker);
    bindSingleAccImageInput(albumInp);
    bindSingleAccImageInput(fileInp);
    imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
    imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
    imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer) handleFile(getPickedImageFiles(e.dataTransfer.files)[0]); });
    var clr = sheet.querySelector('#om-acc-dclr'); if (clr) clr.addEventListener('click', function () { setImg(null); });

    var accAiBtn = sheet.querySelector('#om-acc-dai');
    if (accAiBtn) accAiBtn.addEventListener('click', function () {
        if (!editImgData) { toast('请先上传图片', true); return; }
        var cat = sheet.querySelector('#om-acc-dcat').value || '单品';
        var tempAcc = {
            imageData: editImgData,
            category: cat,
            name: sheet.querySelector('#om-acc-dn').value.trim() || ''
        };
        accAiBtn.disabled = true;
        accAiBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
        generateSingleAccDescription(tempAcc, function (err, result) {
            accAiBtn.disabled = false;
            accAiBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI 生成描述';
            if (err) { toast('生成失败：' + err, true); return; }
            if (result.description) sheet.querySelector('#om-acc-ddesc').value = result.description;
            var nameInp = sheet.querySelector('#om-acc-dn');
            if (result.name && !nameInp.value.trim()) nameInp.value = result.name;
            toast('✨ 描述已生成');
        });
    });

    // 批量导入按钮
    var accBatchBtn = sheet.querySelector('#om-acc-dbatch');
    var accBatchAlbumInp = sheet.querySelector('#om-acc-dbatchfile-album');
    var accBatchFileInp = sheet.querySelector('#om-acc-dbatchfile-any');
    if (accBatchBtn) accBatchBtn.addEventListener('click', function () {
        openImageSourcePicker('批量导入', function () { accBatchAlbumInp.click(); }, function () { accBatchFileInp.click(); });
    });
    function bindAccBatchImageInput(inp) {
        if (!inp) return;
        inp.addEventListener('change', function () {
            var files = getPickedImageFiles(inp.files);
            if (files.length === 0) { toast('未选择图片', true); inp.value = ''; return; }
            var cat = sheet.querySelector('#om-acc-dcat').value || '';
            var subCat = sheet.querySelector('#om-acc-dsubcat') ? sheet.querySelector('#om-acc-dsubcat').value || '' : '';
            closeSheet(sheet);
            openAccBatchImportModal(files, cat, subCat);
            inp.value = '';
        });
    }
    bindAccBatchImageInput(accBatchAlbumInp);
    bindAccBatchImageInput(accBatchFileInp);

    // 新建分类
    sheet.querySelector('#om-acc-dnewcat').addEventListener('click', function () {
        var name = prompt('新单品分类名称：'); if (!name || !name.trim()) return; name = name.trim();
        var cp = loadCurrent();
        if (!Array.isArray(cp.accCategories)) cp.accCategories = [];
        var names = getCatNames(cp.accCategories);
        if (names.indexOf(name) === -1) { cp.accCategories.push({ name: name, children: [] }); saveCurrent(cp); fn.renderAccCatbar(); }
        var sel = sheet.querySelector('#om-acc-dcat');
        var ex = false; for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
        if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
        sel.value = name;
        sel.dispatchEvent(new Event('change'));
        toast('分类「' + name + '」已添加');
    });

    // 新建子分类
    sheet.querySelector('#om-acc-dnewsubcat').addEventListener('click', function () {
        var parentVal = sheet.querySelector('#om-acc-dcat').value;
        if (!parentVal) { toast('请先选择父分类', true); return; }
        var scName = prompt('新子分类名称（属于「' + parentVal + '」）：'); if (!scName || !scName.trim()) return; scName = scName.trim();
        var cp = loadCurrent();
        var catObj = findCatObj(cp.accCategories || [], parentVal);
        if (catObj) {
            if (!catObj.children) catObj.children = [];
            if (catObj.children.indexOf(scName) === -1) { catObj.children.push(scName); saveCurrent(cp); fn.renderAccCatbar(); }
        }
        var subSel = sheet.querySelector('#om-acc-dsubcat');
        var ex2 = false; for (var j = 0; j < subSel.options.length; j++) { if (subSel.options[j].value === scName) { ex2 = true; break; } }
        if (!ex2) { var opt2 = document.createElement('option'); opt2.value = scName; opt2.textContent = scName; subSel.appendChild(opt2); }
        subSel.value = scName;
        sheet.querySelector('#om-acc-subcat-field').style.display = '';
        toast('子分类「' + scName + '」已添加');
    });

    sheet.querySelector('#om-acc-dcancel').addEventListener('click', function () { closeSheet(sheet); });
    sheet.querySelector('#om-acc-dsave').addEventListener('click', function () {
        var name = sheet.querySelector('#om-acc-dn').value.trim();
        if (!name) { toast('请输入单品名称', true); return; }
        var cat = sheet.querySelector('#om-acc-dcat').value;
        var subCat = sheet.querySelector('#om-acc-dsubcat').value;
        var desc = sheet.querySelector('#om-acc-ddesc').value.trim();
        var slot = sheet.querySelector('#om-acc-slot').value;
        var slotExclusive = sheet.querySelector('#om-acc-exclusive').checked;
        var curP = loadCurrent();
        if (!Array.isArray(curP.accessories)) curP.accessories = [];
        if (acc) {
            for (var i = 0; i < curP.accessories.length; i++) {
                if (curP.accessories[i].id === acc.id) {
                    Object.assign(curP.accessories[i], { name: name, category: cat, subCategory: subCat, description: desc, imageData: editImgData, slot: slot, slotExclusive: slotExclusive });
                    break;
                }
            }
        } else {
            curP.accessories.unshift({ id: 'a_' + genId().substring(0, 8), name: name, category: cat, subCategory: subCat, description: desc, imageData: editImgData, slot: slot, slotExclusive: slotExclusive, createdAt: Date.now() });
        }
        saveCurrent(curP); closeSheet(sheet); toast('✨ 已保存：' + name); fn.renderAccCatbar(); fn.renderGrid();
    });
}

// ── 注册到共享桥 ─────────────────────────────────────────


// ── 穿着历史日历 ─────────────────────────────────────────


/** 历史/建议缩略图：统一解析 dataURL 与后端图片路径 */
