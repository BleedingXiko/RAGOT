import { $, $$ } from '../core/selectors.js';
import { bus } from '../core/bus.js';
import { createStateStore, createSelector } from '../core/stateStore.js';
import { createElement, batchAppend, append, prepend, insertBefore, remove, morphDOM } from '../core/dom.js';
import { Module, Component } from '../core/lifecycle.js';
import { renderList, renderGrid, clearPool } from '../core/renderers.js';
import { createInfiniteScroll } from '../core/primitives/infiniteScroll.js';
import { VirtualScroller } from '../core/components/VirtualScroller.js';
import { createLazyLoader } from '../core/primitives/lazyLoad.js';
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
} from '../core/helpers.js';
import { createApp } from '../core/bootstrap.js';
import { ragotModules, ragotRegistry } from '../ragotRegistry.js';

const RAGOT = {
    $,
    $$,
    bus,
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
    ragotRegistry,
    ragotModules,
};

const scope = typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
        ? window
        : typeof self !== 'undefined'
            ? self
            : this;

scope.RAGOT = RAGOT;
