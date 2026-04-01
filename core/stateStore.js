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
 * State Store — proxy-tracked mutable state with versioned change notifications.
 */

/**
 * @typedef {Object} ChangeMeta
 * Metadata object delivered to every store subscriber on each change.
 * @property {string} type
 *   Change type: `'set'` | `'set:path'` | `'map:set'` | `'map:add'` | `'map:delete'` |
 *   `'map:clear'` | `'set:add'` | `'set:delete'` | `'set:clear'` | `'delete'` |
 *   `'batch'` | `'init'`
 * @property {string[]} [path] - Key-path array for the changed property (when applicable)
 * @property {*} [value] - New value
 * @property {*} [prevValue] - Previous value
 * @property {number} version - Monotonically incrementing change version counter
 * @property {string} store - Store name (from `options.name`)
 * @property {number} timestamp - `Date.now()` at notification time
 * @property {Object} [meta] - Optional caller-supplied metadata
 */

/**
 * @typedef {Object} StoreSubscribeOptions
 * Options for `store.subscribe()`.
 * @property {function(*): *} [selector]
 *   When provided, the subscriber is called only when `selector(state)` changes by `Object.is`.
 *   Subscriber signature becomes `(slice, changeMeta, store, prevSlice) => void`.
 * @property {function(*, *): boolean} [equals=Object.is]
 *   Custom equality function for the selected slice (default `Object.is`).
 * @property {boolean} [immediate=false]
 *   If true, fires the subscriber immediately with the current state (or selected slice).
 */

/**
 * @template S
 * @typedef {Object} StateStore
 * The object returned by `createStateStore()`.
 * @property {string} name - Store name (from `options.name`)
 * @property {function(): S} getState - Returns the proxied mutable state object
 * @property {function(string|string[], *=): *} get
 *   Dot-path read: `store.get('user.name')` or `store.get(['user', 'name'], fallback)`.
 * @property {function(string|string[], *, Object=): *} set
 *   Dot-path write: `store.set('user.name', 'Alice')`. Queues a change notification.
 * @property {function(Partial<S>|function(S, StateStore<S>): Partial<S>, Object=): S} setState
 *   Shallow merge (alias for `patch`). Accepts a plain object or factory function.
 * @property {function(Partial<S>|function(S, StateStore<S>): Partial<S>, Object=): S} patch
 *   Same as `setState`.
 * @property {function(function(S, StateStore<S>): void, Object=): S} batch
 *   Synchronous multi-field write — all mutations fire exactly one subscriber notification.
 * @property {function(string|string[], *, *, Object=): boolean} compareAndSet
 *   Conditional set — only writes if the current value `Object.is` the expected value.
 *   Returns `true` if the write happened.
 * @property {function(Function, StoreSubscribeOptions=): function(): void} subscribe
 *   Subscribe to state changes. Returns an unsubscribe function.
 *   - Without selector: `listener(stateProxy, changeMeta, store)`
 *   - With selector:    `listener(slice, changeMeta, store, prevSlice)`
 * @property {function(Object|function(StateStore<S>): Object): Object} registerActions
 *   Register named action functions. Each action receives `(store, ...args)` when called.
 * @property {function(string, ...*): *} dispatch
 *   Call a registered action by name: `store.dispatch('increment')`.
 * @property {Object} actions
 *   Direct access to bound action functions: `store.actions.increment()`.
 * @property {function(): string[]} listActions - Returns array of registered action names
 * @property {function(): number} getVersion - Returns the current change version counter
 * @property {function(): ChangeMeta|null} getLastChange - Returns the last change metadata
 * @property {function(Function[], Function): Function} createSelector
 *   Create a memoized derived selector scoped to this store.
 */

function isProxyableStateValue(value) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return true;
    if (value instanceof Map || value instanceof Set) return true;
    return Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeStatePath(path) {
    if (Array.isArray(path)) {
        return path.map(String).filter(Boolean);
    }
    if (typeof path === 'string') {
        return path.split('.').map(s => s.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Create a memoized selector that recomputes only when one of the input selector outputs
 * changes by `Object.is`. Safe to use as a `store.subscribe` selector.
 *
 * @template R
 * @param {Array<function(*): *>} inputSelectors - Array of selector functions `(state) => slice`
 * @param {function(...*): R} resultFunc - Combiner function called with each selector's output
 * @returns {function(*): R} Memoized selector function
 *
 * @example
 * const selectVisible = createSelector(
 *   [(s) => s.media, (s) => s.filter],
 *   (media, filter) => media.filter(m => filter === 'all' || m.type === filter)
 * );
 * store.subscribe((visible) => render(visible), { selector: selectVisible });
 */
export function createSelector(inputSelectors, resultFunc) {
    if (!Array.isArray(inputSelectors) || inputSelectors.some(fn => typeof fn !== 'function')) {
        throw new Error('[RAGOT] createSelector(inputSelectors, resultFunc): inputSelectors must be an array of functions');
    }
    if (typeof resultFunc !== 'function') {
        throw new Error('[RAGOT] createSelector(inputSelectors, resultFunc): resultFunc must be a function');
    }

    let lastStates = [];
    let lastResult = null;

    return (state) => {
        const nextStates = inputSelectors.map(s => s(state));
        const changed = nextStates.some((s, i) => !Object.is(s, lastStates[i]));

        if (changed || lastStates.length === 0) {
            lastStates = nextStates;
            lastResult = resultFunc(...nextStates);
        }
        return lastResult;
    };
}

/**
 * Create a proxy-tracked mutable state store.
 *
 * The store is framework-agnostic and can be shared across modules via `ragotRegistry`.
 * Mutations are detected automatically through a `Proxy` wrapper and coalesced into
 * microtask-batched subscriber notifications.
 *
 * Supports plain objects, Arrays, Maps, and Sets as top-level state.
 *
 * **Recommended write order:**
 * 1. `store.actions.myAction(...)` — all logic in one place
 * 2. `store.set('path.to.key', value)` — explicit dot-path write
 * 3. `store.setState({ key: value })` — shallow merge
 * 4. `store.batch((state) => { ... })` — grouped mutations, one notification
 *
 * @template {Object} S
 * @param {S} [initialState={}] - Initial state object
 * @param {Object} [options={}]
 * @param {string} [options.name='store'] - Store name used in log/error messages
 * @returns {StateStore<S>}
 *
 * @example
 * const counterStore = createStateStore({ count: 0 }, { name: 'counter' });
 * counterStore.registerActions({
 *   increment: (store) => store.set('count', store.get('count', 0) + 1),
 * });
 * ragotRegistry.provide('counterStore', counterStore, rootModule);
 */
export function createStateStore(initialState = {}, options = {}) {
    const name = options.name || 'store';
    const rootState = isProxyableStateValue(initialState) ? initialState : {};
    const subscribers = new Set();
    const proxyCache = new WeakMap();
    const actions = Object.create(null);

    let version = 0;
    let batchDepth = 0;
    let pendingChanges = [];
    let lastChange = null;
    let microtaskQueued = false;

    function notifySubscribers(batchMeta = null) {
        if (pendingChanges.length === 0) return;

        const changes = pendingChanges;
        pendingChanges = [];
        microtaskQueued = false;

        version += 1;
        lastChange = changes.length === 1 ? {
            ...changes[0],
            version,
            store: name,
            timestamp: Date.now()
        } : {
            type: 'batch',
            changes,
            version,
            store: name,
            timestamp: Date.now(),
            meta: batchMeta ? { ...batchMeta } : { source: 'microtask' }
        };

        for (const sub of subscribers) {
            try {
                if (!sub.selector) {
                    sub.listener(stateProxy, lastChange, store);
                    continue;
                }

                const nextSelected = sub.selector(stateProxy);
                if (sub.equals(nextSelected, sub.selected)) continue;

                const prevSelected = sub.selected;
                sub.selected = nextSelected;
                sub.listener(nextSelected, lastChange, store, prevSelected);
            } catch (e) {
                console.warn(`[RAGOT:StateStore:${name}] subscriber error:`, e);
            }
        }
    }

    function queueChange(change) {
        pendingChanges.push(change);
        if (batchDepth > 0 || microtaskQueued) return;

        microtaskQueued = true;
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(notifySubscribers);
        } else {
            Promise.resolve().then(notifySubscribers);
        }
    }

    function flushBatch(meta = {}) {
        if (pendingChanges.length === 0) return;
        if (microtaskQueued) return;
        notifySubscribers(meta);
    }

    function proxify(target, path = []) {
        if (!isProxyableStateValue(target)) return target;
        const cached = proxyCache.get(target);
        if (cached) return cached;

        let proxy = null;

        if (target instanceof Map) {
            proxy = new Proxy(target, {
                get(mapTarget, prop, receiver) {
                    if (prop === 'set') {
                        return (key, value) => {
                            const had = mapTarget.has(key);
                            const prevValue = mapTarget.get(key);
                            mapTarget.set(key, value);
                            queueChange({
                                type: had ? 'map:set' : 'map:add',
                                path: path.concat(String(key)),
                                value,
                                prevValue,
                                meta: { source: 'proxy.map.set' }
                            });
                            return receiver;
                        };
                    }
                    if (prop === 'delete') {
                        return (key) => {
                            if (!mapTarget.has(key)) return false;
                            const prevValue = mapTarget.get(key);
                            const result = mapTarget.delete(key);
                            queueChange({
                                type: 'map:delete',
                                path: path.concat(String(key)),
                                prevValue,
                                meta: { source: 'proxy.map.delete' }
                            });
                            return result;
                        };
                    }
                    if (prop === 'clear') {
                        return () => {
                            if (mapTarget.size === 0) return;
                            mapTarget.clear();
                            queueChange({
                                type: 'map:clear',
                                path: [...path],
                                meta: { source: 'proxy.map.clear' }
                            });
                        };
                    }
                    const value = Reflect.get(mapTarget, prop, mapTarget);
                    return typeof value === 'function' ? value.bind(mapTarget) : value;
                }
            });
            proxyCache.set(target, proxy);
            return proxy;
        }

        if (target instanceof Set) {
            proxy = new Proxy(target, {
                get(setTarget, prop, receiver) {
                    if (prop === 'add') {
                        return (value) => {
                            const had = setTarget.has(value);
                            setTarget.add(value);
                            if (!had) {
                                queueChange({
                                    type: 'set:add',
                                    path: path.concat(String(value)),
                                    value,
                                    meta: { source: 'proxy.set.add' }
                                });
                            }
                            return receiver;
                        };
                    }
                    if (prop === 'delete') {
                        return (value) => {
                            const had = setTarget.has(value);
                            const result = setTarget.delete(value);
                            if (had) {
                                queueChange({
                                    type: 'set:delete',
                                    path: path.concat(String(value)),
                                    value,
                                    meta: { source: 'proxy.set.delete' }
                                });
                            }
                            return result;
                        };
                    }
                    if (prop === 'clear') {
                        return () => {
                            if (setTarget.size === 0) return;
                            setTarget.clear();
                            queueChange({
                                type: 'set:clear',
                                path: [...path],
                                meta: { source: 'proxy.set.clear' }
                            });
                        };
                    }
                    const value = Reflect.get(setTarget, prop, setTarget);
                    return typeof value === 'function' ? value.bind(setTarget) : value;
                }
            });
            proxyCache.set(target, proxy);
            return proxy;
        }

        proxy = new Proxy(target, {
            get(obj, prop, receiver) {
                const value = Reflect.get(obj, prop, receiver);
                return isProxyableStateValue(value)
                    ? proxify(value, path.concat(String(prop)))
                    : value;
            },
            set(obj, prop, value, receiver) {
                const prevValue = Reflect.get(obj, prop, receiver);
                const result = Reflect.set(obj, prop, value, receiver);
                if (!Object.is(prevValue, value)) {
                    queueChange({
                        type: 'set',
                        path: path.concat(String(prop)),
                        value,
                        prevValue,
                        meta: { source: 'proxy.set' }
                    });
                }
                return result;
            },
            deleteProperty(obj, prop) {
                if (!Object.prototype.hasOwnProperty.call(obj, prop)) return true;
                const prevValue = obj[prop];
                const result = Reflect.deleteProperty(obj, prop);
                if (result) {
                    queueChange({
                        type: 'delete',
                        path: path.concat(String(prop)),
                        prevValue,
                        meta: { source: 'proxy.delete' }
                    });
                }
                return result;
            }
        });

        proxyCache.set(target, proxy);
        return proxy;
    }

    const stateProxy = proxify(rootState, []);

    function getState() {
        return stateProxy;
    }

    function get(path, fallbackValue = undefined) {
        const keys = normalizeStatePath(path);
        if (keys.length === 0) return stateProxy;

        let cursor = stateProxy;
        for (const key of keys) {
            if (cursor == null) return fallbackValue;
            cursor = cursor[key];
        }
        return cursor === undefined ? fallbackValue : cursor;
    }

    function set(path, value, meta = {}) {
        const keys = normalizeStatePath(path);
        if (keys.length === 0) return value;

        const finalKey = keys[keys.length - 1];
        let cursor = rootState;
        for (let i = 0; i < keys.length - 1; i += 1) {
            const key = keys[i];
            const nextValue = cursor[key];
            if (nextValue instanceof Map || nextValue instanceof Set) {
                console.warn(`[RAGOT:StateStore:${name}] store.set() path "${keys.join('.')}" passes through a Map or Set at key "${key}". Use map.set() / set.add() directly instead.`);
                return value;
            }
            if (!isProxyableStateValue(nextValue)) {
                cursor[key] = {};
            }
            cursor = cursor[key];
        }

        const prevValue = cursor[finalKey];
        if (Object.is(prevValue, value)) return value;

        cursor[finalKey] = value;
        queueChange({
            type: 'set:path',
            path: keys,
            value,
            prevValue,
            meta: {
                source: meta.source || 'store.set',
                ...meta
            }
        });
        return value;
    }

    function patch(partial, meta = {}) {
        const nextPatch = typeof partial === 'function' ? partial(stateProxy, store) : partial;
        if (!nextPatch || typeof nextPatch !== 'object') return stateProxy;

        batchDepth += 1;
        try {
            for (const [key, value] of Object.entries(nextPatch)) {
                set([key], value, {
                    source: meta.source || 'store.patch',
                    ...meta
                });
            }
        } finally {
            batchDepth -= 1;
            if (batchDepth === 0) flushBatch({
                source: meta.source || 'store.patch',
                ...meta
            });
        }
        return stateProxy;
    }

    function batch(mutator, meta = {}) {
        if (typeof mutator !== 'function') return stateProxy;
        batchDepth += 1;
        try {
            mutator(stateProxy, store);
        } finally {
            batchDepth -= 1;
            if (batchDepth === 0) flushBatch({
                source: meta.source || 'store.batch',
                ...meta
            });
        }
        return stateProxy;
    }

    function compareAndSet(path, expectedValue, nextValue, meta = {}) {
        const current = get(path);
        if (!Object.is(current, expectedValue)) return false;
        set(path, nextValue, {
            source: meta.source || 'store.compareAndSet',
            ...meta
        });
        return true;
    }

    function subscribe(listener, options = {}) {
        if (typeof listener !== 'function') return () => { };

        const selector = typeof options.selector === 'function' ? options.selector : null;
        const equals = typeof options.equals === 'function' ? options.equals : Object.is;
        const record = {
            listener,
            selector,
            equals,
            selected: selector ? selector(stateProxy) : null
        };

        subscribers.add(record);

        if (options.immediate) {
            try {
                const payload = selector ? record.selected : stateProxy;
                listener(payload, {
                    type: 'init',
                    version,
                    store: name,
                    timestamp: Date.now()
                }, store);
            } catch (e) {
                console.warn(`[RAGOT:StateStore:${name}] immediate subscriber error:`, e);
            }
        }

        return () => {
            subscribers.delete(record);
        };
    }

    function registerActions(definitions) {
        const resolved = typeof definitions === 'function' ? definitions(store) : definitions;
        if (!resolved || typeof resolved !== 'object') {
            throw new Error(`[RAGOT:StateStore:${name}] registerActions() expects an object or function returning an object`);
        }

        for (const [actionName, actionHandler] of Object.entries(resolved)) {
            if (typeof actionHandler !== 'function') {
                throw new Error(`[RAGOT:StateStore:${name}] action "${actionName}" must be a function`);
            }
            actions[actionName] = (...args) => actionHandler(store, ...args);
        }
        return actions;
    }

    function dispatch(actionName, ...args) {
        const action = actions[actionName];
        if (typeof action !== 'function') {
            throw new Error(`[RAGOT:StateStore:${name}] action "${actionName}" is not registered`);
        }
        return action(...args);
    }

    function listActions() {
        return Object.keys(actions);
    }

    function createStoreSelector(inputSelectors, resultFunc) {
        return createSelector(inputSelectors, resultFunc);
    }

    const store = {
        name,
        getState,
        get,
        set,
        setState: patch,
        patch,
        batch,
        compareAndSet,
        subscribe,
        createSelector: createStoreSelector,
        registerActions,
        dispatch,
        actions,
        listActions,
        getVersion: () => version,
        getLastChange: () => lastChange
    };

    return store;
}
