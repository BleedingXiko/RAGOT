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
 * RAGOT Registry — lifecycle-aware service locator for cross-module dependency injection.
 *
 * Use the registry to wire cross-module dependencies at the composition root.
 * Do **not** use it as a state store — use `createStateStore` for mutable shared state.
 *
 * **Ownership rules:**
 * - Pass an `owner` to `provide()` so the registry auto-unregisters when the owner stops.
 * - Use `waitForCancellable()` (not `waitFor()`) in modules that may stop before a key arrives.
 * - Read via `window.ragotModules.<key>` (read-only proxy) or `ragotRegistry.resolve(key)`.
 * - Write only via `ragotRegistry.provide()` — never mutate `ragotModules` directly.
 */

/**
 * @typedef {Object} WaitForOptions
 * @property {number} [timeoutMs=0] - Timeout in milliseconds. 0 means no timeout.
 */

/**
 * @typedef {Object} ProvideOptions
 * @property {boolean} [replace=false] - If true, replaces an existing registration without throwing.
 */

/**
 * @typedef {Object} CancellableWait
 * @property {Promise<*>} promise - Resolves when the key is provided (or rejects on timeout/cancel)
 * @property {function(): void} cancel - Aborts the wait and rejects the promise
 */

function isDirectMutationAllowed() {
    return typeof window !== 'undefined' && window.__RAGOT_ALLOW_DIRECT_MUTATION__ === true;
}

/**
 * Lifecycle-aware service registry. Singleton exported as `ragotRegistry`.
 * Access registered values via `window.ragotModules.<key>` or `ragotRegistry.resolve(key)`.
 */
class RAGOTRegistry {
    constructor() {
        this._entries = new Map(); // key -> { value, token }
        this._waiters = new Map(); // key -> Set<{ resolve, reject, timerId }>
    }

    /**
     * Register a value under a key. Throws if the key is already registered (unless `replace: true`).
     *
     * If `owner` is provided, the registration is automatically removed when the owner
     * calls `stop()` or `unmount()`. The owner must expose an `addCleanup()` method
     * (all RAGOT `Module` and `Component` instances qualify).
     *
     * @param {string} key - Unique registry key
     * @param {*} value - Value to register (typically a Module, store, or service object)
     * @param {Module|Component|null} [owner=null] - Lifecycle owner; auto-unregisters on teardown
     * @param {ProvideOptions} [options={}]
     * @returns {*} The registered value (for chaining convenience)
     * @throws {Error} If key already exists and `replace` is not true
     * @throws {Error} If `owner` is provided but does not expose `addCleanup()`
     *
     * @example
     * ragotRegistry.provide('appStore', appStore, rootModule);
     */
    provide(key, value, owner = null, options = {}) {
        const name = this._normalizeKey(key, 'provide');
        const { replace = false } = options;
        const existing = this._entries.get(name);
        if (existing && !replace) {
            throw new Error(`[RAGOTRegistry] "${name}" is already provided`);
        }

        const token = Symbol(`ragot:${name}`);
        this._entries.set(name, { value, token });

        // Auto-unregister when owner stops/unmounts.
        if (owner) {
            if (typeof owner.addCleanup === 'function') {
                owner.addCleanup(() => {
                    this.unregister(name, token);
                });
            } else {
                throw new Error(`[RAGOTRegistry] owner for "${name}" must expose addCleanup()`);
            }
        }

        this._resolveWaiters(name, value);
        return value;
    }

    /**
     * Remove a registration. If `token` is provided, the removal only succeeds if the
     * token matches the one issued at registration time (prevents unauthorized removal).
     * @param {string} key
     * @param {symbol|null} [token=null]
     * @returns {boolean} `true` if the key was found and removed, `false` otherwise
     */
    unregister(key, token = null) {
        const name = this._normalizeKey(key, 'unregister');
        const entry = this._entries.get(name);
        if (!entry) return false;
        if (token && entry.token !== token) return false;
        return this._entries.delete(name);
    }

    /**
     * Look up a registered value. Returns `undefined` if not registered.
     * Prefer `require()` when the key must exist.
     * @param {string} key
     * @returns {*}
     */
    resolve(key) {
        const name = this._normalizeKey(key, 'resolve');
        return this._entries.get(name)?.value;
    }

    /**
     * Look up a registered value. Throws if the key is not registered.
     * Use this when the key is expected to always be present.
     * @param {string} key
     * @returns {*}
     * @throws {Error} If the key is not registered
     */
    require(key) {
        const name = this._normalizeKey(key, 'require');
        const value = this._entries.get(name)?.value;
        if (value === undefined) {
            throw new Error(`[RAGOTRegistry] "${name}" is not provided`);
        }
        return value;
    }

    /**
     * Check whether a key is currently registered.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        const name = this._normalizeKey(key, 'has');
        return this._entries.has(name);
    }

    /**
     * Return an array of all currently registered keys.
     * @returns {string[]}
     */
    list() {
        return Array.from(this._entries.keys());
    }

    /**
     * Remove all registrations and reject all pending `waitFor` / `waitForCancellable` promises.
     * Primarily used in tests or full app teardown.
     */
    clear() {
        this._entries.clear();
        this._rejectAllWaiters(new Error('[RAGOTRegistry] registry was cleared'));
    }

    /**
     * Return a Promise that resolves when `key` is provided. Resolves immediately if the key
     * is already registered. Use `waitForCancellable()` instead when the caller may stop
     * before the key arrives (prevents leaked Promise handles).
     *
     * @param {string} key
     * @param {WaitForOptions} [options={}]
     * @returns {Promise<*>}
     *
     * @example
     * const authService = await ragotRegistry.waitFor('authService', { timeoutMs: 5000 });
     */
    waitFor(key, options = {}) {
        const name = this._normalizeKey(key, 'waitFor');
        const existing = this._entries.get(name)?.value;
        if (existing !== undefined) {
            return Promise.resolve(existing);
        }

        const { timeoutMs = 0 } = options;
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, timerId: null };
            if (!this._waiters.has(name)) {
                this._waiters.set(name, new Set());
            }
            this._waiters.get(name).add(waiter);

            if (timeoutMs > 0) {
                waiter.timerId = setTimeout(() => {
                    this._removeWaiter(name, waiter);
                    reject(new Error(`[RAGOTRegistry] waitFor("${name}") timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }
        });
    }

    /**
     * Like `waitFor()`, but returns `{ promise, cancel }` so the caller can abort the wait.
     * Always prefer this over `waitFor()` inside `Module.onStart()` or `Component.onStart()`,
     * because modules may stop before the awaited key is provided.
     *
     * @param {string} key
     * @param {WaitForOptions} [options={}]
     * @returns {CancellableWait}
     *
     * @example
     * async onStart() {
     *   const { promise, cancel } = ragotRegistry.waitForCancellable('authService', { timeoutMs: 5000 });
     *   this.addCleanup(cancel); // abort if this module stops first
     *   const auth = await promise;
     *   this.onSocket(auth.socket, 'session:expired', () => this._handleExpiry());
     * }
     */
    waitForCancellable(key, options = {}) {
        const name = this._normalizeKey(key, 'waitForCancellable');
        const existing = this._entries.get(name)?.value;
        if (existing !== undefined) {
            return { promise: Promise.resolve(existing), cancel: () => {} };
        }

        const { timeoutMs = 0 } = options;
        let waiter = null;
        let cancelled = false;

        const promise = new Promise((resolve, reject) => {
            waiter = { resolve, reject, timerId: null };
            if (!this._waiters.has(name)) {
                this._waiters.set(name, new Set());
            }
            this._waiters.get(name).add(waiter);

            if (timeoutMs > 0) {
                waiter.timerId = setTimeout(() => {
                    this._removeWaiter(name, waiter);
                    reject(new Error(`[RAGOTRegistry] waitForCancellable("${name}") timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }
        });

        const cancel = () => {
            if (cancelled || !waiter) return;
            cancelled = true;
            if (waiter.timerId) clearTimeout(waiter.timerId);
            this._removeWaiter(name, waiter);
            waiter.reject(new Error(`[RAGOTRegistry] waitForCancellable("${name}") was cancelled`));
        };

        return { promise, cancel };
    }

    _resolveWaiters(name, value) {
        const waiters = this._waiters.get(name);
        if (!waiters || waiters.size === 0) return;

        for (const waiter of waiters) {
            if (waiter.timerId) clearTimeout(waiter.timerId);
            waiter.resolve(value);
        }
        this._waiters.delete(name);
    }

    _removeWaiter(name, waiter) {
        const waiters = this._waiters.get(name);
        if (!waiters) return;
        waiters.delete(waiter);
        if (waiters.size === 0) {
            this._waiters.delete(name);
        }
    }

    _rejectAllWaiters(error) {
        for (const [name, waiters] of this._waiters.entries()) {
            for (const waiter of waiters) {
                if (waiter.timerId) clearTimeout(waiter.timerId);
                waiter.reject(error);
            }
            this._waiters.delete(name);
        }
    }

    _normalizeKey(key, methodName) {
        if (typeof key !== 'string' || key.trim() === '') {
            throw new Error(`[RAGOTRegistry] ${methodName}() requires a non-empty string key`);
        }
        return key.trim();
    }
}

export const ragotRegistry = new RAGOTRegistry();

export const ragotModules = new Proxy({}, {
    get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        return ragotRegistry.resolve(prop);
    },
    set(_target, prop, value) {
        if (!isDirectMutationAllowed()) {
            throw new Error('[RAGOTRegistry] Direct mutation of ragotModules is disabled. Use ragotRegistry.provide().');
        }
        if (typeof prop !== 'string') return false;
        ragotRegistry.provide(prop, value, null, { replace: true });
        return true;
    },
    deleteProperty(_target, prop) {
        if (!isDirectMutationAllowed()) {
            throw new Error('[RAGOTRegistry] Direct deletion from ragotModules is disabled. Use ragotRegistry.unregister().');
        }
        if (typeof prop !== 'string') return false;
        ragotRegistry.unregister(prop);
        return true;
    },
    has(_target, prop) {
        if (typeof prop !== 'string') return false;
        return ragotRegistry.has(prop);
    },
    ownKeys() {
        return ragotRegistry.list();
    },
    getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop !== 'string' || !ragotRegistry.has(prop)) {
            return undefined;
        }
        return {
            enumerable: true,
            configurable: true,
            value: ragotRegistry.resolve(prop)
        };
    }
});

if (typeof window !== 'undefined') {
    const existingModules = window.ragotModules;
    window.ragotRegistry = ragotRegistry;
    Object.defineProperty(window, 'ragotModules', {
        configurable: true,
        enumerable: true,
        get() {
            return ragotModules;
        },
        set(value) {
            if (!isDirectMutationAllowed()) {
                throw new Error('[RAGOTRegistry] window.ragotModules is read-only. Use ragotRegistry.provide().');
            }
            ragotRegistry.clear();
            if (!value || typeof value !== 'object') return;
            for (const [key, moduleValue] of Object.entries(value)) {
                ragotRegistry.provide(key, moduleValue, null, { replace: true });
            }
        }
    });

    // Preserve any pre-existing mock/object assignment made before registry bootstraps.
    if (existingModules && typeof existingModules === 'object') {
        for (const [key, moduleValue] of Object.entries(existingModules)) {
            ragotRegistry.provide(key, moduleValue, null, { replace: true });
        }
    }
}
