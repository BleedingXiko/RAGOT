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
 * Keyed List Renderer, Grid Renderer, and Element Pooling
 */

import { morphDOM } from './dom.js';

const _elementPools = new Map(); // poolKey -> HTMLElement[]

// Maximum number of elements retained per pool key.
// Prevents unbounded memory growth on devices with limited RAM (e.g. Raspberry Pi).
const POOL_MAX_SIZE = 50;

/**
 * Efficiently reconcile a list of items into a container using string keys.
 * Only creates, moves, or removes nodes — never rebuilds unchanged items.
 * Supports element pooling to reduce GC pressure and improve performance.
 *
 * @param {HTMLElement} container - The parent element to render into
 * @param {Array} items - Array of data items
 * @param {Function} getKey - (item) => string — unique key per item
 * @param {Function} renderItem - (item) => HTMLElement — build the DOM node
 * @param {Function} [updateItem] - (el, item) => void — patch an existing node in-place
 * @param {Object} [options={}]
 * @param {string} [options.poolKey] - If provided, removed elements are pooled for reuse
 *
 * @example
 * renderList(grid, media, m => m.url, m => createCard(m), (el, m) => updateCard(el, m), { poolKey: 'media-card' });
 */
export function renderList(container, items, getKey, renderItem, updateItem, options = {}) {
    if (!container) return;

    const { poolKey = null } = options;

    const existing = new Map();
    for (const child of Array.from(container.children)) {
        const key = child.dataset._listKey;
        if (key !== undefined) existing.set(key, child);
    }

    const seen = new Set();
    const ordered = [];

    for (const item of items) {
        const key = String(getKey(item));
        seen.add(key);

        if (existing.has(key)) {
            const el = existing.get(key);
            if (updateItem) updateItem(el, item);
            ordered.push(el);
        } else {
            let el = null;
            if (poolKey) {
                const pool = _elementPools.get(poolKey);
                if (pool && pool.length > 0) {
                    el = pool.pop();
                    if (updateItem) updateItem(el, item);
                    else {
                        const replacement = renderItem(item);
                        el = morphDOM(el, replacement) || el;
                    }
                }
            }

            if (!el) {
                el = renderItem(item);
            }

            if (el) {
                el.dataset._listKey = key;
                if (poolKey) el.dataset._poolKey = poolKey;
                ordered.push(el);
            }
        }
    }

    // Remove items that are no longer in the list
    for (const [key, el] of existing) {
        if (!seen.has(key)) {
            const pKey = el.dataset._poolKey || poolKey;
            if (pKey) {
                if (!_elementPools.has(pKey)) _elementPools.set(pKey, []);
                const pool = _elementPools.get(pKey);
                if (pool.length < POOL_MAX_SIZE) {
                    pool.push(el);
                }
            }
            el.remove();
        }
    }

    // Insert/reorder in place. Walk ordered[] and ensure each element is in the
    // correct position relative to the previous one, without disturbing non-list
    // children (e.g. static headers, sentinels). Uses insertBefore rather than
    // appendChild so list items don't pile up after non-list siblings.
    let cursor = null; // last correctly-positioned list node
    for (const el of ordered) {
        // Start scanning from immediately after the last placed list node (or from
        // the container's first child). Skip over non-list siblings — they are
        // caller-owned elements (headers, sentinels) that must not be displaced.
        let ref = cursor ? cursor.nextSibling : container.firstChild;
        while (ref && ref !== el && ref.dataset._listKey === undefined) {
            ref = ref.nextSibling;
        }
        if (ref !== el) {
            // el is out of position. Insert it at `ref`: if ref is a list node that
            // comes later, we push el in front of it. If ref is null (end of children)
            // or we ran past all siblings, appendChild. Using `ref` rather than
            // `cursor.nextSibling` ensures we land AFTER any non-list siblings that
            // were correctly skipped, not before them.
            container.insertBefore(el, ref || null);
        }
        cursor = el;
    }
}

/**
 * Optimized Grid Renderer for RAGOT.
 * Reconciles a keyed list of items into a CSS Grid container.
 * Applies grid layout CSS to the container and delegates item reconciliation
 * to renderList. Unlike renderList, this function also manages the container's
 * display/grid styles based on the provided options.
 *
 * @param {HTMLElement} container - The parent element to render into
 * @param {Array} items - Array of data items
 * @param {Function} getKey - (item) => string — unique key per item
 * @param {Function} renderItem - (item) => HTMLElement — build the DOM node
 * @param {Function} [updateItem] - (el, item) => void — patch an existing node in-place
 * @param {Object} [options={}]
 * @param {string} [options.poolKey] - If provided, removed elements are pooled for reuse
 * @param {number} [options.columns] - Fixed column count (e.g. 3). Ignored if columnWidth is set.
 * @param {string} [options.columnWidth] - Min column width for auto-fill (e.g. '200px').
 *   When set, uses `repeat(auto-fill, minmax(columnWidth, 1fr))`.
 * @param {string} [options.gap] - CSS gap value (e.g. '16px', '1rem'). Defaults to no change.
 * @param {boolean} [options.applyGridStyles=true] - Set false to skip container CSS mutation
 *   (useful when the container already has grid styles defined in CSS).
 */
export function renderGrid(container, items, getKey, renderItem, updateItem, options = {}) {
    if (!container) return;

    const {
        columns,
        columnWidth,
        gap,
        applyGridStyles = true,
        ...listOptions
    } = options;

    if (applyGridStyles) {
        container.style.display = 'grid';

        if (columnWidth) {
            container.style.gridTemplateColumns = `repeat(auto-fill, minmax(${columnWidth}, 1fr))`;
        } else if (columns) {
            container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
        }

        if (gap !== undefined) {
            container.style.gap = gap;
        }
    }

    renderList(container, items, getKey, renderItem, updateItem, listOptions);
}

/**
 * Clear an element pool.
 * @param {string} [poolKey] - If omitted, clears all pools.
 */
export function clearPool(poolKey) {
    if (poolKey) {
        _elementPools.delete(poolKey);
    } else {
        _elementPools.clear();
    }
}
