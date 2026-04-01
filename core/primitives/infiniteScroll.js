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
 * createInfiniteScroll — RAGOT Bounded Scroll Primitive
 *
 * Manages chunk-based virtual scrolling in both directions. DOM stays bounded
 * regardless of total item count — old chunks are evicted as new ones load.
 *
 * Design:
 *   - Watches topSentinel and bottomSentinel with one IntersectionObserver
 *   - Bottom visible → load next chunk, evict min if over maxChunks
 *   - Top visible    → load prev chunk, evict max if over maxChunks
 *   - No rendering opinion — caller updates its own state/DOM in onLoadMore / onEvictChunk
 *   - Cleanup tied to RAGOT lifecycle owner via owner.addCleanup()
 *
 * Sentinel repositioning (bidirectional scroll):
 *   When getChunkEl is provided, reset() automatically repositions topSentinel
 *   to just before the first visible chunk and sentinel (trailing) to just after
 *   the last visible chunk. This ensures the IntersectionObserver fires correctly
 *   at any scroll position — without it the leading sentinel stays at the absolute
 *   top/left and never re-intersects after the first forward scroll.
 *
 * Sentinel lifecycle:
 *   Both sentinels must exist in the DOM when createInfiniteScroll is called
 *   (call from onStart(), after mount() has run render()). Render them
 *   unconditionally so morphDOM never removes them.
 *
 * @param {Component|Module} owner  RAGOT lifecycle owner
 * @param {Object} options
 * @param {HTMLElement}  options.sentinel       Trailing-edge sentinel (bottom / right)
 * @param {HTMLElement}  options.topSentinel    Leading-edge sentinel (top / left)
 * @param {Function}     options.onLoadMore     (chunkIndex: number) => void
 * @param {Function}     options.onEvictChunk   (chunkIndex: number) => void
 * @param {Function}     [options.onLoadDirection] ({ direction, batchCount }) => void|Promise
 *                                              Optional direction-aware batch loader. Use this
 *                                              when the caller can safely hydrate multiple
 *                                              adjacent chunks in one go. Falls back to repeated
 *                                              onLoadMore() calls when omitted.
 * @param {Function}     [options.seekToViewport] (direction: 'forward'|'backward') => boolean
 *                                              Optional fast-seek hook. When provided,
 *                                              viewport sync may jump the live window
 *                                              directly to placeholder-backed geometry
 *                                              before falling back to batched loading.
 * @param {Function}     options.visibleChunks  () => Set<number>
 * @param {Function}     options.totalItems     () => number
 * @param {Function}     [options.getChunkEl]   (chunkIndex: number) => HTMLElement|null
 *                                              Returns the DOM element (chunk or placeholder)
 *                                              for a given chunk index. When provided,
 *                                              reset() repositions sentinels to flank the
 *                                              visible window automatically.
 * @param {number}       [options.chunkSize=30]
 * @param {number}       [options.maxChunks=5]
 * @param {string}       [options.rootMargin='1200px 0px']
 * @param {HTMLElement|null} [options.root=null]
 * @returns {{ reset: Function, destroy: Function }}
 */
export function createInfiniteScroll(owner, options = {}) {
    const {
        sentinel,
        topSentinel,
        onLoadMore,
        onEvictChunk,
        onLoadDirection = null,
        seekToViewport = null,
        visibleChunks,
        totalItems,
        getChunkEl = null,
        chunkSize = 30,
        maxChunks = 5,
        rootMargin = '1200px 0px',
        root = null,
        axis = 'auto',
    } = options;

    if (!sentinel || !topSentinel) {
        console.warn('[RAGOT] createInfiniteScroll: sentinel and topSentinel are required.');
        return _noop();
    }
    if (typeof onLoadMore !== 'function' || typeof onEvictChunk !== 'function') {
        console.warn('[RAGOT] createInfiniteScroll: onLoadMore and onEvictChunk must be functions.');
        return _noop();
    }
    if (typeof visibleChunks !== 'function' || typeof totalItems !== 'function') {
        console.warn('[RAGOT] createInfiniteScroll: visibleChunks and totalItems must be functions.');
        return _noop();
    }

    let _loadingBottom = false;
    let _loadingTop = false;
    let _destroyed = false;
    let _resetRafId = null;
    let _connectRafId = null;
    let _syncRafId = null;
    let _removeOwnerCleanup = null;
    let _topSentinelIntersecting = false;
    let _bottomDeferred = false;

    function _totalChunks() { return Math.ceil(totalItems() / chunkSize); }

    function _repositionSentinels() {
        if (!getChunkEl) return;
        const chunks = visibleChunks();
        if (chunks.size === 0) return;

        let minIdx = Infinity;
        let maxIdx = -Infinity;
        for (const c of chunks) {
            if (c < minIdx) minIdx = c;
            if (c > maxIdx) maxIdx = c;
        }

        const firstEl = getChunkEl(minIdx);
        const lastEl = getChunkEl(maxIdx);

        if (firstEl && firstEl.parentNode) {
            if (topSentinel.nextSibling !== firstEl) {
                firstEl.parentNode.insertBefore(topSentinel, firstEl);
            }
        }
        if (lastEl && lastEl.parentNode) {
            const after = lastEl.nextSibling;
            if (after !== sentinel) {
                if (after) {
                    lastEl.parentNode.insertBefore(sentinel, after);
                } else {
                    lastEl.parentNode.appendChild(sentinel);
                }
            }
        }
    }

    function _min(chunks) {
        let m = Infinity;
        for (const c of chunks) if (c < m) m = c;
        return m === Infinity ? -1 : m;
    }

    function _max(chunks) {
        let m = -Infinity;
        for (const c of chunks) if (c > m) m = c;
        return m === -Infinity ? -1 : m;
    }

    function _directionLabel(direction) {
        return direction === 'forward' ? 'bottom' : 'top';
    }

    function _oppositeDirection(direction) {
        return direction === 'forward' ? 'backward' : 'forward';
    }

    function _isDirectionLoading(direction) {
        return direction === 'forward' ? _loadingBottom : _loadingTop;
    }

    function _setDirectionLoading(direction, value) {
        if (direction === 'forward') {
            _loadingBottom = value;
            return;
        }
        _loadingTop = value;
    }

    function _estimateCatchUpBatch(gapPx, firstBounds, lastBounds, chunks) {
        const visibleCount = Math.max(1, chunks.size);
        const liveSpan = Math.max(1, lastBounds.end - firstBounds.start);
        const avgChunkSpan = Math.max(1, liveSpan / visibleCount);
        return Math.max(1, Math.min(maxChunks, Math.ceil(gapPx / avgChunkSpan)));
    }

    function _resolveScrollRoot() {
        if (root) return root;
        return window;
    }

    function _resolveAxis() {
        if (axis === 'horizontal' || axis === 'vertical') return axis;
        const scrollRoot = _resolveScrollRoot();
        if (!scrollRoot || scrollRoot === window) return 'vertical';

        const scrollableX = Math.max(0, (scrollRoot.scrollWidth || 0) - (scrollRoot.clientWidth || 0));
        const scrollableY = Math.max(0, (scrollRoot.scrollHeight || 0) - (scrollRoot.clientHeight || 0));
        return scrollableX > scrollableY ? 'horizontal' : 'vertical';
    }

    function _viewportBounds(el, resolvedAxis) {
        if (!el) return null;
        if (el === window) {
            if (resolvedAxis === 'horizontal') {
                return { start: 0, end: window.innerWidth || 0 };
            }
            return { start: 0, end: window.innerHeight || 0 };
        }
        const rect = el.getBoundingClientRect?.();
        if (!rect) return null;
        if (resolvedAxis === 'horizontal') {
            if (!Number.isFinite(rect.left) || !Number.isFinite(rect.right) || rect.right <= rect.left) {
                return null;
            }
            return { start: rect.left, end: rect.right };
        }
        if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom) || rect.bottom <= rect.top) {
            return null;
        }
        return { start: rect.top, end: rect.bottom };
    }

    function _scheduleViewportSync() {
        if (_destroyed || _syncRafId !== null || !getChunkEl) return;
        _syncRafId = requestAnimationFrame(() => {
            _syncRafId = null;
            _syncVisibleWindowToViewport();
        });
    }

    function _normalizeLoadResult(result, direction) {
        if (!result || typeof result.finally !== 'function') return null;
        result.catch(e => {
            console.warn(`[RAGOT] createInfiniteScroll: onLoadMore (${_directionLabel(direction)}) rejected:`, e);
        });
        return result;
    }

    function _invokeDirectionLoad(direction, firstTarget, step, batchCount) {
        if (typeof onLoadDirection === 'function') {
            return onLoadDirection({ direction, batchCount, firstTarget, step });
        }

        const results = [];
        const cappedBatch = Math.max(1, batchCount);
        for (let offset = 0; offset < cappedBatch; offset++) {
            const target = firstTarget + (offset * step);
            if (direction === 'forward' && target >= _totalChunks()) break;
            if (direction === 'backward' && target < 0) break;
            results.push(onLoadMore(target));
        }

        const asyncResults = results
            .map((result) => _normalizeLoadResult(result, direction))
            .filter(Boolean);
        if (asyncResults.length === 1) return asyncResults[0];
        if (asyncResults.length > 1) return Promise.allSettled(asyncResults);
        return null;
    }

    function _computeViewportSyncIntent() {
        if (_destroyed || _isDirectionLoading('forward') || _isDirectionLoading('backward') || !getChunkEl) {
            return null;
        }
        const chunks = visibleChunks();
        if (chunks.size === 0) return null;

        const minChunk = _min(chunks);
        const maxChunk = _max(chunks);
        const firstEl = getChunkEl(minChunk);
        const lastEl = getChunkEl(maxChunk);
        if (!firstEl || !lastEl) return null;

        const resolvedAxis = _resolveAxis();
        const scrollRoot = _resolveScrollRoot();
        const rootBounds = _viewportBounds(scrollRoot, resolvedAxis);
        const firstBounds = _viewportBounds(firstEl, resolvedAxis);
        const lastBounds = _viewportBounds(lastEl, resolvedAxis);
        if (!rootBounds || !firstBounds || !lastBounds) return null;

        if (lastBounds.end < rootBounds.start) {
            const gapPx = rootBounds.start - lastBounds.end;
            return {
                direction: 'forward',
                batchCount: _estimateCatchUpBatch(gapPx, firstBounds, lastBounds, chunks),
            };
        }

        if (firstBounds.start > rootBounds.end) {
            const gapPx = firstBounds.start - rootBounds.end;
            return {
                direction: 'backward',
                batchCount: _estimateCatchUpBatch(gapPx, firstBounds, lastBounds, chunks),
            };
        }

        return null;
    }

    function _syncVisibleWindowToViewport() {
        const intent = _computeViewportSyncIntent();
        if (!intent) return;
        _loadDirection({ ...intent, allowSeek: true });
    }

    function _canObserve() {
        if (!sentinel?.isConnected || !topSentinel?.isConnected) return false;
        if (root) {
            if (!root.isConnected) return false;
        }
        return true;
    }

    function _observeSentinels() {
        _observer.observe(sentinel);
        _observer.observe(topSentinel);
    }

    function _scheduleObserveWhenConnected() {
        if (_destroyed || _connectRafId !== null) return;
        _connectRafId = requestAnimationFrame(() => {
            _connectRafId = null;
            if (_destroyed) return;
            if (_canObserve()) {
                _observeSentinels();
                return;
            }
            _scheduleObserveWhenConnected();
        });
    }

    function _trimOverflow(direction) {
        const liveChunks = visibleChunks();
        while (liveChunks.size > maxChunks) {
            onEvictChunk(direction === 'forward' ? _min(liveChunks) : _max(liveChunks));
        }
    }

    function _finalizeDirectionLoad(direction, scheduleSync) {
        _setDirectionLoading(direction, false);
        _trimOverflow(direction);
        if (scheduleSync) {
            _scheduleViewportSync();
            return;
        }
        _syncVisibleWindowToViewport();
    }

    function _loadDirection({ direction, batchCount = 1, allowSeek = false }) {
        if (_destroyed || _isDirectionLoading(direction) || _isDirectionLoading(_oppositeDirection(direction))) {
            return;
        }

        const chunks = visibleChunks();
        const edge = direction === 'forward' ? _max(chunks) : _min(chunks);
        const step = direction === 'forward' ? 1 : -1;
        const firstTarget = edge + step;
        if (direction === 'forward' && firstTarget >= _totalChunks()) return;
        if (direction === 'backward' && firstTarget < 0) return;

        // Prevent load/evict oscillation: if a forward load would evict chunk 0
        // while the top sentinel is still intersecting, the evicted chunk would
        // immediately be reloaded by the backward path, creating a cycle.
        // Defer instead and retry once the top sentinel exits the root margin.
        if (direction === 'forward' && chunks.size >= maxChunks && _topSentinelIntersecting && _min(chunks) === 0) {
            _bottomDeferred = true;
            return;
        }
        if (direction === 'forward') _bottomDeferred = false;

        if (allowSeek && typeof seekToViewport === 'function' && seekToViewport(direction)) {
            _scheduleViewportSync();
            return;
        }

        _setDirectionLoading(direction, true);
        try {
            const loadResult = _invokeDirectionLoad(direction, firstTarget, step, batchCount);
            const normalizedResult = _normalizeLoadResult(loadResult, direction) || loadResult;
            if (normalizedResult && typeof normalizedResult.finally === 'function') {
                normalizedResult.finally(() => {
                    Promise.resolve().then(() => {
                        if (_destroyed) return;
                        _finalizeDirectionLoad(direction, true);
                    });
                });
            } else {
                requestAnimationFrame(() => {
                    _finalizeDirectionLoad(direction, false);
                });
            }
        } catch (e) {
            _setDirectionLoading(direction, false);
            console.warn(`[RAGOT] createInfiniteScroll: onLoadMore (${_directionLabel(direction)}) threw synchronously:`, e);
        }
    }

    const _observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.target === topSentinel) {
                const wasIntersecting = _topSentinelIntersecting;
                _topSentinelIntersecting = entry.isIntersecting;
                if (!entry.isIntersecting) {
                    // Top sentinel exited the root margin. If a bottom load was
                    // deferred by the oscillation guard, retry it now — the
                    // eviction target (chunk 0) is no longer at risk of
                    // immediate reload.
                    if (wasIntersecting && _bottomDeferred) {
                        _bottomDeferred = false;
                        _loadDirection({ direction: 'forward' });
                    }
                    continue;
                }
                _loadDirection({ direction: 'backward' });
                continue;
            }
            if (entry.target === sentinel) {
                if (!entry.isIntersecting) continue;
                _loadDirection({ direction: 'forward' });
            }
        }
    }, { root, rootMargin, threshold: 0 });

    if (_canObserve()) {
        _observeSentinels();
    } else {
        _scheduleObserveWhenConnected();
    }

    function _handleRootScroll() {
        _scheduleViewportSync();
    }

    const scrollTarget = _resolveScrollRoot();
    if (scrollTarget?.addEventListener) {
        scrollTarget.addEventListener('scroll', _handleRootScroll, { passive: true });
    }

    const controller = {
        reset() {
            if (_destroyed) return;
            if (_resetRafId !== null) return;
            _resetRafId = requestAnimationFrame(() => {
                _resetRafId = null;
                if (_destroyed) return;
                _repositionSentinels();
                _observer.unobserve(sentinel);
                _observer.unobserve(topSentinel);
                if (_canObserve()) {
                    _observeSentinels();
                } else {
                    _scheduleObserveWhenConnected();
                }
                _syncVisibleWindowToViewport();
            });
        },
        destroy() {
            if (_destroyed) return;
            _destroyed = true;
            if (typeof _removeOwnerCleanup === 'function') {
                _removeOwnerCleanup();
                _removeOwnerCleanup = null;
            }
            if (_resetRafId !== null) {
                cancelAnimationFrame(_resetRafId);
                _resetRafId = null;
            }
            if (_connectRafId !== null) {
                cancelAnimationFrame(_connectRafId);
                _connectRafId = null;
            }
            if (_syncRafId !== null) {
                cancelAnimationFrame(_syncRafId);
                _syncRafId = null;
            }
            if (scrollTarget?.removeEventListener) {
                scrollTarget.removeEventListener('scroll', _handleRootScroll);
            }
            _observer.disconnect();
        },
    };

    if (owner?._lc && typeof owner._lc.addCleanup === 'function') {
        _removeOwnerCleanup = owner._lc.addCleanup(() => controller.destroy());
    } else if (owner && typeof owner.addCleanup === 'function') {
        owner.addCleanup(() => controller.destroy());
    }

    return controller;
}

function _noop() {
    return { reset() { }, destroy() { } };
}
