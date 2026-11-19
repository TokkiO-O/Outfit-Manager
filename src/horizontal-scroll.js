// Outfit Manager · 二改版 | 分类栏鼠标拖动与滚轮横向浏览
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

var bindings = new WeakMap();
var renderContexts = new WeakMap();
var DRAG_DISTANCE = 6;

// Capture positions before replacing the buttons, then restore synchronously
// after both rows (and the accessory switch) have been rebuilt.
export function preserveHorizontalScroll(container, context, parent) {
    var previous = renderContexts.get(container), sameContext = previous && previous.context === context;
    var main = container.querySelector('.om-cat-row-main'), sub = container.querySelector('.om-cat-row-sub');
    var mainLeft = sameContext && main ? main.scrollLeft : 0;
    var subLeft = sameContext && previous.parent === parent && sub ? sub.scrollLeft : 0;
    return function () {
        var nextMain = container.querySelector('.om-cat-row-main'), nextSub = container.querySelector('.om-cat-row-sub');
        // A different parent starts a fresh subcategory row. Different wardrobes
        // never inherit an unrelated offset; the browser clamps shorter rows.
        if (nextMain) nextMain.scrollLeft = mainLeft;
        if (nextSub) nextSub.scrollLeft = subLeft;
        renderContexts.set(container, { context: context, parent: parent });
    };
}

export function unbindHorizontalScroll(row) {
    var binding = row && bindings.get(row);
    if (binding) binding();
}

export function bindHorizontalScroll(row) {
    if (!row || bindings.has(row)) return;
    var doc = row.ownerDocument, view = doc.defaultView;
    var gesture = null, suppressClick = false;

    function finish() {
        var current = gesture;
        if (!current) return;
        gesture = null;
        if (current.dragged) suppressClick = true;
        doc.removeEventListener('pointermove', move, true);
        doc.removeEventListener('pointerup', up, true);
        doc.removeEventListener('pointercancel', cancel, true);
        view.removeEventListener('blur', finish);
        row.classList.remove('om-scroll-dragging');
        try { if (row.hasPointerCapture(current.id)) row.releasePointerCapture(current.id); } catch (ignored) {}
    }
    function down(event) {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false || event.ctrlKey || event.metaKey) return;
        finish(); suppressClick = false;
        if (row.scrollWidth <= row.clientWidth) return;
        if (event.target.closest && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, scroll: row.scrollLeft, dragged: false };
        // Only listen outside the row while a mouse press is active. Native
        // button clicks keep their original target until a real drag begins.
        doc.addEventListener('pointermove', move, { capture: true, passive: false });
        doc.addEventListener('pointerup', up, true);
        doc.addEventListener('pointercancel', cancel, true);
        view.addEventListener('blur', finish);
    }
    function move(event) {
        var current = gesture;
        if (!current || event.pointerId !== current.id) return;
        if (!(event.buttons & 1) || row.isConnected === false) { finish(); return; }
        var dx = event.clientX - current.x, dy = event.clientY - current.y;
        if (!current.dragged) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_DISTANCE) return;
            if (Math.abs(dy) > Math.abs(dx)) { finish(); return; }
            current.dragged = true;
            row.classList.add('om-scroll-dragging');
            try { row.setPointerCapture(current.id); } catch (ignored) {}
        }
        event.preventDefault();
        row.scrollLeft = current.scroll - dx;
    }
    function up(event) {
        if (!gesture || event.pointerId !== gesture.id) return;
        if (gesture.dragged) event.preventDefault();
        finish();
    }
    function cancel(event) { if (gesture && event.pointerId === gesture.id) finish(); }
    function lost(event) { if (gesture && event.pointerId === gesture.id) finish(); }
    function click(event) {
        // Keyboard activation has detail=0 and must keep working. A subsequent
        // real mouse press resets suppression before its normal click.
        if (!suppressClick || event.detail === 0) return;
        suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }
    function dragStart(event) { if (gesture) event.preventDefault(); }
    function wheel(event) {
        if (event.ctrlKey || event.metaKey || row.scrollWidth <= row.clientWidth) return;
        var dx = event.deltaX || 0, dy = event.deltaY || 0;
        var delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        if (event.deltaMode === 1) delta *= 16;
        else if (event.deltaMode === 2) delta *= row.clientWidth;
        var before = row.scrollLeft;
        row.scrollLeft += delta;
        if (row.scrollLeft !== before) event.preventDefault();
    }
    row.addEventListener('pointerdown', down);
    row.addEventListener('lostpointercapture', lost);
    row.addEventListener('click', click, true);
    row.addEventListener('dragstart', dragStart);
    row.addEventListener('wheel', wheel, { passive: false });
    bindings.set(row, function () {
        finish();
        row.removeEventListener('pointerdown', down);
        row.removeEventListener('lostpointercapture', lost);
        row.removeEventListener('click', click, true);
        row.removeEventListener('dragstart', dragStart);
        row.removeEventListener('wheel', wheel);
        bindings.delete(row);
    });
}
