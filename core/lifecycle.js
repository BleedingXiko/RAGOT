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
 * Module and Component Lifecycle
 *
 * LifecycleMixin is an internal composition helper — not exported.
 * It owns the shared lifecycle state and methods used by both Module and Component:
 * listeners, bus subscriptions, timers, cleanup callbacks, and child adoption.
 *
 * Module owns: socket handlers, module state subscribers, adoptComponent, start/stop.
 * Component owns: DOM rendering, rAF state batching, mount/unmount.
 * Neither class bleeds into the other's domain.
 */

import { bus, shouldWarnMissingTarget } from './bus.js';
import { createSelector } from './stateStore.js';
import { morphDOM } from './dom.js';
import { delegateEvent } from './helpers.js';

// ==========================================
// JSDoc Type Definitions
// ==========================================

/**
 * @typedef {Object} AdoptOptions
 * Options for adopting a child Module or Component.
 * @property {string} [startMethod='start'] - Method name to call on the child to start it
 * @property {string} [stopMethod='stop'] - Method name to call on the child when the owner tears down
 * @property {Array<*>} [startArgs=[]] - Arguments forwarded to the child's start method
 */

/**
 * @typedef {Object} AdoptComponentOptions
 * Options for adopting a Component from a Module with optional state sync.
 * @property {string} [startMethod='mount'] - Method to call to start the component
 * @property {string} [stopMethod='unmount'] - Method to call to stop the component
 * @property {Array<*>} [startArgs=[]] - Arguments forwarded to the start method (e.g. [containerEl])
 * @property {AdoptComponentSyncFn|null} [sync=null]
 *   Called after every Module `setState`. Use to push state slices down to the component.
 *   Guard with identity checks to avoid unnecessary re-renders.
 */

/**
 * Sync callback invoked after every Module state change when using `adoptComponent`.
 * @callback AdoptComponentSyncFn
 * @param {Component} component - The adopted component instance
 * @param {Object} state - Current module state
 * @param {Module} module - The owning module instance
 * @returns {void}
 */

/**
 * @typedef {Object} SubscribeOptions
 * Options for subscribing to a Module's state.
 * @property {SelectorFn} [selector]
 *   Optional selector — subscriber only fires when the selected slice changes by `Object.is`.
 * @property {boolean} [immediate=false]
 *   If true, fires the subscriber immediately with the current state.
 * @property {Module|Component} [owner]
 *   If provided, the subscription is automatically removed when the owner stops or unmounts.
 */

/**
 * @typedef {Object} WatchStateOptions
 * Options for `Module.watchState()`. Same as SubscribeOptions minus `owner` (always `this`).
 * @property {SelectorFn} [selector] - Optional selector function
 * @property {boolean} [immediate=true] - Fire immediately with current state (default true)
 */

/**
 * A selector function that extracts a slice from a state object.
 * @template S, R
 * @callback SelectorFn
 * @param {S} state - Full state object
 * @returns {R} Selected slice
 */

/**
 * Callback for full-state subscriptions (no selector).
 * @callback StateSubscriberFn
 * @param {Object} state - Current module state
 * @param {Module} module - The owning module
 * @returns {void}
 */

/**
 * Callback for sliced subscriptions (with selector).
 * @callback SliceSubscriberFn
 * @param {*} slice - The selected value
 * @param {Object} state - Full current state
 * @param {Module} module - The owning module
 * @returns {void}
 */

/**
 * @typedef {Object} CreateElementOptions
 * Options accepted by `createElement()`.
 * @property {string|string[]} [className] - CSS class string or array of class strings (alias: `class`)
 * @property {Object.<string, string>} [style] - Inline styles as a camelCase object
 * @property {Object.<string, string>} [dataset] - `data-*` attributes as camelCase keys
 * @property {string} [id] - Element ID
 * @property {RefCallback} [ref] - Called synchronously with the created element; stores to `this.refs`
 * @property {Object.<string, EventListener>} [events] - `{ click: handler, ... }` — addEventListener for each
 * @property {string} [textContent] - Sets `el.textContent`
 * @property {string} [innerHTML] - Sets `el.innerHTML` — **XSS risk: only pass trusted markup**
 * @property {Array<Node|string>} [children] - Child nodes or strings (merged with rest arguments)
 * @property {boolean} [disabled] - Maps to the DOM `disabled` property
 */

/**
 * Ref callback used with `createElement({ ref })` or `Component.ref(name)`.
 * @callback RefCallback
 * @param {Element} el - The created element
 * @returns {void}
 */

// ==========================================
// Internal: LifecycleMixin
// ==========================================

class LifecycleMixin {
    constructor() {
        this._listeners = []; // [{ target, type, handler, options } | { _busUnsub }]
        this._timers = new Set();
        this._intervals = new Set();
        this._cleanups = []; // [() => void]
    }

    on(target, type, handler, options) {
        if (!target) {
            if (shouldWarnMissingTarget()) {
                console.warn(`[RAGOT] Skipped listener for "${type}": target is null or undefined.`);
            }
            return this;
        }

        const isDuplicate = this._listeners.some(l =>
            l.target === target && l.type === type && l.handler === handler
        );
        if (isDuplicate) return this;

        // When { once: true } is passed, wrap the handler so the _listeners entry is pruned
        // immediately after the listener fires. Without this, the stale entry would block
        // re-registration of the same handler (isDuplicate check) and clutter teardown.
        let registeredHandler = handler;
        if (options && options.once) {
            registeredHandler = (...args) => {
                this._listeners = this._listeners.filter(
                    l => !(l.target === target && l.type === type && l.handler === handler)
                );
                handler(...args);
            };
        }

        target.addEventListener(type, registeredHandler, options);
        this._listeners.push({ target, type, handler, _registeredHandler: registeredHandler, options });
        return this;
    }

    off(target, type, handler) {
        if (!target) return this;
        const entry = this._listeners.find(
            l => l.target === target && l.type === type && l.handler === handler
        );
        try {
            // Use the registered wrapper if found. If the entry is gone (e.g. a { once }
            // listener already fired and pruned itself), _registeredHandler is the only
            // thing the browser knows about — but we no longer have it. In that case the
            // listener has already been auto-removed by the browser (once semantics), so
            // there is nothing to remove. Falling back to `handler` would be a silent
            // no-op since it was never passed to addEventListener directly.
            if (entry) {
                target.removeEventListener(type, entry._registeredHandler, entry.options);
            }
            // If no entry: the once-wrapper already fired and cleaned up — nothing to do.
        } catch (e) {
            console.warn(`[RAGOT] Failed to remove listener for "${type}":`, e);
        }
        this._listeners = this._listeners.filter(
            l => !(l.target === target && l.type === type && l.handler === handler)
        );
        return this;
    }

    listen(event, handler) {
        const unsub = bus.on(event, handler);
        this._listeners.push({ _busUnsub: unsub });
        return this;
    }

    emit(event, data) {
        bus.emit(event, data);
        return this;
    }

    timeout(callback, delayMs) {
        const timeoutId = setTimeout(() => {
            this._timers.delete(timeoutId);
            callback();
        }, delayMs);
        this._timers.add(timeoutId);
        return timeoutId;
    }

    interval(callback, delayMs) {
        const intervalId = setInterval(callback, delayMs);
        this._intervals.add(intervalId);
        return intervalId;
    }

    clearTimeout(timeoutId) {
        clearTimeout(timeoutId);
        this._timers.delete(timeoutId);
        return this;
    }

    clearInterval(intervalId) {
        clearInterval(intervalId);
        this._intervals.delete(intervalId);
        return this;
    }

    clearTimers() {
        for (const id of this._timers) clearTimeout(id);
        for (const id of this._intervals) clearInterval(id);
        this._timers.clear();
        this._intervals.clear();
        return this;
    }

    addCleanup(cleanup) {
        if (typeof cleanup !== 'function') {
            return () => false;
        }

        let active = true;
        const wrapped = () => {
            if (!active) return;
            active = false;
            cleanup();
        };

        this._cleanups.push(wrapped);

        return () => {
            if (!active) return false;
            active = false;
            const index = this._cleanups.indexOf(wrapped);
            if (index === -1) return false;
            this._cleanups.splice(index, 1);
            return true;
        };
    }

    /**
     * Lifecycle-managed event delegation. Auto-cleaned on teardown.
     * Equivalent to: this.addCleanup(delegateEvent(parent, event, selector, handler))
     * @param {Element|string} parent - Parent element or selector
     * @param {string} event - Event name
     * @param {string} selector - Child selector
     * @param {Function} handler
     * @returns {this}
     */
    delegate(parent, event, selector, handler) {
        const unsub = delegateEvent(parent, event, selector, handler);
        this._cleanups.push(unsub);
        return this;
    }

    adopt(child, options = {}) {
        if (!child) return this;
        const {
            startMethod = 'start',
            stopMethod = 'stop',
            startArgs = []
        } = options;

        // Guard: detect Component instances adopted via the base adopt() without
        // specifying stopMethod: 'unmount'. adopt() defaults to 'stop' which doesn't
        // exist on Component — use adoptComponent() or pass { stopMethod: 'unmount' }.
        if (
            stopMethod === 'stop' &&
            typeof child.unmount === 'function' &&
            typeof child.mount === 'function' &&
            typeof child.stop !== 'function'
        ) {
            console.warn(
                `[RAGOT] adopt() called on a Component-like object without { stopMethod: 'unmount' }.\n` +
                `Components use unmount(), not stop(). Use adoptComponent() or pass { startMethod: 'mount', stopMethod: 'unmount' }.`
            );
        }

        if (typeof child[startMethod] === 'function') {
            child[startMethod](...startArgs);
        }

        this.addCleanup(() => {
            if (typeof child[stopMethod] === 'function') {
                child[stopMethod]();
            }
        });
        return this;
    }

    createSelector(inputSelectors, resultFunc) {
        return createSelector(inputSelectors, resultFunc);
    }

    /**
     * Flush all managed resources: listeners, bus subscriptions, timers, cleanup callbacks.
     * Called by Module.stop() and Component.unmount().
     * @param {string} [label=''] - Used in warning messages for context
     */
    teardown(label = '') {
        for (const l of this._listeners) {
            try {
                if (l._busUnsub) {
                    l._busUnsub();
                } else if (l.target) {
                    l.target.removeEventListener(l.type, l._registeredHandler ?? l.handler, l.options);
                }
            } catch (e) {
                console.warn(`[RAGOT${label}] Failed to cleanup listener for "${l.type}":`, e);
            }
        }
        this._listeners = [];

        for (const id of this._timers) clearTimeout(id);
        for (const id of this._intervals) clearInterval(id);
        this._timers.clear();
        this._intervals.clear();

        // Use while loop to ensure cleanups added during cleanup are processed
        while (this._cleanups.length > 0) {
            const fn = this._cleanups.shift();
            try {
                if (typeof fn === 'function') fn();
            } catch (e) {
                console.warn(`[RAGOT${label}] Failed to run cleanup callback:`, e);
            }
        }
    }
}

// ==========================================
// Module Lifecycle (Non-DOM)
// ==========================================

/**
 * Base class for stateful orchestration that does not own DOM rendering.
 *
 * Modules manage event listeners, bus subscriptions, socket handlers, timers,
 * and cross-module state subscriptions. They do not mount or render DOM — that
 * is the responsibility of {@link Component}.
 *
 * **Lifecycle:**
 * ```
 * new Module(initialState)
 *   └─ start()  →  onStart()   ← register sockets, timers, subscriptions
 *   └─ setState / batchState
 *   └─ stop()   →  onStop()    ← pre-cleanup hook
 *                → teardown: listeners, sockets, timers, subscribers
 * ```
 *
 * **Module-only APIs** (not available on Component):
 * - `onSocket` / `offSocket` — lifecycle-owned socket.io handlers
 * - `adoptComponent` — start a Component and wire state sync to it
 * - `watchState` — self-subscription with auto-cleanup
 * - `batchState` — synchronous atomic multi-field update
 *
 * @example
 * class ChatModule extends Module {
 *   onStart() {
 *     const socket = window.ragotModules.socket;
 *     this.onSocket(socket, 'chat:message', (msg) => {
 *       this.setState({ messages: [...this.state.messages, msg] });
 *     });
 *   }
 * }
 * const chat = new ChatModule({ messages: [] }).start();
 */
export class Module {
    /**
     * @param {Object} [initialState={}] - Initial state object
     */
    constructor(initialState = {}) {
        this.state = initialState;
        this._isMounted = false;
        this._lc = new LifecycleMixin();
        this._socketHandlers = []; // [{ socket, event, handler }]
        this._subscribers = new Set(); // unified: both watchState and subscribe use this
        this._batchDepth = 0;
        this._notifyQueued = false;
    }

    /**
     * Lifecycle hook — called once when `start()` transitions to mounted state.
     * Override to register socket handlers, timers, and subscriptions.
     * @returns {void}
     */
    onStart() { }

    /**
     * Lifecycle hook — called during `stop()` before automatic cleanup.
     * Override to perform pre-teardown work (e.g. flushing state to storage).
     * @returns {void}
     */
    onStop() { }

    /**
     * Update module state and schedule microtask notification to all subscribers.
     * Multiple synchronous setState calls within the same microtask are batched
     * into a single notification round.
     *
     * IMMUTABLE PATH: produces a new state object via spread, so `Object.is(prev, next)`
     * is always false after any call — all subscribers and selectors are re-evaluated.
     * Use this for normal field updates.
     *
     * @param {Object} newState
     */
    setState(newState) {
        this.state = { ...this.state, ...newState };
        this._scheduleNotify();
    }

    /**
     * Synchronously apply multiple state mutations and flush exactly one
     * notification round when the mutator returns. Useful when multiple
     * setState-equivalent operations must happen atomically.
     *
     * MUTABLE PATH: the mutatorFn receives and mutates `this.state` directly —
     * no new object is created. This means selectors that test `Object.is(prev, next)`
     * on a top-level field will still detect changes correctly (they compare field
     * values, not the state object reference). However, selectors that return the
     * state object itself will see the same reference before and after and will NOT
     * fire. Keep mutatorFns to primitive/field mutations only; never return the
     * whole state object from a selector used with batchState.
     *
     * @param {Function} mutatorFn - (state) => void  — mutate state fields in place
     */
    batchState(mutatorFn) {
        this._batchDepth++;
        try {
            mutatorFn(this.state);
        } finally {
            this._batchDepth--;
            if (this._batchDepth === 0) {
                this._notifyAll();
            }
        }
        return this;
    }

    _scheduleNotify() {
        if (this._batchDepth > 0 || this._notifyQueued) return;
        this._notifyQueued = true;
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(() => this._notifyAll());
        } else {
            Promise.resolve().then(() => this._notifyAll());
        }
    }

    _notifyAll() {
        this._notifyQueued = false;
        const state = this.state;
        for (const record of this._subscribers) {
            try {
                if (record.selector) {
                    const next = record.selector(state);
                    if (Object.is(next, record._lastSelected)) continue;
                    record._lastSelected = next;
                    record.fn(next, state, this);
                } else {
                    record.fn(state, this);
                }
            } catch (e) {
                console.warn('[RAGOT] Error in Module state subscriber:', e);
            }
        }
    }

    /**
     * Subscribe to this module's state changes.
     * Works for both internal self-subscriptions (watchState) and external cross-module use.
     *
     * ⚠️  SELECTOR SIGNATURE FOOTGUN ⚠️
     * Adding a selector CHANGES the callback signature. This is the #1 mistake when
     * adding a selector to an existing subscriber:
     *
     *   // Without selector — fn receives (fullState, module):
     *   mod.subscribe((s) => { console.log(s.count); });
     *
     *   // With selector — fn receives (slice, fullState, module):
     *   //   `slice` = whatever the selector returned (a string, number, object, …)
     *   //   `s`     = the full state object (same as without selector)
     *   mod.subscribe((_slice, s) => { console.log(s.count); }, {
     *       selector: (s) => s.count,
     *   });
     *
     *   // ✗ WRONG — `s` is the slice (e.g. a number), NOT the full state:
     *   mod.subscribe((s) => { console.log(s.count); }, {
     *       selector: (s) => s.count,
     *   });
     *
     * When you only need the slice itself (e.g. a primitive or derived value):
     *   mod.subscribe((count) => { console.log(count); }, {
     *       selector: (s) => s.count,
     *   });
     *
     * @param {Function} fn
     *   Without selector: fn(fullState, module)
     *   With selector:    fn(slice, fullState, module) — slice is the selector's return value;
     *                     subscriber only fires when the slice value changes (by reference/===).
     * @param {Object} [options={}]
     * @param {Function} [options.selector]  - (state) => slice — derive a value to diff against
     * @param {boolean}  [options.immediate] - call fn immediately with current state (default false)
     * @param {Object}   [options.owner]     - Module/Component that auto-unsubscribes on stop/unmount
     * @returns {Function} unsubscribe
     */
    subscribe(fn, options = {}) {
        if (typeof fn === 'string') {
            throw new TypeError(
                `[RAGOT] subscribe() received a string as its first argument.\n` +
                `To filter by field, use the selector option:\n` +
                `  module.subscribe((value) => { ... }, { selector: (s) => s.${fn} })`
            );
        }
        if (typeof fn !== 'function') return () => { };
        const { selector = null, immediate = false, owner = null } = options;

        const record = {
            fn,
            selector,
            _lastSelected: selector ? selector(this.state) : undefined
        };

        this._subscribers.add(record);
        const unsub = () => this._subscribers.delete(record);

        if (owner && typeof owner.addCleanup === 'function') {
            owner.addCleanup(unsub);
        }

        if (immediate) {
            try {
                if (selector) {
                    fn(record._lastSelected, this.state, this);
                } else {
                    fn(this.state, this);
                }
            } catch (e) {
                console.warn('[RAGOT] Error in Module subscriber (immediate):', e);
            }
        }

        return unsub;
    }

    /**
     * Self-subscribe: wires cleanup to this module's own lifecycle.
     * Shorthand for subscribe(fn, { owner: this, immediate }).
     * Used internally by adoptComponent for state→UI sync.
     *
     * @param {Function} fn - fn(state, module)
     * @param {Object} [options={}]
     * @param {boolean} [options.immediate=true]
     * @returns {Function} unsubscribe
     */
    watchState(fn, options = {}) {
        if (typeof fn !== 'function') {
            throw new TypeError(
                `[RAGOT] watchState() requires a function as its first argument — received ${typeof fn}.\n` +
                `To watch a specific field, use the selector option:\n` +
                `  this.watchState((value) => { ... }, { selector: (s) => s.fieldName })`
            );
        }
        const { immediate = true } = options;
        return this.subscribe(fn, { owner: this, immediate });
    }

    /**
     * Start the module. Calls `onStart()` once; idempotent if already started.
     * @returns {this}
     */
    start() {
        if (this._isMounted) return this;
        this._isMounted = true;
        this.onStart();
        return this;
    }

    /**
     * Stop the module. Calls `onStop()`, then tears down all managed resources
     * (listeners, socket handlers, timers, bus subscriptions, cleanup callbacks).
     * Idempotent — safe to call multiple times.
     * @returns {this}
     */
    stop() {
        if (!this._isMounted) return this;
        try {
            this.onStop();
        } catch (e) {
            console.error('[RAGOT] Error in Module.onStop:', e);
        }

        this._lc.teardown(' Module');

        for (const s of this._socketHandlers) {
            try {
                s.socket?.off?.(s.event, s.handler);
            } catch (e) {
                console.warn(`[RAGOT] Failed to cleanup socket listener for "${s.event}":`, e);
            }
        }
        this._socketHandlers = [];

        this._subscribers.clear();
        this._notifyQueued = false;
        this._batchDepth = 0;
        this._isMounted = false;
        return this;
    }

    // -- Delegated to LifecycleMixin --

    /**
     * Register a DOM event listener, auto-removed on `stop()`.
     * Duplicate registrations (same target + type + handler) are silently ignored.
     * @param {EventTarget} target
     * @param {string} type - Event name (e.g. `'click'`)
     * @param {EventListener} handler
     * @param {AddEventListenerOptions} [options]
     * @returns {this}
     */
    on(target, type, handler, options) {
        this._lc.on(target, type, handler, options);
        return this;
    }

    /**
     * Remove a previously registered DOM event listener.
     * @param {EventTarget} target
     * @param {string} type
     * @param {EventListener} handler
     * @returns {this}
     */
    off(target, type, handler) {
        this._lc.off(target, type, handler);
        return this;
    }

    /**
     * Subscribe to a global bus event, auto-unsubscribed on `stop()`.
     * @param {string} event - Bus event name
     * @param {Function} handler
     * @returns {this}
     */
    listen(event, handler) {
        this._lc.listen(event, handler);
        return this;
    }

    /**
     * Broadcast a global bus event.
     * @param {string} event - Bus event name
     * @param {*} [data] - Payload passed to all listeners
     * @returns {this}
     */
    emit(event, data) {
        this._lc.emit(event, data);
        return this;
    }

    /**
     * Schedule a `setTimeout`, auto-cleared on `stop()`.
     * @param {Function} callback
     * @param {number} delayMs
     * @returns {ReturnType<typeof setTimeout>} Timer ID (pass to `clearTimeout` for early cancellation)
     */
    timeout(callback, delayMs) {
        return this._lc.timeout(callback, delayMs);
    }

    /**
     * Schedule a `setInterval`, auto-cleared on `stop()`.
     * @param {Function} callback
     * @param {number} delayMs
     * @returns {ReturnType<typeof setInterval>} Interval ID (pass to `clearInterval` for early cancellation)
     */
    interval(callback, delayMs) {
        return this._lc.interval(callback, delayMs);
    }

    /**
     * Cancel a specific timeout registered via `this.timeout()`.
     * @param {ReturnType<typeof setTimeout>} timeoutId
     * @returns {this}
     */
    clearTimeout(timeoutId) {
        this._lc.clearTimeout(timeoutId);
        return this;
    }

    /**
     * Cancel a specific interval registered via `this.interval()`.
     * @param {ReturnType<typeof setInterval>} intervalId
     * @returns {this}
     */
    clearInterval(intervalId) {
        this._lc.clearInterval(intervalId);
        return this;
    }

    /**
     * Cancel all pending timeouts and intervals registered on this module.
     * @returns {this}
     */
    clearTimers() {
        this._lc.clearTimers();
        return this;
    }

    /**
     * Register an arbitrary cleanup callback, called during `stop()`.
     * @param {Function} cleanup
     * @returns {this}
     */
    addCleanup(cleanup) {
        this._lc.addCleanup(cleanup);
        return this;
    }

    /**
     * Lifecycle-managed event delegation. Equivalent to
     * `this.addCleanup(delegateEvent(parent, event, selector, handler))`.
     * @param {Element|string} parent - Parent element or CSS selector string
     * @param {string} event - Event name
     * @param {string} selector - Child CSS selector to match
     * @param {function(Event, Element): void} handler
     * @returns {this}
     */
    delegate(parent, event, selector, handler) {
        this._lc.delegate(parent, event, selector, handler);
        return this;
    }

    /**
     * Adopt a child Module or Component: start it immediately and stop it when this module stops.
     * @param {Module|Component|Object} child - Any object with `start`/`stop` (or custom) methods
     * @param {AdoptOptions} [options={}]
     * @returns {this}
     */
    adopt(child, options = {}) {
        this._lc.adopt(child, options);
        return this;
    }

    /**
     * Create a memoized selector (convenience wrapper around the standalone `createSelector`).
     * Recomputes only when one of the input selector outputs changes by `Object.is`.
     * @template R
     * @param {SelectorFn[]} inputSelectors
     * @param {function(...*): R} resultFunc
     * @returns {function(*): R}
     */
    createSelector(inputSelectors, resultFunc) {
        return this._lc.createSelector(inputSelectors, resultFunc);
    }

    // -- Module-only methods --

    /**
     * Register a socket.io event handler, auto-removed via `socket.off()` on `stop()`.
     * Duplicate registrations (same socket + event + handler) are silently ignored.
     * @param {import('socket.io-client').Socket} socket
     * @param {string} event - Socket event name (use constants from `app/constants.py`)
     * @param {Function} handler
     * @returns {this}
     */
    onSocket(socket, event, handler) {
        if (!socket) {
            console.warn(`[RAGOT] onSocket("${event}"): socket is null or undefined — handler not registered.`);
            return this;
        }
        if (typeof socket.on !== 'function' || typeof socket.off !== 'function') {
            console.warn(
                `[RAGOT] onSocket("${event}"): first argument does not look like a socket.io socket (missing .on/.off).\n` +
                `Did you accidentally pass an event name or a non-socket object?`
            );
            return this;
        }
        const isDuplicate = this._socketHandlers.some(s =>
            s.socket === socket && s.event === event && s.handler === handler
        );
        if (isDuplicate) return this;

        socket.on(event, handler);
        this._socketHandlers.push({ socket, event, handler });
        return this;
    }

    /**
     * Remove a specific socket.io handler registered via `onSocket()`.
     * @param {import('socket.io-client').Socket} socket
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    offSocket(socket, event, handler) {
        if (!socket || typeof socket.off !== 'function') return this;
        socket.off(event, handler);
        this._socketHandlers = this._socketHandlers.filter(
            s => !(s.socket === socket && s.event === event && s.handler === handler)
        );
        return this;
    }

    /**
     * Adopt a Component: mount it immediately and wire optional state sync so that every time
     * this module's state changes, `sync(component, state, module)` is called.
     * Unmounts the component automatically when this module stops.
     *
     * Defaults: `startMethod: 'mount'`, `stopMethod: 'unmount'`.
     * Pass `startArgs: [containerEl]` to provide the mount target.
     *
     * @param {Component} component
     * @param {AdoptComponentOptions} [options={}]
     * @returns {this}
     *
     * @example
     * this.adoptComponent(this._filterBar, {
     *   startArgs: [containerEl],
     *   sync: (comp, state) => {
     *     if (comp.state.filter !== state.filter) comp.setState({ filter: state.filter });
     *   }
     * });
     */
    adoptComponent(component, options = {}) {
        const {
            sync = null,
            startMethod = 'mount',
            stopMethod = 'unmount',
            startArgs = []
        } = options;

        this.adopt(component, { startMethod, stopMethod, startArgs });
        if (typeof sync === 'function') {
            this.watchState((state, module) => sync(component, state, module));
        }
        return this;
    }
}

// ==========================================
// Component Lifecycle & State
// ==========================================

/**
 * Base class for UI owners that render and manage a DOM subtree.
 *
 * Components own their element, refs, UI-local state, and element-level event listeners.
 * State changes are batched into a single `requestAnimationFrame` re-render via `morphDOM`.
 *
 * **Lifecycle:**
 * ```
 * new Component(initialState)
 *   └─ mount(parentEl)     → render() → element appended → onStart()
 *   └─ setState(partial)   → rAF-batched morphDOM re-render
 *   └─ setStateSync(partial) → immediate morphDOM re-render (use sparingly)
 *   └─ unmount()           → onStop() → teardown → element removed
 * ```
 *
 * **Deliberate omissions** (belong on Module, not Component):
 * - `onSocket` / `offSocket` — socket ownership is Module's domain
 * - `watchState` / `adoptComponent` — module state drives Component, not vice-versa
 *
 * @example
 * class CounterView extends Component {
 *   render() {
 *     return createElement('button', {
 *       textContent: `Count: ${this.state.count}`,
 *       onClick: () => this.setState({ count: this.state.count + 1 })
 *     });
 *   }
 * }
 * const counter = new CounterView({ count: 0 });
 * counter.mount(document.getElementById('app'));
 */
export class Component {
    /**
     * @param {Object} [initialState={}] - Initial state object for this component
     */
    constructor(initialState = {}) {
        this.state = initialState;
        this.element = null;
        this._isMounted = false;
        this._pendingState = null;
        this._renderQueued = false;
        this._renderRafId = null;
        this._lc = new LifecycleMixin();
        this.refs = {};
    }

    /**
     * Lifecycle hook — called once after `render()` appends the element to the DOM.
     * Override to attach event listeners, set up refs, or start subscriptions.
     * @returns {void}
     */
    onStart() { }

    /**
     * Lifecycle hook — called during `unmount()` before automatic cleanup begins.
     * Override to perform pre-teardown work (e.g. imperative animations).
     * @returns {void}
     */
    onStop() { }

    /**
     * Required: Must return an HTMLElement. Use `createElement()` here.
     * Can be overridden by the RAGOT Override Manager for visual skinning.
     * @returns {HTMLElement}
     */
    render() {
        return document.createElement('div');
    }


    /**
     * Batches state updates and schedules a single rAF re-render.
     * @param {Object} newState
     */
    setState(newState) {
        this._pendingState = { ...this.state, ...this._pendingState, ...newState };
        if (!this._renderQueued) {
            this._renderQueued = true;
            this._renderRafId = requestAnimationFrame(() => this._performUpdate());
        }
    }

    /**
     * Synchronous setState — triggers render immediately (use sparingly).
     * @param {Object} newState
     */
    setStateSync(newState) {
        if (this._renderRafId !== null) {
            cancelAnimationFrame(this._renderRafId);
            this._renderRafId = null;
        }
        this._renderQueued = false;
        this._pendingState = null;
        this.state = { ...this.state, ...newState };
        if (this.element && this._isMounted) {
            const newElement = this.render();
            if (newElement instanceof Node) {
                this.element = morphDOM(this.element, newElement);
            }
        }
    }

    _performUpdate() {
        this._renderRafId = null;
        this._renderQueued = false;
        if (this._pendingState) {
            this.state = { ...this.state, ...this._pendingState };
            this._pendingState = null;

            if (this.element && this._isMounted) {
                const newElement = this.render();
                if (newElement instanceof Node) {
                    this.element = morphDOM(this.element, newElement);
                }
            }
        }
    }

    /**
     * Create a ref callback to capture a DOM node into this.refs.
     * Usage in render(): createElement('input', { ref: this.ref('myInput') })
     * Access after mount: this.refs.myInput
     * @param {string} name
     * @returns {Function}
     */
    ref(name) {
        return (el) => {
            this.refs[name] = el;
            if (el && el.setAttribute) el.setAttribute('data-ragot-ref', name);
        };
    }

    /**
     * Mount the component into a parent container.
     * @param {HTMLElement} parentDiv
     * @returns {HTMLElement}
     */
    mount(parentDiv) {
        if (this._isMounted || !parentDiv) return this.element;

        // Guard: warn if the container is not yet attached to the live document.
        // onStart() observes the live DOM (e.g. offsetHeight, IntersectionObserver);
        // mounting into a detached tree silently breaks those operations.
        if (typeof document !== 'undefined' && !document.contains(parentDiv)) {
            console.warn(
                `[RAGOT] Component.mount() called with a container that is not yet in the document.\n` +
                `onStart() runs after mount — any DOM measurements or observers will fail silently.\n` +
                `Ensure the container is attached before calling mount().`
            );
        }

        this.element = this.render();
        if (this.element) {
            this.element.__ragotComponent = this; // Tag for design mode/bridge
            parentDiv.appendChild(this.element);
            this._isMounted = true;
            this.onStart();
        }
        return this.element;
    }

    /**
     * Mount this component before an existing sibling node.
     * Idempotent — safe to call multiple times (only mounts once).
     * @param {Node} sibling
     * @returns {HTMLElement}
     */
    mountBefore(sibling) {
        if (this._isMounted || !sibling) return this.element;
        this.element = this.render();
        if (this.element && sibling.parentNode) {
            this.element.__ragotComponent = this; // Tag for design mode/bridge
            sibling.parentNode.insertBefore(this.element, sibling);
            this._isMounted = true;
            this.onStart();
        }
        return this.element;
    }

    /**
     * Unmount the component, cleaning up listeners and removing element from DOM.
     */
    unmount() {
        if (!this._isMounted) return;
        try {
            this.onStop();
        } catch (e) {
            console.error('[RAGOT] Error in onStop:', e);
        }

        if (this._renderRafId !== null) {
            cancelAnimationFrame(this._renderRafId);
            this._renderRafId = null;
        }
        this._renderQueued = false;
        this._pendingState = null;

        this._lc.teardown(' Component');

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        this._isMounted = false;
        this.refs = {};
        this.element = null;
    }

    // -- Delegated to LifecycleMixin --

    /**
     * Register a DOM event listener, auto-removed on `unmount()`.
     * @param {EventTarget} target
     * @param {string} type - Event name
     * @param {EventListener} handler
     * @param {AddEventListenerOptions} [options]
     * @returns {this}
     */
    on(target, type, handler, options) {
        this._lc.on(target, type, handler, options);
        return this;
    }

    /**
     * Remove a previously registered DOM event listener.
     * @param {EventTarget} target
     * @param {string} type
     * @param {EventListener} handler
     * @returns {this}
     */
    off(target, type, handler) {
        this._lc.off(target, type, handler);
        return this;
    }

    /**
     * Subscribe to a global bus event, auto-unsubscribed on `unmount()`.
     * @param {string} event - Bus event name
     * @param {Function} handler
     * @returns {this}
     */
    listen(event, handler) {
        this._lc.listen(event, handler);
        return this;
    }

    /**
     * Broadcast a global bus event.
     * @param {string} event - Bus event name
     * @param {*} [data]
     * @returns {this}
     */
    emit(event, data) {
        this._lc.emit(event, data);
        return this;
    }

    /**
     * Schedule a `setTimeout`, auto-cleared on `unmount()`.
     * @param {Function} callback
     * @param {number} delayMs
     * @returns {ReturnType<typeof setTimeout>}
     */
    timeout(callback, delayMs) {
        return this._lc.timeout(callback, delayMs);
    }

    /**
     * Schedule a `setInterval`, auto-cleared on `unmount()`.
     * @param {Function} callback
     * @param {number} delayMs
     * @returns {ReturnType<typeof setInterval>}
     */
    interval(callback, delayMs) {
        return this._lc.interval(callback, delayMs);
    }

    /**
     * Cancel a specific timeout registered via `this.timeout()`.
     * @param {ReturnType<typeof setTimeout>} timeoutId
     * @returns {this}
     */
    clearTimeout(timeoutId) {
        this._lc.clearTimeout(timeoutId);
        return this;
    }

    /**
     * Cancel a specific interval registered via `this.interval()`.
     * @param {ReturnType<typeof setInterval>} intervalId
     * @returns {this}
     */
    clearInterval(intervalId) {
        this._lc.clearInterval(intervalId);
        return this;
    }

    /**
     * Cancel all pending timeouts and intervals on this component.
     * @returns {this}
     */
    clearTimers() {
        this._lc.clearTimers();
        return this;
    }

    /**
     * Register an arbitrary cleanup callback, called during `unmount()`.
     * @param {Function} cleanup
     * @returns {this}
     */
    addCleanup(cleanup) {
        this._lc.addCleanup(cleanup);
        return this;
    }

    /**
     * Lifecycle-managed event delegation, auto-cleaned on `unmount()`.
     * @param {Element|string} parent - Parent element or CSS selector
     * @param {string} event - Event name
     * @param {string} selector - Child CSS selector to match
     * @param {function(Event, Element): void} handler
     * @returns {this}
     */
    delegate(parent, event, selector, handler) {
        this._lc.delegate(parent, event, selector, handler);
        return this;
    }

    /**
     * Adopt a child: start it immediately and stop it when this component unmounts.
     * @param {Module|Component|Object} child
     * @param {AdoptOptions} [options={}]
     * @returns {this}
     */
    adopt(child, options = {}) {
        this._lc.adopt(child, options);
        return this;
    }

    /**
     * Create a memoized selector (convenience wrapper).
     * @template R
     * @param {SelectorFn[]} inputSelectors
     * @param {function(...*): R} resultFunc
     * @returns {function(*): R}
     */
    createSelector(inputSelectors, resultFunc) {
        return this._lc.createSelector(inputSelectors, resultFunc);
    }
}
