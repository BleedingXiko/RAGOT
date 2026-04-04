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
 * @fileoverview RAGOT — Rapid Assertions Generalized On Time
 *
 * A lightweight, lifecycle-safe frontend framework. Designed for
 * low-overhead environments: minimal runtime overhead, explicit ownership of
 * side effects, and deterministic startup/teardown.
 *
 * **Import from the public entry point:**
 * ```js
 * import { Module, Component, createElement, bus } from './ragot/index.js';
 * import RAGOT from './ragot/index.js'; // namespace default
 * ```
 *
 * **Core primitives:**
 * | Export | Role |
 * |---|---|
 * | `Module` | Non-visual orchestration: sockets, timers, subscriptions |
 * | `Component` | DOM owner: renders, mounts, and manages a subtree |
 * | `createStateStore` | Proxy-tracked mutable state with subscriber notifications |
 * | `createSelector` | Memoized selector composition |
 * | `ragotRegistry` | Lifecycle-aware dependency injection |
 * | `ragotModules` | Read-only proxy view of registry entries |
 * | `bus` | Global pub/sub for broadcast events |
 * | `createElement` | Create DOM elements with declarative options |
 * | `morphDOM` | In-place DOM patching with keyed reconciliation |
 * | `renderList` / `renderGrid` | Keyed list/grid reconciliation |
 * | `VirtualScroller` | High-level virtual scrolling Component |
 * | `createInfiniteScroll` | Low-level bidirectional scroll primitive |
 * | `createLazyLoader` | High-level lazy image engine |
 * | `createApp` | Bootstrap a root Component into the DOM |
 *
 * **⚠ Selector gotcha:** `$` and `$$` use `querySelector`, which breaks on IDs containing
 * `::` (e.g. auto-detected category IDs like `#auto::media`).
 * Use `document.getElementById(id)` for those.
 *
 * **Source layout:**
 * ```
 * core/selectors.js              → $, $$
 * core/bus.js                    → bus
 * ragotRegistry.js               → ragotRegistry, ragotModules
 * core/stateStore.js             → createStateStore, createSelector
 * core/dom.js                    → createElement, morphDOM, batchAppend, append, prepend, insertBefore, remove
 * core/lifecycle.js              → Module, Component
 * core/renderers.js              → renderList, renderGrid, clearPool
 * core/helpers.js                → css, attr, show, hide, toggle, clear, delegateEvent, createIcon, animateIn, animateOut
 * core/bootstrap.js              → createApp
 * core/primitives/infiniteScroll → createInfiniteScroll
 * core/primitives/lazyLoad       → createLazyLoader
 * core/components/VirtualScroller → VirtualScroller
 * ```
 */

export { $, $$ } from './core/selectors.js';
export { bus } from './core/bus.js';
export { ragotRegistry, ragotModules } from './ragotRegistry.js';
export { createStateStore, createSelector } from './core/stateStore.js';
export { createElement, batchAppend, append, prepend, insertBefore, remove, morphDOM } from './core/dom.js';
export { Module, Component } from './core/lifecycle.js';
export { renderList, renderGrid, clearPool } from './core/renderers.js';
export { createInfiniteScroll } from './core/primitives/infiniteScroll.js';
export { VirtualScroller } from './core/components/VirtualScroller.js';
export { createLazyLoader } from './core/primitives/lazyLoad.js';
export {
    clear,
    delegateEvent,
    css,
    attr,
    createIcon,
    show,
    hide,
    toggle,
    animateIn,
    animateOut
} from './core/helpers.js';
export { createApp } from './core/bootstrap.js';

// ==========================================
// Default export (namespace object)
// ==========================================

/**
 * @typedef {Object} RAGOTNamespace
 * Full RAGOT namespace. Available as the default export or via `window.RAGOT` if globally exposed.
 * @property {function(string, ParentNode=): Element|null} $ - `querySelector` helper
 * @property {function(string, ParentNode=): Element[]} $$ - `querySelectorAll` helper
 * @property {import('./core/bus.js').EventBus} bus - Global event bus singleton
 * @property {typeof import('./core/stateStore.js').createStateStore} createStateStore
 * @property {typeof import('./core/stateStore.js').createSelector} createSelector
 * @property {typeof import('./ragotRegistry.js').ragotRegistry} ragotRegistry
 * @property {typeof import('./ragotRegistry.js').ragotModules} ragotModules
 * @property {typeof import('./core/dom.js').createElement} createElement
 * @property {typeof import('./core/dom.js').batchAppend} batchAppend
 * @property {typeof import('./core/dom.js').append} append
 * @property {typeof import('./core/dom.js').prepend} prepend
 * @property {typeof import('./core/dom.js').insertBefore} insertBefore
 * @property {typeof import('./core/dom.js').remove} remove
 * @property {typeof import('./core/dom.js').morphDOM} morphDOM
 * @property {typeof import('./core/lifecycle.js').Module} Module
 * @property {typeof import('./core/lifecycle.js').Component} Component
 * @property {typeof import('./core/helpers.js').clear} clear
 * @property {typeof import('./core/helpers.js').delegateEvent} delegateEvent
 * @property {typeof import('./core/helpers.js').css} css
 * @property {typeof import('./core/helpers.js').attr} attr
 * @property {typeof import('./core/helpers.js').createIcon} createIcon
 * @property {typeof import('./core/helpers.js').show} show
 * @property {typeof import('./core/helpers.js').hide} hide
 * @property {typeof import('./core/helpers.js').toggle} toggle
 * @property {typeof import('./core/renderers.js').renderList} renderList
 * @property {typeof import('./core/renderers.js').renderGrid} renderGrid
 * @property {typeof import('./core/renderers.js').clearPool} clearPool
 * @property {typeof import('./core/primitives/infiniteScroll.js').createInfiniteScroll} createInfiniteScroll
 * @property {typeof import('./core/components/VirtualScroller.js').VirtualScroller} VirtualScroller
 * @property {typeof import('./core/primitives/lazyLoad.js').createLazyLoader} createLazyLoader
 * @property {typeof import('./core/helpers.js').animateIn} animateIn
 * @property {typeof import('./core/helpers.js').animateOut} animateOut
 * @property {typeof import('./core/bootstrap.js').createApp} createApp
 */

import { $, $$ } from './core/selectors.js';
import { bus } from './core/bus.js';
import { ragotRegistry, ragotModules } from './ragotRegistry.js';
import { createStateStore, createSelector } from './core/stateStore.js';
import { createElement, batchAppend, append, prepend, insertBefore, remove, morphDOM } from './core/dom.js';
import { Module, Component } from './core/lifecycle.js';
import { renderList, renderGrid, clearPool } from './core/renderers.js';
import { createInfiniteScroll } from './core/primitives/infiniteScroll.js';
import { VirtualScroller } from './core/components/VirtualScroller.js';
import { createLazyLoader } from './core/primitives/lazyLoad.js';
import {
    clear,
    delegateEvent,
    css,
    attr,
    createIcon,
    show,
    hide,
    toggle,
    animateIn,
    animateOut
} from './core/helpers.js';
import { createApp } from './core/bootstrap.js';

const RAGOT = {
    $,
    $$,
    bus,
    ragotRegistry,
    ragotModules,
    createStateStore,
    createSelector,
    createElement,
    batchAppend,
    append,
    prepend,
    insertBefore,
    remove,
    morphDOM,
    Module,
    Component,
    clear,
    delegateEvent,
    css,
    attr,
    createIcon,
    show,
    hide,
    toggle,
    renderList,
    renderGrid,
    clearPool,
    createInfiniteScroll,
    VirtualScroller,
    createLazyLoader,
    animateIn,
    animateOut,
    createApp,
};

export default RAGOT;
