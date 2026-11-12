// Outfit Manager · 二改版 | 图片来源、导入与批量选取
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { esc, getPopupLayer, mountPopup } from '../utils.js';

export function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name || '');
}

export function getPickedImageFiles(fileList) {
    return Array.from(fileList || []).filter(isImageFile);
}

export function openImageSourcePicker(title, onAlbum, onFile) {
    var _mp = getPopupLayer();
    var modal = document.createElement('div');
    modal.className = 'om-modal';
    modal.innerHTML = '<div class="om-modal-box">' +
        '<div class="om-modal-title">' + esc(title || '导入图片') + '</div>' +
        '<button class="om-modal-btn" id="om-imgsrc-album"><i class="fa-solid fa-image" style="margin-right:8px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>从相册选择</button>' +
        '<button class="om-modal-btn" id="om-imgsrc-file"><i class="fa-solid fa-folder-open" style="margin-right:8px;color:var(--SmartThemeQuoteColor,#7c6daf)"></i>从文件选择</button>' +
        '<button class="om-modal-cancel" id="om-imgsrc-cancel">取消</button>' +
        '</div>';
    mountPopup(modal, _mp);

    function close() {
        if (modal.parentNode) _mp.removeChild(modal);
    }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#om-imgsrc-cancel').addEventListener('click', close);
    modal.querySelector('#om-imgsrc-album').addEventListener('click', function () {
        close();
        if (onAlbum) onAlbum();
    });
    modal.querySelector('#om-imgsrc-file').addEventListener('click', function () {
        close();
        if (onFile) onFile();
    });
}

// ── 长按操作菜单 Bottom Sheet ─────────────────────────────
