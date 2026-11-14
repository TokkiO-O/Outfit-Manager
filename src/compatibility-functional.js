// Outfit Manager · 二改版 | 不发送聊天的交互、样式与遮挡探测
// 基于温水 & 克洛宜原作维护；保留原作署名与数据兼容。

import { diagnosticFrames, diagnosticLocation, sanitizeDiagnosticFrame } from './diagnostic-evidence.js';
import { safeExtensionId } from './compatibility-journal.js';

export function probeClickRoute(target) {
    var result = { status: 'unknown', reached: false, interceptors: [] }, replacements = [], event = null, button = null;
    if (!target || !target.isConnected || typeof MouseEvent !== 'function' || typeof Event !== 'function') return result;
    try {
        ['stopPropagation', 'stopImmediatePropagation', 'preventDefault'].forEach(function (name) {
            var descriptor = Object.getOwnPropertyDescriptor(Event.prototype, name);
            if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable && !descriptor.writable) return;
            var original = descriptor.value, wrapped = function () {
                if (this === event && result.interceptors.length < 8) result.interceptors.push({ action: name, trace: diagnosticFrames(new Error()) });
                return original.apply(this, arguments);
            };
            Object.defineProperty(Event.prototype, name, Object.assign({}, descriptor, { value: wrapped })); replacements.push({ name: name, descriptor: descriptor, wrapped: wrapped });
        });
        button = document.createElement('button'); button.type = 'button'; button.className = 'om-btn om-btn-outline om-compat-event-probe'; button.tabIndex = -1;
        button.setAttribute('aria-hidden', 'true'); button.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(100%);pointer-events:none';
        button.addEventListener('click', function () { result.reached = true; });
        target.parentNode.appendChild(button); event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }); button.dispatchEvent(event);
        result.status = result.reached ? 'pass' : 'attention';
    } catch (error) { result.trace = diagnosticFrames(error); }
    finally {
        event = null;
        if (button && button.parentNode) button.parentNode.removeChild(button);
        replacements.reverse().forEach(function (item) { try { if (Event.prototype[item.name] === item.wrapped) Object.defineProperty(Event.prototype, item.name, item.descriptor); } catch (ignored) {} });
    }
    return result;
}

function declaredOwner(node, inventory) {
    for (var depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        for (var key of ['data-extension-id', 'data-extension-name', 'data-extension']) {
            var raw = node.getAttribute && node.getAttribute(key), id = safeExtensionId(raw);
            var match = id && inventory.find(function (entry) { return entry.id === id || entry.id === 'third-party/' + id; });
            if (match) return { scope: 'extension', id: match.id, file: null, line: 0, column: 0 };
        }
    }
    return null;
}
export function probeOcclusion(target, inventory) {
    if (!target || !target.isConnected) return { status: 'unknown', owner: null };
    var box = target.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    if (!box.width || !box.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { status: 'unknown', owner: null };
    var top = document.elementFromPoint(x, y), hit = top && (top === target || target.contains(top));
    return { status: hit ? 'pass' : 'attention', owner: hit ? null : declaredOwner(top, inventory), ownership: '覆盖元素的声明归属，不代表已验证创建者' };
}
function usable(target) {
    var style = getComputedStyle(target), box = target.getBoundingClientRect();
    if (!box.width || !box.height || target.disabled || style.visibility === 'hidden' || style.visibility === 'collapse' || style.pointerEvents === 'none') return false;
    for (var node = target, depth = 0; node && depth < 12; node = node.parentElement, depth++) { if (Number(getComputedStyle(node).opacity) === 0) return false; }
    return true;
}
function styleOwner(sheet) {
    var frame = sheet.href && diagnosticLocation(sheet.href);
    if (frame) return frame;
    var node = sheet.ownerNode, id = node && node.id || '';
    return /^(?:outfit-mgr-style|om-style|outfit-manager-style)/.test(id) ? { scope: 'self', id: null, file: 'src/styles/index.js', line: 0, column: 0 } : null;
}
export function probeStyleImpact(target) {
    var result = { status: 'unknown', verified: [], candidates: [], unreadable: 0, truncated: false };
    if (!target || !target.isConnected) return result;
    if (usable(target)) { result.status = 'pass'; return result; }
    result.status = 'attention';
    var ancestors = [], node = target, visited = 0, tested = 0, deadline = Date.now() + 100;
    while (node && ancestors.length < 12) { ancestors.push(node); node = node.parentElement; }
    var bad = {
        display: ancestors.some(function (item) { return getComputedStyle(item).display === 'none'; }),
        visibility: ['hidden', 'collapse'].includes(getComputedStyle(target).visibility),
        'pointer-events': getComputedStyle(target).pointerEvents === 'none',
        opacity: ancestors.some(function (item) { return Number(getComputedStyle(item).opacity) === 0; })
    };
    function testDeclaration(declaration, owner, rulePath, inline) {
        for (var property of ['display', 'visibility', 'pointer-events', 'opacity']) {
            var value = declaration.getPropertyValue(property); if (!bad[property] || !value || tested >= 24) continue;
            var priority = declaration.getPropertyPriority(property), originalText = declaration.cssText, before = usable(target), after = false, restored = false;
            if (before) return;
            tested++;
            try { declaration.removeProperty(property); after = usable(target); }
            catch (ignored) {}
            finally {
                try { declaration.cssText = originalText; }
                catch (ignored) { try { declaration.setProperty(property, value, priority); } catch (ignoredAgain) {} }
                restored = declaration.getPropertyValue(property) === value && declaration.getPropertyPriority(property) === priority && !usable(target);
            }
            var proof = { owner: owner && sanitizeDiagnosticFrame(owner), property: property, rulePath: rulePath.slice(0, 8), inline: !!inline };
            if (after && restored) result.verified.push(proof);
            else if (owner && /^(?:none|hidden|collapse|0)$|var\(/.test(value.trim()) && result.candidates.length < 6) result.candidates.push(proof);
            if (result.verified.length >= 4) return;
        }
    }
    ancestors.forEach(function (element, index) { if (element.style && tested < 24) testDeclaration(element.style, null, [index], true); });
    function inspect(rules, owner, path) {
        for (var i = 0; i < rules.length; i++) {
            if (++visited > 6000 || tested >= 24 || Date.now() > deadline) { result.truncated = true; return; }
            var rule = rules[i], rulePath = path.concat(i);
            if (rule.media && rule.conditionText && typeof matchMedia === 'function' && !matchMedia(rule.conditionText).matches) continue;
            if (rule.constructor && rule.constructor.name === 'CSSSupportsRule' && typeof CSS !== 'undefined' && CSS.supports && !CSS.supports(rule.conditionText)) continue;
            if (rule.cssRules) { inspect(rule.cssRules, owner, rulePath); if (result.truncated) return; }
            if (!rule.selectorText || !rule.style) continue;
            var matches = false; try { matches = ancestors.some(function (element) { return element.matches(rule.selectorText); }); } catch (ignored) {}
            if (!matches) continue;
            testDeclaration(rule.style, owner, rulePath, false);
        }
    }
    Array.from(document.styleSheets).some(function (sheet, index) {
        if (result.truncated || result.verified.length >= 4) return true;
        if (sheet.disabled) return false;
        if (sheet.media && sheet.media.mediaText && !matchMedia(sheet.media.mediaText).matches) return false;
        try { inspect(sheet.cssRules, styleOwner(sheet), [index]); } catch (ignored) { result.unreadable++; }
        return false;
    });
    return result;
}
