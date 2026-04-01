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
 * Style, Attribute, Visibility, Icon, Animation, and Event Delegation Helpers
 */

import { $ } from './selectors.js';

/**
 * Remove all children from an element.
 * @param {Element} el
 */
export function clear(el) {
    if (!el) return;
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

/**
 * Set up event delegation.
 *
 * Returns an unsubscribe function. Always capture the return value and call it
 * during teardown via Module/Component.addCleanup(() => unsub()) or store it
 * and call it explicitly.
 *
 * @param {Element|string} parent - Parent element or selector
 * @param {string} event - Event name
 * @param {string} selector - Child selector
 * @param {Function} handler
 * @returns {Function} Unsubscribe function that removes the delegated listener
 */
export function delegateEvent(parent, event, selector, handler) {
    const parentEl = typeof parent === 'string' ? $(parent) : parent;
    if (!parentEl) return () => { };

    const listener = function (e) {
        let target = e.target;
        while (target && target !== parentEl) {
            if (target.matches(selector)) {
                return handler.call(target, e, target);
            }
            target = target.parentNode;
        }
    };

    parentEl.addEventListener(event, listener);
    return () => parentEl.removeEventListener(event, listener);
}

/**
 * Apply multiple CSS styles to an element in one call.
 * Chainable: returns the element.
 * @param {HTMLElement} el
 * @param {Object} styles - Plain object of camelCase style properties
 * @returns {HTMLElement}
 */
export function css(el, styles) {
    if (!el || !styles) return el;
    Object.assign(el.style, styles);
    return el;
}

/**
 * Set or remove multiple HTML attributes in one call.
 * - null/undefined → removeAttribute
 * - true → setAttribute(key, '')
 * - false → removeAttribute
 * - any other value → setAttribute(key, value)
 * Chainable: returns the element.
 * @param {HTMLElement} el
 * @param {Object} attributes
 * @returns {HTMLElement}
 */
export function attr(el, attributes, { additive = false } = {}) {
    if (!el || !attributes) return el;
    for (const [key, value] of Object.entries(attributes)) {
        if (key.startsWith('on')) {
            const eventName = key.toLowerCase().substring(2);
            const existingHandler = el._ragotHandlers ? el._ragotHandlers[eventName] : null;

            if (typeof value === 'function' && existingHandler === value) {
                continue;
            }

            if (existingHandler && !additive) {
                el.removeEventListener(eventName, existingHandler);
                delete el._ragotHandlers[eventName];
            }

            if (typeof value === 'function') {
                el.addEventListener(eventName, value);
                if (!el._ragotHandlers) el._ragotHandlers = {};
                el._ragotHandlers[eventName] = value;
            }
        } else if (value === null || value === undefined || value === false) {
            el.removeAttribute(key);
        } else if (value === true) {
            el.setAttribute(key, '');
        } else {
            el.setAttribute(key, value);
        }
    }
    return el;
}

/**
 * Wrap an SVG icon string in a <span> element.
 * Use this instead of: const d = document.createElement('div'); d.innerHTML = icon(24);
 *
 * SECURITY: Only pass trusted SVG markup from icons.js here.
 * Never pass user-supplied or server-provided strings without sanitization.
 *
 * @param {string} svgString - SVG markup from icons.js
 * @param {string} [className='icon'] - CSS class for the wrapper span
 * @returns {HTMLSpanElement}
 */
export function createIcon(svgString, className = 'icon') {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.innerHTML = svgString;
    return span;
}

/**
 * Remove the 'hidden' class from an element (make it visible).
 * Chainable: returns the element.
 * @param {HTMLElement} el
 * @returns {HTMLElement}
 */
export function show(el) {
    if (el) el.classList.remove('hidden');
    return el;
}

/**
 * Add the 'hidden' class to an element (hide it).
 * Chainable: returns the element.
 * @param {HTMLElement} el
 * @returns {HTMLElement}
 */
export function hide(el) {
    if (el) el.classList.add('hidden');
    return el;
}

/**
 * Toggle the 'hidden' class on an element.
 * Pass force=true to show, force=false to hide.
 * Chainable: returns the element.
 * @param {HTMLElement} el
 * @param {boolean} [force] - If provided, forces show (true) or hide (false)
 * @returns {HTMLElement}
 */
export function toggle(el, force) {
    if (el) {
        if (force !== undefined) {
            el.classList.toggle('hidden', !force);
        } else {
            el.classList.toggle('hidden');
        }
    }
    return el;
}

/**
 * Animate an element in by adding a CSS class on the next frame.
 * The element should start with opacity/transform set via its base CSS,
 * and the `activeClass` should define the visible state.
 *
 * @param {HTMLElement} el
 * @param {string} [activeClass='is-visible']
 */
export function animateIn(el, activeClass = 'is-visible') {
    if (!el) return;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.classList.add(activeClass);
        });
    });
}

/**
 * Animate an element out, then optionally remove it from the DOM.
 *
 * @param {HTMLElement} el
 * @param {string} [activeClass='is-visible']
 * @param {boolean} [remove=false] - If true, removes the element after transition ends
 * @returns {Promise<void>} Resolves after transitionend (or 350ms fallback)
 */
export function animateOut(el, activeClass = 'is-visible', remove = false) {
    if (!el) return Promise.resolve();
    return new Promise(resolve => {
        let finished = false;
        const done = () => {
            if (finished) return;
            finished = true;
            observer.disconnect();
            if (remove && el.parentNode) el.parentNode.removeChild(el);
            resolve();
        };
        // Resolve immediately if the element is removed from the DOM mid-animation
        // (e.g. component unmounts before the transition completes).
        // Observe only the element's direct parent — watching the full document subtree
        // fires on every DOM mutation anywhere on the page, which is expensive during
        // card grid churn and VS load/evict cycles.
        const parent = el.parentNode;
        const observer = new MutationObserver(() => {
            if (!el.isConnected) done();
        });
        if (parent) {
            observer.observe(parent, { childList: true });
        }
        el.classList.remove(activeClass);
        el.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 350);
    });
}
