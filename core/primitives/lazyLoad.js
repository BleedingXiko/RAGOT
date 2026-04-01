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
 * createLazyLoader — RAGOT Lazy Loading Engine
 *
 * High-level lifecycle-aware engine for lazy image loading. It owns:
 * - intersection observation
 * - queued loading with bounded concurrency
 * - retry/backoff policy
 * - source resets/re-observation
 *
 * @param {Component|Module} owner
 *   Any RAGOT lifecycle owner. Cleanup is registered via owner.addCleanup().
 *
 * @param {Object} options
 * @param {string}   [options.selector='[data-src]']
 *   Selector for elements to be lazy loaded.
 * @param {HTMLElement|null} [options.root=null]
 *   IntersectionObserver root. null means the browser viewport.
 * @param {string}   [options.rootMargin='1000px']
 *   IntersectionObserver rootMargin.
 * @param {number}   [options.concurrency=6]
 *   Max simultaneous item loads.
 * @param {Object|boolean} [options.retry]
 *   Retry policy. Pass true to use default retry timings or an object with:
 *   - maxAttempts
 *   - baseDelayMs
 *   - backoffFactor
 *   - shouldRetry(img, ctx)
 *   - getNextSrc(img, attempt, currentSrc, ctx)
 *   - schedule(fn, delayMs)
 *   - onRetry(img, ctx)
 * @param {Function} [options.onStateChange]
 *   (img, state, ctx) => void — app-owned visual state hook. The framework does
 *   not attach thumbnail-specific classes or placeholder behavior itself.
 * @param {Function} [options.onLoad]
 *   (img) => void — Hook called when an item finishes loading.
 * @param {Function} [options.onError]
 *   (img, ctx) => void — Hook called when an item fails after retries are exhausted.
 */

import { $$ } from '../selectors.js';
import { attr } from '../helpers.js';

const _INTERNAL_IMG_LOAD_STATE_CLASSES = {
    pending: 'ragot-lazy-loading',
    loaded: 'ragot-lazy-loaded',
    error: 'ragot-lazy-error'
};

function _setInternalImageState(img, state = null) {
    if (!img) return;
    img.classList.remove(
        _INTERNAL_IMG_LOAD_STATE_CLASSES.pending,
        _INTERNAL_IMG_LOAD_STATE_CLASSES.loaded,
        _INTERNAL_IMG_LOAD_STATE_CLASSES.error
    );
    if (!state) return;
    const nextClass = _INTERNAL_IMG_LOAD_STATE_CLASSES[state];
    if (nextClass) img.classList.add(nextClass);
}

export function createLazyLoader(owner, options = {}) {
    const {
        selector = '[data-src]',
        root = null,
        rootMargin = '1000px',
        concurrency = 6,
        retry = null,
        onStateChange = null,
        onLoad = null,
        onError = null,
    } = options;

    const _loaded = new Set();
    const _pending = [];
    const _awaitingConnection = new WeakSet();
    const _retryAttempts = new WeakMap();
    let _active = 0;
    let _observer = null;
    let _destroyed = false;

    const retryConfig = retry === true ? {} : (retry || null);
    const maxRetryAttempts = Number.isFinite(retryConfig?.maxAttempts) ? retryConfig.maxAttempts : 2;
    const retryBaseDelayMs = Number.isFinite(retryConfig?.baseDelayMs) ? retryConfig.baseDelayMs : 1000;
    const retryBackoffFactor = Number.isFinite(retryConfig?.backoffFactor) ? retryConfig.backoffFactor : 2;

    function _notifyState(img, state, extra = {}) {
        if (typeof onStateChange !== 'function') return;
        try {
            onStateChange(img, state, extra);
        } catch (_) {
            // visual state hooks are app-owned and must not break the loader
        }
    }

    function _markPending(img) {
        if (!img) return;
        _setInternalImageState(img, 'pending');
        _notifyState(img, 'pending');
    }

    function _markLoaded(img) {
        if (!img) return;
        _setInternalImageState(img, 'loaded');
        _notifyState(img, 'loaded');
    }

    function _markError(img) {
        if (!img) return;
        _setInternalImageState(img, 'error');
        _notifyState(img, 'error');
    }

    function _buildRetryContext(img) {
        const attempts = (_retryAttempts.get(img) || 0) + 1;
        return {
            attempt: attempts,
            currentSrc: img.dataset?.src || img.src || ''
        };
    }

    function _scheduleRetry(img, ctx) {
        const schedule = typeof retryConfig?.schedule === 'function'
            ? retryConfig.schedule
            : (fn, delayMs) => setTimeout(fn, delayMs);
        const delayMs = retryBaseDelayMs * Math.pow(retryBackoffFactor, ctx.attempt - 1);
        schedule(() => {
            if (_destroyed || !img || !img.isConnected) return;
            const currentSrc = img.dataset?.src || img.src || '';
            if (typeof retryConfig?.getNextSrc === 'function') {
                const nextSrc = retryConfig.getNextSrc(img, ctx.attempt, currentSrc, ctx);
                if (nextSrc) img.dataset.src = nextSrc;
            }
            _markPending(img);
            _pending.push(img);
            _drain();
        }, delayMs);
    }

    function _shouldRetry(img, ctx) {
        if (!retryConfig) return false;
        if (ctx.attempt > maxRetryAttempts) return false;
        if (typeof retryConfig.shouldRetry === 'function') {
            return retryConfig.shouldRetry(img, ctx) === true;
        }
        return true;
    }

    function _enqueue(img, { front = false } = {}) {
        if (_destroyed || !img || _loaded.has(img) || !img.dataset?.src) return false;
        _loaded.add(img);
        if (front) _pending.unshift(img);
        else _pending.push(img);
        _drain();
        return true;
    }

    function _drain() {
        if (_destroyed) return;
        while (_active < concurrency && _pending.length > 0) {
            const img = _pending.shift();
            if (!img || !img.isConnected || !img.dataset.src) continue;

            _active++;
            let handled = false;
            const finish = () => {
                if (handled) return;
                handled = true;
                _active = Math.max(0, _active - 1);
                _drain();
            };

            attr(img, {
                onLoad: () => {
                    _retryAttempts.delete(img);
                    _markLoaded(img);
                    if (onLoad) onLoad(img);
                    finish();
                },
                onError: () => {
                    _setInternalImageState(img, null);
                    const ctx = _buildRetryContext(img);
                    if (_shouldRetry(img, ctx)) {
                        _retryAttempts.set(img, ctx.attempt);
                        if (typeof retryConfig?.onRetry === 'function') {
                            retryConfig.onRetry(img, ctx);
                        }
                        _scheduleRetry(img, ctx);
                        finish();
                        return;
                    }
                    _retryAttempts.delete(img);
                    _markError(img);
                    if (onError) onError(img, ctx);
                    finish();
                }
            });

            img.decoding = 'async';
            img.src = img.dataset.src;

            // PREVENT QUEUE LOCK-UP:
            // For locally cached images and data URIs, the browser might not fire the
            // load event since it evaluates synchronously.
            if (img.complete) {
                setTimeout(() => {
                    if (!handled) {
                        if (img.naturalWidth > 0 || img.naturalHeight > 0) {
                            img.dispatchEvent(new Event('load'));
                        } else {
                            img.dispatchEvent(new Event('error'));
                        }
                    }
                }, 10);
            }

            // PREVENT ACTIVE-SLOT LEAK:
            // If the img is removed from the DOM before load/error fires (e.g. rows
            // unmounted during a filter change), the browser silently drops the request
            // and finish() is never called, permanently consuming an active slot.
            setTimeout(() => {
                if (!_destroyed && !handled && !img.isConnected) finish();
            }, 500);
        }
    }

    function _initObserver() {
        if (_observer) _observer.disconnect();
        _observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    _observer.unobserve(img);
                    _enqueue(img);
                }
            });
        }, { root, rootMargin, threshold: 0 });
    }

    function _observeWhenConnected(img, attempts = 0) {
        if (_destroyed || !img || !img.dataset?.src) {
            if (img) _awaitingConnection.delete(img);
            return;
        }

        if (img.isConnected) {
            _awaitingConnection.delete(img);
            if (_observer) _observer.observe(img);
            else _enqueue(img);
            return;
        }

        if (attempts >= 10) {
            _awaitingConnection.delete(img);
            return;
        }

        requestAnimationFrame(() => _observeWhenConnected(img, attempts + 1));
    }

    function _recovery() {
        if (_destroyed || document.visibilityState !== 'visible') return;

        // Purge stale entries — disconnected imgs that finished loading (or were
        // removed mid-load) stay in _loaded forever otherwise, bloating the Set
        // and keeping dead nodes registered with the IO.
        for (const img of _loaded) {
            if (!img.isConnected) {
                _loaded.delete(img);
                _observer.unobserve(img);
            }
        }

        const container = root || document;
        const imgs = $$(selector, container).filter(img => !_loaded.has(img));

        imgs.forEach(img => {
            _observer.observe(img);
        });
    }

    _initObserver();

    // Attach visibility recovery using owner lifecycle
    if (owner && typeof owner.on === 'function') {
        owner.on(document, 'visibilitychange', _recovery);
        owner.on(window, 'focus', _recovery);
        owner.on(window, 'pageshow', _recovery);
    }

    const controller = {
        /**
         * Register an element for lazy loading.
         * Usually called by renderers after creating a new element.
         */
        observe(img) {
            if (_destroyed || !img || !img.dataset?.src) return;
            // If morphDOM reused this node and updated data-src to a different URL,
            // evict it from _loaded so it gets re-queued for the new src.
            if (_loaded.has(img)) {
                const loadedSrc = (img.src || '').split('?')[0];
                const pendingSrc = img.dataset.src.split('?')[0];
                const srcChanged = !!(loadedSrc && pendingSrc && loadedSrc !== pendingSrc);
                // A node may be marked in _loaded because it was enqueued earlier,
                // then detached before load completed. If it gets reused across
                // row/grid remounts, treat it as not loaded and re-queue it.
                const notActuallyLoaded = !img.classList.contains('loaded') && !(img.complete && img.naturalWidth > 0);
                if (srcChanged || notActuallyLoaded) {
                    _loaded.delete(img);
                } else {
                    return;
                }
            }
            _markPending(img);
            if (!img.isConnected) {
                if (_awaitingConnection.has(img)) return;
                _awaitingConnection.add(img);
                _observeWhenConnected(img);
                return;
            }
            if (_observer) _observer.observe(img);
            else {
                _enqueue(img);
            }
        },

        /**
         * Reset loader bookkeeping for an element whose lazy source changed.
         * Callers can then observe()/prime() it again without mutating loader classes.
         */
        reset(img) {
            if (_destroyed || !img) return;
            _loaded.delete(img);
            _retryAttempts.delete(img);
            if (_observer) _observer.unobserve(img);
            _markPending(img);
        },

        /**
         * Promote an item into the queue immediately.
         * Useful for cards that are just outside the viewport and should feel instant.
         */
        prime(img, options = {}) {
            if (_destroyed || !img || _loaded.has(img) || !img.dataset?.src) return;
            if (options.fetchPriority) img.fetchPriority = options.fetchPriority;
            _markPending(img);
            if (!img.isConnected) {
                if (_awaitingConnection.has(img)) return;
                _awaitingConnection.add(img);
                _observeWhenConnected(img);
                return;
            }
            if (_observer) _observer.unobserve(img);
            _enqueue(img, { front: true });
        },

        /**
         * Scan the container for any matching selector that isn't observed yet.
         */
        refresh() {
            _recovery();
        },

        destroy() {
            if (_destroyed) return;
            _destroyed = true;
            if (_observer) _observer.disconnect();
            _pending.length = 0;
            _loaded.clear();
        }
    };

    if (owner && typeof owner.addCleanup === 'function') {
        owner.addCleanup(() => controller.destroy());
    }

    return controller;
}
