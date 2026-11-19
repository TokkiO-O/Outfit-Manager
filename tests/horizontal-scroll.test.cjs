'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function events() {
    const listeners = new Map();
    return {
        addEventListener(type, fn, options) {
            const capture = options === true || !!(options && options.capture);
            const list = listeners.get(type) || [];
            if (!list.some(item => item.fn === fn && item.capture === capture)) list.push({ fn, capture });
            listeners.set(type, list);
        },
        removeEventListener(type, fn, options) {
            const capture = options === true || !!(options && options.capture);
            listeners.set(type, (listeners.get(type) || []).filter(item => item.fn !== fn || item.capture !== capture));
        },
        send(type, values = {}) {
            const event = { target: this, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 200, clientY: 20, detail: 1,
                defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
            for (const item of (listeners.get(type) || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture))) {
                item.fn(event); if (event.stopped) break;
            }
            return event;
        },
        count() { return [...listeners.values()].reduce((sum, list) => sum + list.length, 0); }
    };
}
function fixture() {
    const view = events(), doc = { ...events(), defaultView: view }, classes = new Set(), captures = new Set();
    let left = 0;
    const row = { ...events(), ownerDocument: doc, clientWidth: 200, scrollWidth: 600, isConnected: true,
        classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
        setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
    Object.defineProperty(row, 'scrollLeft', { get: () => left, set: value => { left = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, value)); } });
    return { row, doc, view, classes, captures };
}
(async () => {
    const { bindHorizontalScroll, unbindHorizontalScroll } = await import(pathToFileURL(path.join(__dirname, '../src/horizontal-scroll.js')));
    const { row, doc, view, classes, captures } = fixture();
    const button = { closest: () => null };
    let clicks = 0; row.addEventListener('click', () => clicks++);
    bindHorizontalScroll(row); bindHorizontalScroll(row);
    assert.equal(row.count(), 6, 'rebinding does not add duplicate handlers');
    assert.equal(doc.count() + view.count(), 0, 'no idle document/window handlers');
    row.send('pointerdown', { target: button }); doc.send('pointermove', { clientX: 197 }); doc.send('pointerup'); row.send('click');
    assert.equal(clicks, 1, 'small mouse motion preserves a normal button click'); assert.equal(row.scrollLeft, 0);
    row.send('pointerdown', { target: button }); doc.send('pointermove', { clientX: 100 });
    assert.equal(row.scrollLeft, 100, 'a press on a category button can start horizontal scrolling'); assert.equal(captures.size, 1);
    doc.send('pointerup'); assert.equal(row.send('click').defaultPrevented, true); assert.equal(clicks, 1, 'drag release cannot select a category');
    assert.equal(doc.count() + view.count() + classes.size + captures.size, 0, 'release cleans temporary handlers and drag state');
    row.send('pointerdown'); doc.send('pointerup'); row.send('click'); assert.equal(clicks, 2, 'the next intentional click works');
    row.send('pointerdown'); doc.send('pointermove', { clientX: 150 }); view.send('blur'); row.send('click', { detail: 0 });
    assert.equal(clicks, 3, 'keyboard activation is never blocked by a previous drag'); assert.equal(doc.count() + view.count(), 0);
    row.send('pointerdown'); doc.send('pointermove', { clientX: 199, clientY: 45 }); assert.equal(doc.count() + view.count(), 0, 'vertical motion is not captured');
    const beforeTouch = row.scrollLeft;
    assert.equal(row.send('pointerdown', { pointerType: 'touch' }).defaultPrevented, false);
    assert.equal(doc.count() + view.count(), 0, 'touch keeps native scrolling'); assert.equal(row.scrollLeft, beforeTouch);
    row.send('pointerdown', { button: 2 }); assert.equal(doc.count(), 0, 'right click is not a drag');
    row.scrollLeft = 0; assert.equal(row.send('wheel', { deltaY: 40 }).defaultPrevented, true); assert.equal(row.scrollLeft, 40);
    row.send('wheel', { deltaX: 60, deltaY: 10 }); assert.equal(row.scrollLeft, 100, 'horizontal trackpad delta is consumed once');
    row.send('wheel', { deltaY: 2, deltaMode: 1 }); assert.equal(row.scrollLeft, 132);
    assert.equal(row.send('wheel', { deltaY: 50, ctrlKey: true }).defaultPrevented, false); assert.equal(row.scrollLeft, 132);
    row.scrollLeft = 400; assert.equal(row.send('wheel', { deltaY: 30 }).defaultPrevented, false, 'the wheel is not trapped at an edge');
    row.send('pointerdown'); doc.send('pointermove', { clientX: 230 }); doc.send('pointercancel'); assert.equal(doc.count() + view.count() + captures.size, 0);
    for (let i = 0; i < 100; i++) { row.send('pointerdown'); unbindHorizontalScroll(row); assert.equal(doc.count() + view.count(), 0); bindHorizontalScroll(row); }
    unbindHorizontalScroll(row); assert.equal(row.count(), 1, 'redraws dispose every old scrolling handler');
    console.log('horizontal scroll: pass (button drag, click safety, keyboard, wheel, native touch, cancellation and bounded listeners)');
})().catch(error => { console.error(error); process.exitCode = 1; });
