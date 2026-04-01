// Copyright 2026 BleedingXIko
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Core DOM Creation and Morphing
 */

/**
 * Create a DOM element with options and children.
 * @param {string} tag - Tag name (e.g., 'div', 'span', 'svg:path')
 * @param {Object} [options={}] - Attributes, classes, styles, events
 * @param {...any} [children] - Child elements or text
 * @returns {Element}
 */
export function createElement(tag, options = {}, ...children) {
    const isSVG = tag.startsWith('svg:') || [
        'svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse',
        'g', 'defs', 'marker', 'mask', 'pattern', 'stop', 'linearGradient', 'radialGradient', 'text', 'tspan'
    ].includes(tag);
    let tagName = tag;

    if (tag.startsWith('svg:')) {
        tagName = tag.split(':')[1];
    }

    const el = isSVG
        ? document.createElementNS('http://www.w3.org/2000/svg', tagName)
        : document.createElement(tagName);

    if (options) {
        for (const [key, value] of Object.entries(options)) {
            if (key === 'className' || key === 'class') {
                const classes = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(' ') : []);
                el.classList.add(...classes.map(c => typeof c === 'string' ? c.trim() : '').filter(Boolean));
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(el.style, value);
            } else if (key === 'dataset' && typeof value === 'object') {
                for (const [dKey, dVal] of Object.entries(value)) {
                    if (dVal !== null && dVal !== undefined) el.dataset[dKey] = dVal;
                }
            } else if (key === 'ref' && typeof value === 'function') {
                // ref callback — called synchronously after element creation
                // Usage: createElement('input', { ref: (el) => this.refs.input = el })
                // Also store the callback on the element so morphDOM can re-fire it
                value(el);
                if (!el._ragotRefCallbacks) el._ragotRefCallbacks = [];
                el._ragotRefCallbacks.push(value);
            } else if (key === 'events' && typeof value === 'object') {
                for (const [evtName, evtHandler] of Object.entries(value)) {
                    if (typeof evtHandler === 'function') {
                        el.addEventListener(evtName, evtHandler);
                        if (!el._ragotHandlers) el._ragotHandlers = {};
                        el._ragotHandlers[evtName] = evtHandler;
                    }
                }
            } else if (key.startsWith('on') && typeof value === 'function') {
                const eventName = key.toLowerCase().substring(2);
                if (!el._ragotHandlers) el._ragotHandlers = {};
                if (el._ragotHandlers[eventName] !== value) {
                    if (el._ragotHandlers[eventName]) {
                        el.removeEventListener(eventName, el._ragotHandlers[eventName]);
                    }
                    el.addEventListener(eventName, value);
                    el._ragotHandlers[eventName] = value;
                }
            } else if (['value', 'checked', 'selected', 'disabled', 'loading', 'src', 'alt', 'type', 'id'].includes(key) && !isSVG) {
                el[key] = value;
                if (value !== false && value !== null && value !== undefined) {
                    el.setAttribute(key, value === true ? '' : value);
                }
            } else if (value !== null && value !== undefined && value !== false) {
                if (value === true) el.setAttribute(key, '');
                else el.setAttribute(key, value);
            }
        }
    }

    // Merge children from arguments and options.children
    const allChildren = [];
    if (options && options.children) {
        allChildren.push(options.children);
    }
    allChildren.push(...children);

    const fragment = document.createDocumentFragment();
    allChildren.flat(Infinity).forEach(child => {
        if (child === null || child === undefined || typeof child === 'boolean') return;
        if (child instanceof Node) {
            fragment.appendChild(child);
        } else {
            fragment.appendChild(document.createTextNode(String(child)));
        }
    });

    if (options && options.innerHTML !== undefined) {
        // SECURITY: innerHTML is an XSS vector. Only pass trusted, developer-controlled
        // markup here (e.g. SVG icon strings from icons.js). Never interpolate
        // user-supplied or server-provided strings without prior sanitization.
        el.innerHTML = options.innerHTML;
    } else if (options && options.textContent !== undefined) {
        el.textContent = options.textContent; // This places the text node correctly
    }

    if (fragment.childNodes.length > 0) {
        el.appendChild(fragment); // Appended children go AFTER the text content
    }

    return el;
}

/**
 * Append multiple children to a parent asynchronously using requestAnimationFrame.
 * @param {Element} parent - Parent element
 * @param {Node|Node[]} children - Child or array of children
 * @returns {Promise<void>}
 */
export function batchAppend(parent, children) {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            const fragment = document.createDocumentFragment();
            const childrenArray = Array.isArray(children) ? children : [children];

            childrenArray.forEach(child => {
                if (child instanceof Node) {
                    fragment.appendChild(child);
                }
            });

            if (parent) parent.appendChild(fragment);
            resolve();
        });
    });
}

/**
 * Append multiple children to a parent element synchronously via a DocumentFragment.
 * Use batchAppend() (rAF-based) for large lists that need a paint frame.
 * Use this append() for immediate DOM mutations.
 * Chainable: returns the parent element.
 * @param {HTMLElement} parent
 * @param {...(Node|string|null|undefined|false|Array)} children
 * @returns {HTMLElement}
 */
export function append(parent, ...children) {
    if (!parent) return parent;
    const fragment = document.createDocumentFragment();
    children.flat(Infinity).forEach(child => {
        if (child == null || child === false) return;
        fragment.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    parent.appendChild(fragment);
    return parent;
}

/**
 * Prepend multiple children to a parent element synchronously.
 * Chainable: returns the parent element.
 * @param {HTMLElement} parent
 * @param {...(Node|string|null|undefined|false|Array)} children
 * @returns {HTMLElement}
 */
export function prepend(parent, ...children) {
    if (!parent) return parent;
    const fragment = document.createDocumentFragment();
    children.flat(Infinity).forEach(child => {
        if (child == null || child === false) return;
        fragment.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    parent.insertBefore(fragment, parent.firstChild);
    return parent;
}

/**
 * Insert a child before a reference node in a parent.
 * @param {HTMLElement} parent
 * @param {Node} newNode
 * @param {Node} referenceNode
 * @returns {Node}
 */
export function insertBefore(parent, newNode, referenceNode) {
    if (!parent || !newNode) return newNode;
    parent.insertBefore(newNode, referenceNode);
    return newNode;
}

/**
 * Remove an element from the DOM safely.
 * @param {Element} el
 * @returns {Element}
 */
export function remove(el) {
    if (el && el.parentNode) {
        el.parentNode.removeChild(el);
    }
    return el;
}

// Internal transient classes owned by createLazyLoader. These must survive
// morphDOM updates while a lazy image is live in the DOM.
const _IMG_LOAD_STATE_CLASSES = new Set([
    'ragot-lazy-loading',
    'ragot-lazy-loaded',
    'ragot-lazy-error'
]);

function _shouldStrictFailMixedKeys() {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD) {
            return false;
        }
    } catch (e) { /* ignore */ }
    try {
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
            return false;
        }
    } catch (e) { /* ignore */ }
    return true;
}

function syncAttributes(oldNode, newNode) {
    if (!oldNode.attributes || !newNode.attributes) return;

    const oldAttrs = oldNode.attributes;
    const newAttrs = newNode.attributes;
    const isLazyImg = oldNode.tagName === 'IMG' && (
        newNode.hasAttribute('data-src') || newNode.hasAttribute('data-srcset') ||
        newNode.classList.contains('lazy-load')
    );
    const oldHasRealSrc = isLazyImg && oldNode.src && oldNode.src.length > 5 &&
        !oldNode.src.startsWith('data:');

    for (let i = oldAttrs.length - 1; i >= 0; i--) {
        const name = oldAttrs[i].name;
        if (name.startsWith('on')) continue;

        if (!newNode.hasAttribute(name)) {
            // Protection: NEVER remove src/srcset from a loaded image if the new node is intended for lazy-loading.
            if (isLazyImg && oldHasRealSrc && (name === 'src' || name === 'srcset')) {
                continue;
            }
            oldNode.removeAttribute(name);
        }
    }

    for (let i = 0; i < newAttrs.length; i++) {
        const name = newAttrs[i].name;
        let value = newAttrs[i].value;
        if (name.startsWith('on')) continue;

        // Protection: Don't let an empty/placeholder src in the new node overwrite a valid loaded src in the DOM.
        if (isLazyImg && oldHasRealSrc && (name === 'src' || name === 'srcset')) {
            const currentSrc = oldNode.getAttribute(name);
            const isPlaceholder = !value || value === '' || (value.length < 100 && value.startsWith('data:image'));
            if (isPlaceholder && currentSrc && currentSrc.length > 5) {
                continue;
            }
        }

        // Protection: preserve internal lazy-loader classes on lazy images whose
        // src has been resolved. These classes are primitive-owned state and should
        // survive template morphs.
        if (name === 'class' && isLazyImg && oldHasRealSrc) {
            const liveClasses = Array.from(oldNode.classList).filter(c => _IMG_LOAD_STATE_CLASSES.has(c));
            if (liveClasses.length > 0) {
                const merged = new Set([...value.split(' ').filter(Boolean), ...liveClasses]);
                value = Array.from(merged).join(' ');
            }
        }

        if (oldNode.getAttribute(name) !== value) {
            oldNode.setAttribute(name, value);
        }
    }
}

function syncListeners(oldNode, newNode) {
    const oldHandlers = oldNode._ragotHandlers || {};
    const newHandlers = newNode._ragotHandlers || {};

    for (const [name, handler] of Object.entries(oldHandlers)) {
        if (newHandlers[name] !== handler) {
            oldNode.removeEventListener(name, handler);
            if (newHandlers[name]) {
                oldNode.addEventListener(name, newHandlers[name]);
            }
        }
    }

    for (const [name, handler] of Object.entries(newHandlers)) {
        if (!oldHandlers[name]) {
            oldNode.addEventListener(name, handler);
        }
    }

    oldNode._ragotHandlers = { ...newHandlers };
}

/**
 * Patch an existing DOM node to match a new one.
 * @param {Node} oldNode - Current node in DOM
 * @param {Node} newNode - New node to match
 */
export function morphDOM(oldNode, newNode) {
    if (!oldNode) return newNode;
    if (!newNode) return oldNode;

    if (oldNode.nodeType !== newNode.nodeType || oldNode.tagName !== newNode.tagName) {
        oldNode.replaceWith(newNode);
        return newNode;
    }

    if (oldNode.nodeType === Node.ELEMENT_NODE && oldNode.hasAttribute('data-ragot-ignore')) {
        syncAttributes(oldNode, newNode);
        syncListeners(oldNode, newNode);
        if (newNode._ragotRefCallbacks) {
            oldNode._ragotRefCallbacks = newNode._ragotRefCallbacks;
            for (const cb of oldNode._ragotRefCallbacks) {
                cb(oldNode);
            }
        }
        return oldNode;
    }

    if (oldNode.nodeType === Node.TEXT_NODE) {
        if (oldNode.nodeValue !== newNode.nodeValue) {
            oldNode.nodeValue = newNode.nodeValue;
        }
        return oldNode;
    }

    if (oldNode.tagName === 'VIDEO') {
        return oldNode;
    }

    if (oldNode.tagName === 'IMG') {
        // Optimization: when the source is unchanged, keep the live node in place,
        // but still sync non-src attributes like class/style so transforms and
        // stateful styling can update without replacing or reloading the image.
        const nextSrc = newNode.getAttribute('src');
        const prevSrc = oldNode.getAttribute('src');
        const nextDataSrc = newNode.getAttribute('data-src');
        const prevDataSrc = oldNode.getAttribute('data-src');
        if (nextSrc === prevSrc && nextDataSrc === prevDataSrc) {
            syncAttributes(oldNode, newNode);
            syncListeners(oldNode, newNode);

            if (newNode._ragotRefCallbacks) {
                oldNode._ragotRefCallbacks = newNode._ragotRefCallbacks;
                for (const cb of oldNode._ragotRefCallbacks) {
                    cb(oldNode);
                }
            }

            return oldNode;
        }
        // Fall through to syncAttributes which will update src/data-src in-place
        // rather than replacing the whole element.
    }

    syncAttributes(oldNode, newNode);
    syncListeners(oldNode, newNode);

    if (newNode._ragotRefCallbacks) {
        oldNode._ragotRefCallbacks = newNode._ragotRefCallbacks;
        for (const cb of oldNode._ragotRefCallbacks) {
            cb(oldNode);
        }
    }

    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(oldNode.tagName)) {
        if (oldNode.value !== newNode.value) oldNode.value = newNode.value;
        if (oldNode.checked !== newNode.checked) oldNode.checked = newNode.checked;
        if (oldNode.selected !== newNode.selected) oldNode.selected = newNode.selected;
        if (oldNode.disabled !== newNode.disabled) oldNode.disabled = newNode.disabled;
    }

    const oldChildren = Array.from(oldNode.childNodes);
    const newChildren = Array.from(newNode.childNodes);

    // Preserve scroll positions for elements that scroll — DOM mutations during
    // child reconciliation can reset scrollLeft/scrollTop to 0 in some browsers.
    const savedScrollLeft = oldNode.scrollLeft || 0;
    const savedScrollTop = oldNode.scrollTop || 0;
    const hasScroll = savedScrollLeft > 0 || savedScrollTop > 0;

    // Keyed reconciliation: if any element child carries data-ragot-key, use
    // key-based diffing to move/reuse nodes rather than patching by position.
    // This avoids O(n) unnecessary morphDOM calls when only order changes.
    const hasKeys = newChildren.some(c => c.nodeType === Node.ELEMENT_NODE && c.dataset && c.dataset.ragotKey !== undefined);

    // Guard: warn if keyed and unkeyed element siblings are mixed within the same container.
    // Unkeyed elements fall through to appendChild during keyed reconciliation, causing
    // ordering issues (they land after all keyed nodes regardless of their intended position).
    if (hasKeys) {
        const elementChildren = newChildren.filter(c => c.nodeType === Node.ELEMENT_NODE);
        const keyedCount = elementChildren.filter(c => c.dataset && c.dataset.ragotKey !== undefined).length;
        const unkeyedCount = elementChildren.length - keyedCount;
        if (keyedCount > 0 && unkeyedCount > 0) {
            const message =
                `[RAGOT] morphDOM: mixed keyed and unkeyed element siblings detected in <${oldNode.tagName?.toLowerCase()}>.\n` +
                `Keyed: ${keyedCount}, Unkeyed: ${unkeyedCount}.\n` +
                `Either key all siblings (add data-ragot-key) or key none of them.`;
            if (_shouldStrictFailMixedKeys()) {
                throw new Error(message);
            }
            console.warn(message);
        }
    }

    if (hasKeys) {
        // Build a key->node map from the current live children
        const oldByKey = new Map();
        for (const child of oldChildren) {
            if (child.nodeType === Node.ELEMENT_NODE && child.dataset && child.dataset.ragotKey !== undefined) {
                oldByKey.set(child.dataset.ragotKey, child);
            }
        }

        // Walk new children in order, inserting/moving/patching as needed
        for (const newChild of newChildren) {
            if (newChild.nodeType !== Node.ELEMENT_NODE || !newChild.dataset || newChild.dataset.ragotKey === undefined) {
                // Unkeyed child — append as-is (sentinels, text nodes handled below)
                oldNode.appendChild(newChild);
                continue;
            }
            const key = newChild.dataset.ragotKey;
            const existing = oldByKey.get(key);
            if (existing) {
                oldByKey.delete(key);
                morphDOM(existing, newChild);
                oldNode.appendChild(existing); // move to end (re-orders in place)
            } else {
                oldNode.appendChild(newChild);
            }
        }

        // Remove old keyed nodes that are no longer in the new list
        for (const orphan of oldByKey.values()) {
            oldNode.removeChild(orphan);
        }
    } else {
        // Positional reconciliation (original behavior, backward compatible)
        const max = Math.max(oldChildren.length, newChildren.length);
        for (let i = 0; i < max; i++) {
            if (!oldChildren[i]) {
                oldNode.appendChild(newChildren[i]);
            } else if (!newChildren[i]) {
                oldNode.removeChild(oldChildren[i]);
            } else {
                morphDOM(oldChildren[i], newChildren[i]);
            }
        }
    }

    // Restore scroll positions if they were non-zero (they may have been reset by DOM mutations)
    if (hasScroll) {
        if (oldNode.scrollLeft !== savedScrollLeft) oldNode.scrollLeft = savedScrollLeft;
        if (oldNode.scrollTop !== savedScrollTop) oldNode.scrollTop = savedScrollTop;
    }

    return oldNode;
}
