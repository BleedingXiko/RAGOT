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
 * VirtualScroller — RAGOT Managed Virtual Scroll Component
 *
 * A proper Component that owns sentinel DOM, chunk insertion/eviction,
 * and placeholder management. Uses createInfiniteScroll internally as the
 * IntersectionObserver engine.
 *
 * DESIGN: Fully layout-agnostic. VirtualScroller knows nothing about vertical
 * vs horizontal layout, CSS grid column spans, flex display:contents, or any
 * other layout detail. Every layout decision is delegated to the caller via
 * three optional hooks:
 *
 *   renderChunk(i)           → HTMLElement | Promise<HTMLElement>  (required)
 *   measureChunk(el, i)      → number (px)   (measure before eviction — optional)
 *   buildPlaceholder(i, px)  → HTMLElement   (build the placeholder — optional)
 *   renderChunk receives an optional second argument:
 *     { token, isCurrent() } so async builders can bail out before doing
 *     expensive or side-effectful work when the same chunk index has already
 *     been superseded by a newer load attempt.
 *
 * If measureChunk is omitted, defaults to el.offsetHeight.
 * If buildPlaceholder is omitted, defaults to a div with height:${px}px.
 * Callers that need horizontal spacers, grid-column spans, display:contents
 * wrappers, or anything else custom supply their own buildPlaceholder.
 *
 * ELEMENT POOLING (poolSize / onRecycle):
 *   By default, evicted chunk elements are discarded and renderChunk is called
 *   again on re-entry. When poolSize > 0, evicted elements are stashed in a
 *   flat FIFO queue. On the next _loadChunk, a queued element is re-inserted
 *   directly and onRecycle(el, i) is called to patch its data — renderChunk
 *   is bypassed entirely. The pool is index-agnostic: any stashed element may
 *   be reused for any chunk index, so onRecycle must update all index-dependent
 *   content. Best for uniform-structure sync chunks with delegated listeners.
 *
 * ASYNC renderChunk:
 *   renderChunk may return a Promise. VirtualScroller inserts a loading
 *   placeholder immediately, then replaces it with the resolved element.
 *   The loading state does not block subsequent load/evict cycles.
 *
 * PLACEHOLDER COMPACTION:
 *   Evicted chunks are compressed into at most one placeholder range on each
 *   side of the live window. This preserves scroll geometry without leaving
 *   one spacer DOM node behind per visited chunk.
 *
 * DOM structure produced by render():
 *
 *   <div class="vs-container [containerClass]">
 *     <div class="vs-sentinel vs-sentinel-top" />    ← leading sentinel
 *     <!-- chunks and placeholders in sorted order (when no chunkContainer) -->
 *     <div class="vs-sentinel vs-sentinel-bottom" /> ← trailing sentinel
 *   </div>
 *
 * When chunkContainer is provided (see options), chunks/placeholders are
 * inserted into that element instead of this.element. Sentinels start in
 * this.element but are moved into chunkContainer by the first sentinel
 * repositioning cycle, placing them alongside chunks in the same layout flow.
 * This is required for bidirectional scrolling in horizontal flex rows.
 *
 * Usage (vertical list):
 *
 *   const vs = new VirtualScroller({
 *       renderChunk:  (i) => buildMyChunk(i),
 *       measureChunk: (el) => el.offsetHeight || 0,
 *       totalItems:   () => items.length,
 *       chunkSize:    20,
 *       maxChunks:    5,
 *       root:         scrollEl,
 *   });
 *   vs.mount(containerEl);
 *   this.addCleanup(() => vs.unmount());
 *
 * Usage (horizontal flex row — display:contents chunks, width-preserving placeholders):
 *
 *   const vs = new VirtualScroller({
 *       renderChunk: async (i) => {
 *           const wrap = createElement('div', { style: { display: 'contents' } });
 *           // ... append cards to wrap
 *           return wrap;
 *       },
 *       measureChunk: (el) => {
 *           let w = 0;
 *           for (const card of el.children) {
 *               w += card.offsetWidth + parseFloat(getComputedStyle(card).marginRight || 0);
 *           }
 *           return w;
 *       },
 *       buildPlaceholder: (i, px) => createElement('div', {
 *           style: { flexShrink: '0', width: `${px}px`, height: '1px', pointerEvents: 'none' }
 *       }),
 *       totalItems:   () => items.length,
 *       chunkSize:    10,
 *       maxChunks:    3,
 *       root:         scrollContainer,
 *       rootMargin:   '0px 500px 0px 500px',
 *   });
 *
 * Usage (CSS grid — sentinels outside grid, display:contents chunks):
 *
 *   const vs = new VirtualScroller({
 *       renderChunk: (i) => { ... return chunkEl with display:contents; },
 *       measureChunk: (el) => {
 *           // offsetHeight is 0 on display:contents — measure via card rects
 *           const cards = el.querySelectorAll('.card');
 *           if (!cards.length) return estimatedHeight;
 *           return cards[cards.length-1].getBoundingClientRect().bottom
 *                - cards[0].getBoundingClientRect().top;
 *       },
 *       buildPlaceholder: (i, px) => createElement('div', {
 *           style: `display:block;height:${px}px;grid-column:1 / -1`
 *       }),
 *       chunkContainer: gridElement,   // chunks go into the grid
 *       totalItems:   () => totalCount,
 *       chunkSize:    30,
 *       maxChunks:    5,
 *       root:         scrollContainer,
 *       rootMargin:   '400px 0px 1200px 0px',
 *   });
 *   vs.mount(wrapperEl);  // sentinels go into wrapperEl, outside the grid
 *
 * @param {Object} options
 * @param {Function}         options.renderChunk        (i: number) => HTMLElement|Promise<HTMLElement> — required
 * @param {Function}         options.totalItems         () => number — required
 * @param {number}           options.chunkSize          — required
 * @param {Function}         [options.measureChunk]     (el: HTMLElement, i: number) => number (px)
 * @param {Function}         [options.buildPlaceholder] (i: number, px: number) => HTMLElement
 * @param {number}           [options.maxChunks=5]
 * @param {HTMLElement|null} [options.root=null]        Scroll root for IntersectionObserver
 * @param {string}           [options.rootMargin='1200px 0px']
 * @param {string}           [options.containerClass]   Extra CSS class on the sentinel container
 * @param {number}           [options.initialChunks=1]  Chunks to load synchronously on mount
 * @param {HTMLElement}      [options.chunkContainer]   If provided, chunks/placeholders are
 *                                                       inserted here instead of this.element.
 *                                                       Sentinels move from this.element into
 *                                                       chunkContainer on first reposition so
 *                                                       they participate in the same layout flow.
 * @param {Function}         [options.onChunkEvicted]   (i: number) => void — called after measurement,
 *                                                       before DOM swap. Useful for stat tracking.
 * @param {number}           [options.childPoolSize=0]  Max recycled child VirtualScrollers to keep.
 *                                                       0 = no pooling (children unmount on eviction).
 *                                                       Non-zero = recycle up to N children for reuse.
 * @param {number}           [options.poolSize=0]       Max evicted chunk elements to retain in a flat
 *                                                       pool for re-insertion. 0 = no pooling (elements
 *                                                       are discarded on eviction and rebuilt via
 *                                                       renderChunk on next load). Non-zero = evicted
 *                                                       elements are detached and stashed; on reload the
 *                                                       oldest stashed element is pulled from the pool
 *                                                       and passed to onRecycle(el, i) instead of
 *                                                       calling renderChunk. The pool is a flat FIFO
 *                                                       queue — elements are not keyed by chunk index,
 *                                                       so onRecycle must update all index-dependent
 *                                                       content (text, src, data attributes, etc.).
 * @param {Function}         [options.onRecycle]        (el: HTMLElement, i: number) => void — called
 *                                                       when a pooled element is reused for chunk i.
 *                                                       Update any data-dependent content here.
 *                                                       Required when poolSize > 0. Sync only.
 */

import { Component } from '../lifecycle.js';
import { createElement } from '../dom.js';
import { createInfiniteScroll } from '../primitives/infiniteScroll.js';

export class VirtualScroller extends Component {
    constructor(options = {}) {
        super({});
        this._options = options;
        this._visibleChunks = new Set();
        this._chunkSizes = new Map();
        this._scrollController = null;
        this._avgChunkSize = 0;    // running average for pre-sizing loading placeholders
        this._measuredCount = 0;    // how many chunks contributed to _avgChunkSize
        this._childScrollers = new Map(); // Map<chunkIndex, VirtualScroller[]> — active children
        this._childPool = [];             // recycled VS instances ready for reuse
        this._elementPool = [];           // recycled chunk elements (flat FIFO queue)
        this._renderEpoch = 0;            // invalidates stale async chunk completions across recycle/rebind
        this._loadTokenSeq = 0;           // monotonically increasing per-chunk load token
        this._chunkLoadTokens = new Map(); // Map<chunkIndex, token> for stale async result rejection
        this._activeChunks = new Map(); // Map<chunkIndex, Element> for re-parenting in rebind
    }

    _emitDebug(event, payload = {}) {
        const onEvent = this._options?.debugHooks?.onEvent;
        if (typeof onEvent !== 'function') return;
        try {
            const includeSnapshot = this._options?.debugHooks?.includeSnapshot === true;
            onEvent({
                event,
                scroller: this._options?.debugLabel || 'vs',
                visibleSize: this._visibleChunks.size,
                ...(includeSnapshot ? this._buildDebugSnapshot() : null),
                ...payload,
            });
        } catch (_) { /* debug hooks must never break scrolling */ }
    }

    render() {
        const { containerClass = '' } = this._options;
        const cls = ['vs-container', containerClass].filter(Boolean).join(' ');
        return createElement('div', { className: cls },
            createElement('div', {
                ref: this.ref('topSentinel'),
                className: 'vs-sentinel vs-sentinel-top'
            }),
            createElement('div', {
                ref: this.ref('bottomSentinel'),
                className: 'vs-sentinel vs-sentinel-bottom'
            })
        );
    }

    onStart() {
        this._initialize();
    }

    _initialize(newOptions = {}, parentEl = null) {
        Object.assign(this._options, newOptions);

        this._restoreSentinelsToContainer();

        if (this.element && parentEl) {
            parentEl.appendChild(this.element);
        }

        const {
            totalItems,
            chunkSize,
            maxChunks = 5,
            root = null,
            rootMargin = '1200px 0px',
            initialChunks = 1,
            axis = 'auto',
        } = this._options;

        this._scrollController = createInfiniteScroll(this, {
            sentinel: this.refs.bottomSentinel,
            topSentinel: this.refs.topSentinel,
            root,
            axis,
            rootMargin,
            chunkSize,
            maxChunks,
            totalItems,
            visibleChunks: () => this._visibleChunks,
            getChunkEl: (i) => this._getChunkOrPlaceholder(i),
            onLoadDirection: ({ direction, batchCount, firstTarget, step }) => {
                return this._loadDirectionBatch(direction, batchCount, firstTarget, step);
            },
            seekToViewport: (direction) => this.seekToViewport(direction),
            onLoadMore: (i) => this._loadChunk(i),
            onEvictChunk: (i) => { this._evictChunk(i); },
        });

        // Re-attach existing visible chunks to the new parent/container.
        const chunkParent = this._chunkParent();
        if (chunkParent) {
            for (const i of this._visibleChunks) {
                const el = this._activeChunks.get(i);
                if (el && el.parentNode !== chunkParent) {
                    chunkParent.appendChild(el);
                }
            }
        }

        for (let i = 0; i < initialChunks; i++) {
            this._loadChunk(i);
        }
    }

    onStop() {
        // Destroy all active child scrollers (disconnects their IOs before
        // we remove the DOM they observe).
        for (const [, children] of this._childScrollers) {
            for (const child of children) {
                try { child.unmount(); } catch (_) { /* already gone */ }
            }
        }
        this._childScrollers.clear();

        // Destroy all pooled (recycled) child scrollers.
        for (const child of this._childPool) {
            try { child.unmount(); } catch (_) { /* already gone */ }
        }
        this._childPool.length = 0;

        // Release all pooled chunk elements (detached from DOM — just drop references).
        this._elementPool.length = 0;

        // Eagerly remove all VS-managed DOM nodes from chunkParent before the
        // sentinel container element is removed by unmount(). Without this,
        // chunks/placeholders linger in the DOM for one extra frame and their
        // containing layout snaps/reflows visibly as the sentinel wrapper
        // disappears. When chunkContainer is an external element the chunks
        // are never removed by unmount() at all, so we must do it here.
        const parent = this._chunkParent();
        if (parent) {
            const toRemove = [];
            for (const el of parent.children) {
                const idx = this._chunkIndex(el);
                // Remove chunks, placeholders, and loading placeholders.
                // Skip non-VS elements (NaN) — they belong to the caller's layout.
                if (!Number.isNaN(idx)) toRemove.push(el);
            }
            for (const el of toRemove) el.parentNode.removeChild(el);
        }

        // createInfiniteScroll registered its own destroy via this.addCleanup()
        // which runs in unmount() → _lc.teardown(). Nothing extra needed there.
        this._scrollController = null;
        this._renderEpoch++;
        this._visibleChunks.clear();
        this._chunkSizes.clear();
        this._chunkLoadTokens.clear();
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * Force observer re-evaluation after an external async data load.
     * Call inside requestAnimationFrame() after new items arrive.
     */
    reset() {
        if (this._scrollController) this._scrollController.reset();
    }

    /**
     * Jump the live window to center around a target index.
     * Useful for jumping to a specific category or date in large lists.
     *
     * @param {number} targetIndex - The index to jump to.
     * @returns {boolean} True if the window changed.
     */
    jumpToIndex(targetIndex) {
        if (!Number.isInteger(targetIndex)) return false;
        const currentMid = Array.from(this._visibleChunks).reduce((a, b) => a + b, 0) / (this._visibleChunks.size || 1);
        const direction = targetIndex >= currentMid ? 'forward' : 'backward';
        const changed = this._jumpWindowToIndex(targetIndex, direction);
        if (changed) this._scheduleReset();
        return changed;
    }

    /** Returns a snapshot of currently visible chunk indices. */
    getVisibleChunks() {
        return new Set(this._visibleChunks);
    }

    /** Returns the live DOM element (chunk or placeholder) for index i. */
    getChunkElement(i) {
        return this._getChunkOrPlaceholder(i);
    }

    /**
     * Fast-seek the live window toward the current viewport using placeholder
     * geometry, avoiding stepwise chunk hydration across every skipped index.
     *
     * @param {'forward'|'backward'} direction
     * @returns {boolean} True when the live window was jumped.
     */
    seekToViewport(direction = 'forward') {
        if (direction !== 'forward' && direction !== 'backward') return false;
        const parent = this._chunkParent();
        if (!parent || this._visibleChunks.size === 0) return false;

        const resolvedAxis = this._resolveViewportAxis();
        const rootBounds = this._getViewportBounds(this._options?.root || window, resolvedAxis);
        if (!rootBounds) return false;

        const targetIndex = this._findSeekTargetIndex(parent, direction, rootBounds, resolvedAxis);
        if (!Number.isInteger(targetIndex)) return false;

        return this._jumpWindowToIndex(targetIndex, direction);
    }

    /**
     * Re-measure a live chunk after late content mounts inside it.
     * Useful when callers intentionally attach nested content after the
     * parent chunk has already been inserted into the DOM.
     */
    refreshChunkMeasurement(i) {
        if (!this._visibleChunks.has(i)) return 0;
        const el = this.getChunkElement(i);
        if (!el || el.dataset?.vsPlaceholder !== undefined) return 0;

        const measured = this._measure(el, i);
        if (measured > 0) {
            this._chunkSizes.set(i, measured);
            this._scheduleReset();
        }
        return measured;
    }

    getDebugState() {
        const root = this._options?.root || null;
        const axis = this._options?.axis || 'auto';
        return {
            label: this._options?.debugLabel || 'vs',
            axis,
            visibleChunks: Array.from(this._visibleChunks).sort((a, b) => a - b),
            rootConnected: !!root?.isConnected,
            rootScrollTop: root ? (root.scrollTop || 0) : null,
            rootScrollLeft: root ? (root.scrollLeft || 0) : null,
            clientHeight: root ? (root.clientHeight || 0) : null,
            clientWidth: root ? (root.clientWidth || 0) : null,
            scrollHeight: root ? (root.scrollHeight || 0) : null,
            scrollWidth: root ? (root.scrollWidth || 0) : null,
            topSentinelConnected: !!this.refs?.topSentinel?.isConnected,
            bottomSentinelConnected: !!this.refs?.bottomSentinel?.isConnected,
            ...this._buildDebugSnapshot(),
        };
    }

    /**
     * Acquire a child VirtualScroller for a parent chunk. Internally handles
     * recycling: if the pool has a paused instance it is rebound to the new
     * options and parent; otherwise a fresh VS is created and mounted.
     *
     * The returned child is automatically tracked. On parent chunk eviction
     * it will be recycled (if pool has room) or destroyed. On parent VS
     * teardown all children (active + pooled) are destroyed.
     *
     * @param {number} chunkIndex  - Parent chunk this child belongs to
     * @param {Object} options     - Full VirtualScroller options for a fresh
     *                               instance, or the subset to merge when
     *                               recycling (renderChunk, root, totalItems…)
     * @param {HTMLElement} parentEl - Container to mount/reattach into
     * @returns {VirtualScroller}    The ready-to-use child instance
     */
    acquireChild(chunkIndex, options, parentEl) {
        let child;
        const childPoolCap = this._options.childPoolSize || 0;
        if (this._childPool.length) {
            child = this._childPool.pop();
            child.rebind(options, parentEl);
            this._emitDebug('child_rebind', {
                chunkIndex,
                childLabel: child?._options?.debugLabel || options?.debugLabel || 'child',
            });
        } else {
            child = new VirtualScroller(options);
            child.mount(parentEl);
            this._emitDebug('child_mount', {
                chunkIndex,
                childLabel: child?._options?.debugLabel || options?.debugLabel || 'child',
            });
        }
        // Register for lifecycle tracking
        if (!this._visibleChunks.has(chunkIndex)) {
            // Parent chunk was evicted during async renderChunk — clean up
            if (childPoolCap > 0 && this._childPool.length < childPoolCap) {
                try { child.recycle(); } catch (_) { /* already gone */ }
                this._childPool.push(child);
                this._emitDebug('child_repool', {
                    chunkIndex,
                    childLabel: child?._options?.debugLabel || options?.debugLabel || 'child',
                });
            } else {
                try { child.unmount(); } catch (_) { /* already gone */ }
            }
            this._emitDebug('child_pruned', {
                chunkIndex,
                childLabel: child?._options?.debugLabel || options?.debugLabel || 'child',
            });
            return child;
        }
        const arr = this._childScrollers.get(chunkIndex);
        if (arr) arr.push(child);
        else this._childScrollers.set(chunkIndex, [child]);
        this._emitDebug('child_register', {
            chunkIndex,
            childCount: (this._childScrollers.get(chunkIndex) || []).length,
            childLabel: child?._options?.debugLabel || options?.debugLabel || 'child',
        });
        return child;
    }

    /**
     * Lightweight teardown that keeps this instance reusable (recyclable).
     * Disconnects IntersectionObserver, cancels rAFs, strips chunk content
     * from the container (sentinels stay), detaches element from DOM but
     * keeps it in memory. State (visibleChunks, chunkSizes) is cleared.
     *
     * Works for ANY VirtualScroller — not just nested children. Use this
     * instead of unmount() when you plan to rebind() the same instance to
     * new data (e.g. category switch, filter change, folder navigation).
     * The DOM shell (sentinels, container) is preserved and reused.
     *
     * After recycle(), call rebind(options, parentEl) to reuse this instance.
     */
    recycle() {
        if (this._scrollController) {
            this._scrollController.destroy();
            this._scrollController = null;
        }

        // Recycle/unmount active child scrollers before stripping parent chunks.
        // This prevents stale nested child instances from surviving across
        // recycle() -> rebind() loops and accumulating observer handles.
        const childPoolCap = this._options.childPoolSize || 0;
        if (this._childScrollers.size > 0) {
            for (const [, children] of this._childScrollers) {
                for (const child of children) {
                    if (childPoolCap > 0 && this._childPool.length < childPoolCap) {
                        try { child.recycle(); } catch (_) { /* already gone */ }
                        this._childPool.push(child);
                    } else {
                        try { child.unmount(); } catch (_) { /* already gone */ }
                    }
                }
            }
            this._childScrollers.clear();
        }

        // If child pooling is disabled, release any pooled children eagerly.
        if (childPoolCap <= 0 && this._childPool.length > 0) {
            for (const child of this._childPool) {
                try { child.unmount(); } catch (_) { /* already gone */ }
            }
            this._childPool.length = 0;
        }

        // Strip chunk content (keep sentinels for reuse)
        const parent = this._chunkParent();
        if (parent) {
            const toRemove = [];
            for (const el of parent.children) {
                const idx = this._chunkIndex(el);
                if (!Number.isNaN(idx) && Number.isFinite(idx)) toRemove.push(el);
            }
            for (const el of toRemove) el.remove();
        }

        // When using an external chunkContainer, reset() will have moved the
        // sentinels out of this.element and into that container. Pull them back
        // into the preserved shell before we stash this instance for reuse so
        // rebind() always starts from a clean, self-contained DOM tree.
        this._restoreSentinelsToContainer();

        this._visibleChunks.clear();
        this._activeChunks.clear();
        this._chunkSizes.clear();
        this._avgChunkSize = 0;
        this._measuredCount = 0;
        this._elementPool.length = 0;
        this._renderEpoch++;
        this._chunkLoadTokens.clear();

        // Detach element from DOM (keep in memory for reuse)
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    /**
     * Rebind a recycled VirtualScroller to new data and reattach to a new
     * parent element. Updates data-dependent options (renderChunk, totalItems,
     * root, etc.), reattaches the preserved element tree, loads initial chunks,
     * and reconnects the IntersectionObserver.
     *
     * Works for ANY recycled VirtualScroller — standalone or nested child.
     * Only the provided option keys are overwritten; everything else (chunkSize,
     * maxChunks, measureChunk, buildPlaceholder, etc.) is preserved from the
     * original construction.
     *
     * @param {Object} options - Options to merge (typically renderChunk, root, totalItems)
     * @param {HTMLElement} parentEl - New parent to attach this.element into
     */
    rebind(options, parentEl) {
        this._initialize(options, parentEl);
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    /**
     * The container that chunks and placeholders are inserted into.
     * Defaults to this.element (the sentinel container itself).
     * When options.chunkContainer is set, chunks go there while sentinels
     * stay in this.element — used by CSS grid layouts where sentinels must
     * not consume grid cells.
     */
    _chunkParent() {
        return this._options.chunkContainer || this.element;
    }

    _restoreSentinelsToContainer() {
        if (!this.element) return;

        const topSentinel = this.refs?.topSentinel;
        const bottomSentinel = this.refs?.bottomSentinel;
        if (!topSentinel || !bottomSentinel) return;

        if (topSentinel.parentNode !== this.element) {
            this.element.appendChild(topSentinel);
        }
        if (bottomSentinel.parentNode !== this.element) {
            this.element.appendChild(bottomSentinel);
        }
        if (topSentinel.nextSibling !== bottomSentinel) {
            this.element.insertBefore(topSentinel, bottomSentinel);
        }
    }

    _loadChunk(i) {
        if (this._visibleChunks.has(i)) return;
        const parent = this._chunkParent();
        if (!parent) return;

        const { totalItems, chunkSize, renderChunk, onRecycle } = this._options;
        if (i * chunkSize >= totalItems()) return;
        const renderEpoch = this._renderEpoch;
        const loadToken = ++this._loadTokenSeq;
        this._chunkLoadTokens.set(i, loadToken);
        const loadCtx = {
            token: loadToken,
            isCurrent: () => this._isCurrentLoad(i, loadToken, renderEpoch),
        };

        // Mark as visible immediately so concurrent calls don't double-load.
        // The slot is reserved; the actual element arrives sync or async below.
        this._visibleChunks.add(i);
        this._emitDebug('load_start', { chunkIndex: i, token: loadToken });

        // Pool hit — reuse a detached element rather than calling renderChunk.
        if (this._elementPool.length > 0) {
            const pooled = this._elementPool.shift();
            if (typeof onRecycle === 'function') onRecycle(pooled, i);
            pooled.dataset.vsChunk = String(i);
            this._activeChunks.set(i, pooled);
            this._insertChunkEl(pooled, i, parent);
            this._scheduleReset();
            this._emitDebug('load_pool_reuse', { chunkIndex: i, token: loadToken });
            return;
        }

        const result = renderChunk(i, loadCtx);

        if (result && typeof result.then === 'function') {
            // Async renderChunk: insert a loading placeholder now, swap when resolved.
            // Return the promise so infiniteScroll.js can hold _loadingBottom/_loadingTop
            // until the chunk actually lands — without this, the backpressure lock clears
            // on the next rAF while the fetch is still in-flight, causing rapid-fire loads
            // that produce a DOM explosion of loading placeholders that never resolve.
            const loadingEl = this._buildLoadingPlaceholder(i);
            this._insertChunkEl(loadingEl, i, parent);
            return result.then((chunkEl) => {
                if (!chunkEl) {
                    if (this._isCurrentLoad(i, loadToken, renderEpoch)) {
                        this._visibleChunks.delete(i);
                        this._chunkLoadTokens.delete(i);
                        this._evictChildScrollers(i);
                        this._removeChunkShell(i, parent);
                        this._scheduleReset();
                        this._emitDebug('load_null', { chunkIndex: i, token: loadToken });
                    }
                    return;
                }
                if (!this._isCurrentLoad(i, loadToken, renderEpoch)) {
                    // Chunk was evicted while fetch was in flight — discard result.
                    this._evictChildScrollers(i);
                    this._emitDebug('load_stale', { chunkIndex: i, token: loadToken });
                    return;
                }
                chunkEl.dataset.vsChunk = String(i);
                this._activeChunks.set(i, chunkEl);

                const measured = this._measure(chunkEl, i);
                if (measured > 0) {
                    this._chunkSizes.set(i, measured);
                    this._measuredCount++;
                    this._avgChunkSize += (measured - this._avgChunkSize) / this._measuredCount;
                }

                this._insertChunkEl(chunkEl, i, parent);
                this._scheduleReset();
                this._emitDebug('load_commit', { chunkIndex: i, token: loadToken, async: true });
            }).catch((e) => {
                console.error(`[VirtualScroller] renderChunk(${i}) failed:`, e);
                if (!this._isCurrentLoad(i, loadToken, renderEpoch)) return;
                this._visibleChunks.delete(i);
                this._chunkLoadTokens.delete(i);
                this._evictChildScrollers(i);
                this._removeChunkShell(i, parent);
                this._scheduleReset();
                this._emitDebug('load_error', { chunkIndex: i, token: loadToken, message: String(e?.message || e) });
            });
        } else {
            // Synchronous renderChunk.
            const chunkEl = result;
            if (!chunkEl) {
                this._visibleChunks.delete(i);
                this._chunkLoadTokens.delete(i);
                this._emitDebug('load_null', { chunkIndex: i, token: loadToken });
                return;
            }
            if (!this._isCurrentLoad(i, loadToken, renderEpoch)) {
                this._evictChildScrollers(i);
                this._emitDebug('load_stale', { chunkIndex: i, token: loadToken });
                return;
            }
            chunkEl.dataset.vsChunk = String(i);
            this._activeChunks.set(i, chunkEl);

            const measured = this._measure(chunkEl, i);
            if (measured > 0) {
                this._chunkSizes.set(i, measured);
                this._measuredCount++;
                this._avgChunkSize += (measured - this._avgChunkSize) / this._measuredCount;
            }

            this._insertChunkEl(chunkEl, i, parent);
            this._scheduleReset();
            this._emitDebug('load_commit', { chunkIndex: i, token: loadToken, async: false });
        }
    }

    /**
     * Insert a chunk element into parent in sorted order, replacing any
     * pre-stamped placeholder for the same index if present.
     */
    _insertChunkEl(chunkEl, i, parent) {
        const existingChunk = this._findManagedDirectChild(parent, (el) => {
            return el.dataset?.vsChunk === String(i);
        });
        if (existingChunk && existingChunk !== chunkEl) {
            existingChunk.parentNode.replaceChild(chunkEl, existingChunk);
            return;
        }
        const placeholder = this._findManagedDirectChild(parent, (el) => {
            const bounds = this._getPlaceholderBounds(el);
            return bounds?.start === i && bounds?.end === i;
        });
        if (placeholder) {
            placeholder.parentNode.insertBefore(chunkEl, placeholder);
            placeholder.parentNode.removeChild(placeholder);
            return;
        } else {
            // Insert in sorted virtual order among VS-managed elements only.
            // Non-VS elements (subfolder cards, other layout elements) return
            // NaN from _chunkIndex and are skipped. Top sentinel returns
            // -Infinity (sorts first), bottom sentinel returns +Infinity
            // (natural insertion stop).
            let inserted = false;
            for (const el of parent.children) {
                const idx = this._chunkIndex(el);
                if (Number.isNaN(idx)) continue;   // skip non-VS elements
                if (idx > i) {
                    parent.insertBefore(chunkEl, el);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                parent.appendChild(chunkEl);
            }
        }
    }

    _evictChunk(i) {
        if (!this._visibleChunks.has(i)) return;
        const parent = this._chunkParent();
        if (!parent) return;
        this._chunkLoadTokens.delete(i);

        const chunkEl = this._findManagedDirectChild(parent, (el) => {
            return el.dataset?.vsChunk === String(i);
        });
        if (!chunkEl) {
            this._visibleChunks.delete(i);
            this._activeChunks.delete(i);
            this._emitDebug('evict_missing', { chunkIndex: i });
            return;
        }

        // 1. MEASURE with children still present — accurate height for placeholder
        const measured = this._measure(chunkEl, i);
        if (measured > 0) {
            this._chunkSizes.set(i, measured);
            this._measuredCount++;
            this._avgChunkSize += (measured - this._avgChunkSize) / this._measuredCount;
        }

        // 2. Fire optional callback (e.g. eviction counter)
        if (typeof this._options.onChunkEvicted === 'function') {
            this._options.onChunkEvicted(i);
        }

        // 3. Recycle or unmount child scrollers (after measure, before DOM swap)
        this._evictChildScrollers(i);

        // 4. Swap chunk for placeholder
        const phSize = this._chunkSizes.get(i) || measured || Math.round(this._avgChunkSize) || 0;
        const placeholder = this._buildPlaceholder(i, phSize);

        chunkEl.parentNode.insertBefore(placeholder, chunkEl);
        chunkEl.parentNode.removeChild(chunkEl);

        // 5. Pool the detached element if poolSize allows, otherwise discard.
        const poolCap = this._options.poolSize || 0;
        if (poolCap > 0 && this._elementPool.length < poolCap) {
            this._elementPool.push(chunkEl);
        }

        this._visibleChunks.delete(i);
        this._activeChunks.delete(i);
        this._scheduleReset();
        this._emitDebug('evict', { chunkIndex: i, pooled: poolCap > 0 && this._elementPool.includes(chunkEl) });
    }

    /**
     * Recycle or unmount all child VirtualScrollers for a chunk.
     * If childPoolSize > 0 and pool has room, children are recycled (paused
     * and kept in memory for reuse). Otherwise they are hard-destroyed.
     */
    _evictChildScrollers(chunkIndex) {
        const children = this._childScrollers.get(chunkIndex);
        if (!children) return;
        const poolCap = this._options.childPoolSize || 0;
        for (const child of children) {
            if (poolCap > 0 && this._childPool.length < poolCap) {
                try { child.recycle(); } catch (_) { /* already gone */ }
                this._childPool.push(child);
                this._emitDebug('child_recycle', {
                    chunkIndex,
                    childLabel: child?._options?.debugLabel || 'child',
                });
            } else {
                try { child.unmount(); } catch (_) { /* already gone */ }
                this._emitDebug('child_unmount', {
                    chunkIndex,
                    childLabel: child?._options?.debugLabel || 'child',
                });
            }
        }
        this._childScrollers.delete(chunkIndex);
    }

    _measure(el, i) {
        const { measureChunk } = this._options;
        if (typeof measureChunk === 'function') return measureChunk(el, i) || 0;
        return el.offsetHeight || this._chunkSizes.get(i) || 0;
    }

    _buildPlaceholder(i, px) {
        const { buildPlaceholder } = this._options;
        if (typeof buildPlaceholder === 'function') {
            const el = buildPlaceholder(i, px);
            el.dataset.vsPlaceholder = String(i);
            return el;
        }
        // Default: simple height-preserving block div
        return createElement('div', {
            className: 'vs-placeholder',
            dataset: { vsPlaceholder: String(i) },
            style: `height:${px}px`,
        });
    }

    // NOTE: Range-placeholder helpers are currently dormant.
    // Active runtime eviction builds single-index placeholders via _buildPlaceholder().
    // These methods are intentionally retained for future compaction work and are
    // not part of the current load/evict execution path.
    _buildPlaceholderRange(start, end, px) {
        const el = this._buildPlaceholder(start, px);
        el.dataset.vsPlaceholder = String(start);
        el.dataset.vsPlaceholderStart = String(start);
        el.dataset.vsPlaceholderEnd = String(end);
        el.dataset.vsPlaceholderPx = String(px);
        return el;
    }

    /**
     * A minimal inline loading placeholder used while an async renderChunk resolves.
     * Gets data-vs-chunk stamped on it so sorted insertion and eviction work correctly
     * before the real element arrives.
     *
     * Pre-sized using previously measured chunk heights or the running average
     * so that content doesn't shift wildly when the real chunk arrives.
     */
    _buildLoadingPlaceholder(i) {
        // Use a previously measured size for this index, or fallback to
        // the running average across all measured chunks.
        const knownHeight = this._chunkSizes.get(i);
        const estimatedSize = knownHeight || Math.round(this._avgChunkSize) || 0;
        const axis = this._options?.axis || 'vertical';
        let style = {};

        if (estimatedSize > 0) {
            if (axis === 'horizontal') {
                style = {
                    flex: '0 0 auto',
                    minWidth: `${estimatedSize}px`,
                    height: '1px',
                };
            } else {
                style = { minHeight: `${estimatedSize}px` };
            }
        } else if (axis === 'horizontal') {
            style = {
                flex: '0 0 auto',
                minWidth: '24px',
                height: '1px',
            };
        }
        return createElement('div', {
            className: 'vs-chunk-loading',
            dataset: { vsChunk: String(i) },
            style,
        });
    }

    _getChunkOrPlaceholder(i) {
        const parent = this._chunkParent();
        if (!parent) return null;
        return this._findManagedDirectChild(parent, (el) => {
            if (el.dataset?.vsChunk === String(i)) return true;
            const bounds = this._getPlaceholderBounds(el);
            return bounds ? bounds.start <= i && i <= bounds.end : false;
        });
    }

    _removeChunkShell(i, parent) {
        if (!parent) return;
        const shell = this._findManagedDirectChild(parent, (el) => {
            return el.dataset?.vsChunk === String(i);
        });
        if (shell?.parentNode) shell.parentNode.removeChild(shell);
    }

    /**
     * Return the virtual sort index of a child element.
     * - Chunks and placeholders return their chunk index.
     * - Top sentinel returns -Infinity (sorts before all chunks).
     * - Bottom sentinel returns +Infinity (sorts after all chunks, acts as insertion stop).
     * - Non-VS elements (subfolder cards etc.) return NaN (skipped by _insertChunkEl).
     */
    _chunkIndex(el) {
        const c = el.dataset.vsChunk;
        if (c !== undefined && c !== '') return parseInt(c, 10);
        const rangeStart = el.dataset.vsPlaceholderStart;
        if (rangeStart !== undefined && rangeStart !== '') return parseInt(rangeStart, 10);
        const p = el.dataset.vsPlaceholder;
        if (p !== undefined && p !== '') return parseInt(p, 10);
        if (el.classList.contains('vs-sentinel-bottom')) return Infinity;
        if (el.classList.contains('vs-sentinel-top')) return -Infinity;
        return NaN;
    }

    /**
     * Trigger a sentinel reposition + re-observation after a load/evict.
     * reset() in createInfiniteScroll is already rAF-coalesced, so calling
     * it directly here is safe — rapid _scheduleReset() calls collapse into
     * a single rAF inside the scroll controller.
     */
    _scheduleReset() {
        if (this._scrollController) this._scrollController.reset();
    }

    _loadDirectionBatch(direction, batchCount, firstTarget, step) {
        const results = [];
        const cappedBatch = Math.max(1, batchCount);

        for (let offset = 0; offset < cappedBatch; offset++) {
            const target = firstTarget + (offset * step);
            if (direction === 'forward' && target < firstTarget) break;
            if (direction === 'backward' && target > firstTarget) break;

            const result = this._loadChunk(target);
            if (result && typeof result.finally === 'function') {
                results.push(result);
            }
        }

        if (results.length > 0) return Promise.allSettled(results);
        return null;
    }

    _resolveViewportAxis() {
        const axis = this._options?.axis || 'auto';
        if (axis === 'horizontal' || axis === 'vertical') return axis;

        const root = this._options?.root || null;
        if (root && root !== window) {
            const scrollableX = Math.max(0, (root.scrollWidth || 0) - (root.clientWidth || 0));
            const scrollableY = Math.max(0, (root.scrollHeight || 0) - (root.clientHeight || 0));
            return scrollableX > scrollableY ? 'horizontal' : 'vertical';
        }

        return 'vertical';
    }

    _getViewportBounds(el, axis) {
        if (!el) return null;
        if (el === window) {
            if (axis === 'horizontal') {
                return { start: 0, end: window.innerWidth || 0 };
            }
            return { start: 0, end: window.innerHeight || 0 };
        }

        const rect = el.getBoundingClientRect?.();
        if (!rect) return null;
        if (axis === 'horizontal') {
            if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right) || rect.right <= rect.left) return null;
            return { start: rect.left, end: rect.right };
        }
        if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom) || rect.bottom <= rect.top) return null;
        return { start: rect.top, end: rect.bottom };
    }

    _findSeekTargetIndex(parent, direction, rootBounds, axis) {
        const visibleMin = Math.min(...this._visibleChunks);
        const visibleMax = Math.max(...this._visibleChunks);
        const children = Array.from(parent.children);

        if (direction === 'forward') {
            for (const el of children) {
                const idx = this._chunkIndex(el);
                if (Number.isNaN(idx) || !Number.isFinite(idx) || idx <= visibleMax) continue;

                const bounds = this._getViewportBounds(el, axis);
                if (!bounds) continue;
                if (bounds.end < rootBounds.start) continue;

                const placeholderBounds = this._getPlaceholderBounds(el);
                if (placeholderBounds) return placeholderBounds.start;
                if (el.dataset?.vsChunk !== undefined) return idx;
            }
            return null;
        }

        for (let n = children.length - 1; n >= 0; n--) {
            const el = children[n];
            const idx = this._chunkIndex(el);
            if (Number.isNaN(idx) || !Number.isFinite(idx) || idx >= visibleMin) continue;

            const bounds = this._getViewportBounds(el, axis);
            if (!bounds) continue;
            if (bounds.start > rootBounds.end) continue;

            const placeholderBounds = this._getPlaceholderBounds(el);
            if (placeholderBounds) return placeholderBounds.end;
            if (el.dataset?.vsChunk !== undefined) return idx;
        }

        return null;
    }

    _jumpWindowToIndex(targetIndex, direction) {
        const { totalItems, chunkSize, maxChunks = 5 } = this._options;
        const totalChunks = Math.ceil(totalItems() / chunkSize);
        if (!Number.isFinite(totalChunks) || totalChunks <= 0) return false;

        const liveCap = Math.max(1, maxChunks);
        let start = direction === 'forward'
            ? targetIndex
            : targetIndex - liveCap + 1;

        start = Math.max(0, Math.min(start, Math.max(0, totalChunks - liveCap)));
        const end = Math.min(totalChunks - 1, start + liveCap - 1);
        const targetWindow = new Set();
        for (let i = start; i <= end; i++) targetWindow.add(i);

        let changed = false;
        for (let i = start; i <= end; i++) {
            if (this._visibleChunks.has(i)) continue;
            this._loadChunk(i);
            changed = true;
        }

        const currentVisible = Array.from(this._visibleChunks).sort((a, b) => a - b);
        for (const i of currentVisible) {
            if (targetWindow.has(i)) continue;
            this._evictChunk(i);
            changed = true;
        }

        return changed;
    }

    _buildDebugSnapshot() {
        const parent = this._chunkParent();
        const visibleWindow = Array.from(this._visibleChunks).sort((a, b) => a - b);
        if (!parent) {
            return {
                visibleWindow: visibleWindow.join(','),
                placeholders: '',
                domWindow: '',
                topPrev: '',
                topNext: '',
                bottomPrev: '',
                bottomNext: '',
            };
        }

        const domWindow = [];
        const placeholderRanges = [];
        for (const el of parent.children) {
            const label = this._describeManagedNode(el);
            if (!label) continue;
            domWindow.push(label);
            if (label.startsWith('P')) placeholderRanges.push(label.slice(1));
        }

        return {
            visibleWindow: visibleWindow.join(','),
            placeholders: placeholderRanges.join('|'),
            domWindow: domWindow.join('>'),
            topPrev: this._describeManagedNode(this.refs?.topSentinel?.previousElementSibling),
            topNext: this._describeManagedNode(this.refs?.topSentinel?.nextElementSibling),
            bottomPrev: this._describeManagedNode(this.refs?.bottomSentinel?.previousElementSibling),
            bottomNext: this._describeManagedNode(this.refs?.bottomSentinel?.nextElementSibling),
        };
    }

    _describeManagedNode(el) {
        if (!el) return '';
        if (el === this.refs?.topSentinel) return 'T';
        if (el === this.refs?.bottomSentinel) return 'B';

        const chunkIndex = el.dataset?.vsChunk;
        if (chunkIndex !== undefined && chunkIndex !== '') return `C${chunkIndex}`;

        const bounds = this._getPlaceholderBounds(el);
        if (!bounds) return '';
        if (bounds.start === bounds.end) return `P${bounds.start}`;
        return `P${bounds.start}-${bounds.end}`;
    }

    _getSentinelAnchor(i, chunkEl, direction) {
        if (!chunkEl) return null;
        return chunkEl;
    }

    _isCurrentLoad(i, token, renderEpoch) {
        return (
            this._renderEpoch === renderEpoch &&
            this._chunkLoadTokens.get(i) === token &&
            this._visibleChunks.has(i)
        );
    }

    _getPlaceholderElForIndex(i, parent) {
        for (const el of parent.children) {
            const bounds = this._getPlaceholderBounds(el);
            if (!bounds) continue;
            if (bounds.start <= i && i <= bounds.end) return el;
        }
        return null;
    }

    _findManagedDirectChild(parent, predicate) {
        if (!parent) return null;
        for (const el of parent.children) {
            if (!predicate(el)) continue;
            return el;
        }
        return null;
    }

    _getPlaceholderBounds(el) {
        if (!el?.dataset) return null;

        const rangeStart = el.dataset.vsPlaceholderStart;
        if (rangeStart !== undefined && rangeStart !== '') {
            const start = parseInt(rangeStart, 10);
            const rawEnd = el.dataset.vsPlaceholderEnd ?? rangeStart;
            const end = parseInt(rawEnd, 10);
            if (Number.isNaN(start) || Number.isNaN(end)) return null;
            return { start, end };
        }

        const single = el.dataset.vsPlaceholder;
        if (single !== undefined && single !== '') {
            const index = parseInt(single, 10);
            if (Number.isNaN(index)) return null;
            return { start: index, end: index };
        }

        return null;
    }

    _getPlaceholderPx(el) {
        const rawPx = parseFloat(el?.dataset?.vsPlaceholderPx ?? '');
        if (Number.isFinite(rawPx)) return rawPx;

        const bounds = this._getPlaceholderBounds(el);
        if (!bounds) return 0;
        return this._sumChunkSizes(bounds.start, bounds.end);
    }

    _sumChunkSizes(start, end) {
        let total = 0;
        for (let i = start; i <= end; i++) {
            total += this._chunkSizes.get(i) || 0;
        }
        return total;
    }

    _mergeAdjacentPlaceholders(placeholderEl) {
        let current = placeholderEl;
        let prev = this._findAdjacentPlaceholder(current, 'previousElementSibling');
        while (prev) {
            current = this._mergePlaceholderPair(prev, current);
            prev = this._findAdjacentPlaceholder(current, 'previousElementSibling');
        }

        let next = this._findAdjacentPlaceholder(current, 'nextElementSibling');
        while (next) {
            current = this._mergePlaceholderPair(current, next);
            next = this._findAdjacentPlaceholder(current, 'nextElementSibling');
        }

        return current;
    }

    _findAdjacentPlaceholder(el, direction) {
        let cursor = el?.[direction] || null;
        while (cursor) {
            const bounds = this._getPlaceholderBounds(cursor);
            if (bounds) return cursor;

            const idx = this._chunkIndex(cursor);
            if (!Number.isNaN(idx)) return null;
            cursor = cursor[direction] || null;
        }
        return null;
    }

    _mergePlaceholderPair(leftEl, rightEl) {
        const left = this._getPlaceholderBounds(leftEl);
        const right = this._getPlaceholderBounds(rightEl);
        if (!left || !right) return rightEl || leftEl;
        if (left.end + 1 < right.start) return rightEl;

        const merged = this._buildPlaceholderRange(
            Math.min(left.start, right.start),
            Math.max(left.end, right.end),
            this._getPlaceholderPx(leftEl) + this._getPlaceholderPx(rightEl),
        );

        const parent = leftEl.parentNode;
        parent.replaceChild(merged, leftEl);
        if (rightEl.parentNode === parent) {
            parent.removeChild(rightEl);
        }
        return merged;
    }
}
