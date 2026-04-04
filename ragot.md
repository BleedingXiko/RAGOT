# RAGOT Framework Guide and API Reference

RAGOT (Rapid Assertions Generalized On Time) is a lifecycle-first frontend framework.
It is designed for explicit ownership, deterministic cleanup, and low runtime overhead.

This document is split into two parts:
1. Guide: how to design and build features in RAGOT.
2. API Reference: method-level behavior for daily implementation work.

---

## Part I: Guide

## 1. Start Here

### What RAGOT optimizes for

- Explicit ownership of side effects.
- Predictable startup and teardown.
- Native DOM operations with minimal abstraction.
- Clear boundaries between orchestration, rendering, shared state, and global messaging.

### The five channels

| Channel | Role | Default Use |
|---|---|---|
| `Module` | non-visual lifecycle owner | orchestration, sockets, timers, subscriptions |
| `Component` | UI lifecycle owner | render and own one DOM subtree |
| `createStateStore` | shared mutable state | cross-feature writable state |
| `ragotRegistry` | service locator | app boot provisioning and late binding |
| `bus` | global pub/sub | one-to-many broadcast events |

### Non-negotiable rules

1. If there is a clear owner, use ownership APIs first (`adopt`, `adoptComponent`).
2. Do not use registry as a substitute for parent-child wiring.
3. Use `bus` only for broadcast semantics.
4. Use lifecycle-managed listener/timer/socket APIs.
5. For IDs containing `::`, do not use `$`/`$$`; use `document.getElementById()`.

---

## 2. Quick Start

### Import surface

Always import from the public entry point:

```javascript
import {
    Module,
    Component,
    createStateStore,
    ragotRegistry,
    bus,
    createElement,
} from './index.js';
```

### First Component

```javascript
import { Component, createElement } from './index.js';

class Counter extends Component {
    render() {
        return createElement('button', {
            className: 'counter-btn',
            textContent: `Count: ${this.state.count}`,
            onClick: () => this.setState({ count: this.state.count + 1 })
        });
    }
}

new Counter({ count: 0 }).mount(document.getElementById('app'));
```

### First Module

```javascript
import { Module } from './index.js';

class PollingModule extends Module {
    onStart() {
        this.interval(() => this._tick(), 10_000);
    }

    _tick() {
        // background logic
    }
}

new PollingModule().start();
```

---

## 3. Mental Model

Think in terms of ownership lanes.

### Lane A: ownership

- Parent `Module` owns child `Module` and `Component` lifecycles.
- Wire with `adopt(...)` and `adoptComponent(...)`.
- Parent stops -> children stop/unmount automatically.

### Lane B: provisioning

- Composition root provisions shared services/stores into registry.
- Consumers resolve from `ragotRegistry` or `window.ragotModules`.
- This is app wiring, not local parent-child state flow.

### Lane C: broadcast

- Use `bus` for fan-out notifications where many listeners react.
- Do not use `bus` as a replacement for direct ownership/control flow.

---

## 4. Decision Matrix (Use This First)

| Situation | Use | Do Not Default To |
|---|---|---|
| Parent owns child component lifecycle | `adoptComponent` | registry lookup |
| Parent owns child module lifecycle | `adopt` | bus events |
| Parent pushes module state into child UI | `adoptComponent(..., { sync })` | registry indirection |
| Shared writable state across independent modules | `createStateStore` | bus-only state transfer |
| App startup service registration | `ragotRegistry.provide` | manual globals |
| Service may appear later | `waitForCancellable` | plain `waitFor` in long-lived lifecycle |
| One event, many independent listeners | `bus` | registry call chains |

Labs that validate this split:
- ownership: `lab/suites/AdoptSuite.js`
- shared state + registry late binding: `lab/suites/StateStoreSuite.js`
- broadcast semantics: `lab/suites/BusSuite.js`
- lifecycle cleanup guarantees: `lab/suites/TeardownSuite.js`

---

## 5. Core Lifecycle Model

### Module lifecycle

```text
new Module(initialState)
  start() -> onStart()
  setState(...) / batchState(...)
  stop() -> onStop() -> teardown listeners/timers/sockets/subscribers
```

### Component lifecycle

```text
new Component(initialState)
  mount(parent) or mountBefore(sibling)
    -> render() -> append -> onStart()
  setState(...)      -> requestAnimationFrame-batched morphDOM update
  setStateSync(...)  -> immediate morphDOM update
  unmount()          -> onStop() -> teardown -> remove element
```

Idempotency:
- `Module.start/stop` are idempotent.
- `Component.mount/unmount` are idempotent.

Runtime warning:
- `Component.mount()` warns if parent container is not in the live document.

---

## 6. Building a Feature the RAGOT Way

### Step 1: Define orchestration in a Module

- Keep sockets, timers, fetch loops, and high-level flow here.
- Avoid direct DOM ownership.

### Step 2: Define render owners as Components

- Each component owns one subtree.
- Use `render()` + `setState(...)` for UI updates.

### Step 3: Bind ownership explicitly

- Parent module creates child components.
- Parent module adopts them with `adoptComponent`.

```javascript
class LayoutModule extends Module {
    onStart() {
        this._rows = new RowsComponent({ items: [] });

        this.adoptComponent(this._rows, {
            startArgs: [this._rowsSlot],
            sync: (comp, s) => {
                if (comp.state.items !== s.items) {
                    comp.setState({ items: s.items });
                }
            }
        });
    }
}
```

### Step 4: Add shared state only if needed

- If multiple independent modules must read/write shared state, add a store.
- Otherwise keep state local to owner module/component.

---

## 7. Modules in Practice

### What belongs in Module

- Socket ownership: `onSocket`, `offSocket`.
- Periodic work: `interval`, `timeout`.
- Cross-module state subscribers.
- Child lifecycle ownership with `adopt` and `adoptComponent`.

### Module state semantics

- `setState(partial)`
  - shallow merge
  - notification is microtask-batched
- `batchState(mutator)`
  - mutates state object in place
  - exactly one notification after outermost batch returns

### Subscriber signatures

- no selector:
  - callback `(state, module)`
- with selector:
  - callback `(slice, state, module)`

Footgun:
- adding a selector changes callback signature.

### `watchState` behavior

`watchState(fn, { immediate })` is shorthand for self-owned subscribe.

Important:
- first argument must be a function.
- `watchState` is full-state callback.
- use `subscribe(..., { selector })` when you need slice-based updates.

---

## 8. Components in Practice

### What belongs in Component

- DOM generation (`render`).
- Element-level listeners.
- UI-only state.

### `setState` vs `setStateSync`

- `setState`: coalesced and rAF-scheduled.
- `setStateSync`: immediate; use only when you truly need sync DOM update.

### Refs

Use `this.ref(name)` in `createElement` options:

```javascript
render() {
    return createElement('input', {
        ref: this.ref('queryInput'),
        placeholder: 'Search...'
    });
}

onStart() {
    this.refs.queryInput?.focus();
}
```

### Static placeholder adoption (advanced)

When integrating pre-existing DOM placeholders:

1. set `this.element` to adopted node.
2. ensure refs/state are initialized before relying on them.
3. avoid dual ownership between manual DOM assignment and normal `mount`.

---

## 9. Shared State with `createStateStore`

Use a store when multiple independent modules need mutable shared data.

```javascript
import { createStateStore } from './index.js';

const playerStore = createStateStore({
    currentUrl: null,
    isPlaying: false,
    volume: 1,
}, { name: 'player' });
```

### Store API shape

- reads: `getState`, `get(path)`
- writes: `set`, `setState`/`patch`, `batch`, `compareAndSet`
- reactions: `subscribe`
- actions: `registerActions`, `dispatch`, `actions`
- diagnostics: `getVersion`, `getLastChange`, `listActions`

### Store subscriber signatures

- no selector: `(stateProxy, changeMeta, store)`
- selector: `(slice, changeMeta, store, prevSlice)`

### Recommended write boundary

Expose named actions and use those from features.

```javascript
playerStore.registerActions({
    play: (store) => store.set('isPlaying', true),
    pause: (store) => store.set('isPlaying', false),
});
```

---

## 10. Registry and `window.ragotModules`

Registry role:
- composition-root service provisioning
- shared service lookup across independent modules
- late-bound async service resolution

Not registry role:
- replacing parent-child ownership wiring
- substituting `adopt`/`adoptComponent` for local module graphs

### Typical provisioning flow

```javascript
import { ragotRegistry } from './index.js';

ragotRegistry.provide('appStore', appStore, rootModule);
ragotRegistry.provide('syncManager', syncManager, rootModule);
```

### Typical consumption flow

```javascript
const syncManager = ragotRegistry.require('syncManager');
// or
const syncManager = window.ragotModules.syncManager;
```

### Late binding with cancellation

Use `waitForCancellable` inside lifecycle owners:

```javascript
async onStart() {
    const { promise, cancel } = ragotRegistry.waitForCancellable('socket', { timeoutMs: 5000 });
    this.addCleanup(cancel);

    const socket = await promise;
    this.onSocket(socket, 'connected', () => {
        // ...
    });
}
```

### Mutation rule

`window.ragotModules` is read-only by default.
Write via `ragotRegistry.provide(...)`.

---

## 11. Event Bus

`bus` is global pub/sub for broadcast behavior.

```javascript
import { bus } from './index.js';

const unsub = bus.on('media:updated', (payload) => {
    // ...
});

bus.emit('media:updated', { categoryId: 42 });
unsub();
```

Bus API:
- `on`
- `off`
- `once`
- `emit`
- `clear`

Inside lifecycle owners, use `.listen(...)` instead of raw `bus.on(...)`.

Event naming:
- keep constants centralized
- use namespaced keys (`domain:event_name`)
- app-wide constants belong in a shared constants file (e.g. `appEvents.js`)

---

## 12. Selectors

### DOM selectors

- `$(selector, parent?)`
- `$$(selector, parent?)`

Important:
- these call `querySelector` and `querySelectorAll`
- IDs containing `::` will break selector parsing
- use `document.getElementById('auto::categories')`

### Data selectors

`createSelector(inputSelectors, resultFunc)` memoizes by `Object.is` on input slices.

```javascript
import { createSelector } from './index.js';

const selectVisibleItems = createSelector(
    [(s) => s.items, (s) => s.filter],
    (items, filter) => items.filter((item) => filter === 'all' || item.type === filter)
);
```

---

## 13. DOM and Render Utilities

### `createElement`

`createElement(tag, options, ...children)` supports:
- `className` / `class`
- `style`
- `dataset`
- `ref`
- `events`
- `onClick`, `onInput`, etc
- `textContent`
- `innerHTML` (trusted markup only)
- common property keys (`value`, `checked`, `disabled`, `id`, `src`)

Security rule:
- `innerHTML` is an XSS vector. Never pass untrusted input.

### Mutation helpers

- `batchAppend`
- `append`
- `prepend`
- `insertBefore`
- `remove`
- `morphDOM`

### Keyed reconciliation rule

When using `morphDOM`, do not mix keyed and unkeyed element siblings in the same container.
Use `data-ragot-key` consistently.

### List and grid reconciliation

- `renderList(...)`
- `renderGrid(...)`
- `clearPool(poolKey?)`

Use `poolKey` for high-churn lists.

---

## 14. Virtualization and Loading

## 14.1 `VirtualScroller`

High-level virtual scrolling component with chunk lifecycle management.

Required options:
- `renderChunk(i)`
- `totalItems()`
- `chunkSize`

Common options:
- `maxChunks` (default `5`)
- `root`
- `rootMargin` (default `'1200px 0px'`)
- `initialChunks` (default `1`)
- `chunkContainer`
- `measureChunk(el, i)`
- `buildPlaceholder(i, px)`
- `onChunkEvicted(i)`
- `poolSize` + `onRecycle(el, i)`
- `childPoolSize`

Public methods:
- `reset()`
- `getVisibleChunks()`
- `getChunkElement(i)`
- `acquireChild(chunkIndex, childOptions, parentEl)`
- `recycle()`
- `rebind(options, parentEl)`

Notes:
- async `renderChunk` is supported
- loading placeholder is inserted until chunk resolves
- pooled elements are index-agnostic; `onRecycle` must fully patch content
- parent scroller should own nested child scroller teardown
- placeholder range compaction helpers exist internally but are currently dormant;
  active runtime eviction uses per-index placeholders

## 14.2 `createInfiniteScroll`

Low-level IntersectionObserver primitive for chunk windowing.

Required fields:
- `sentinel`
- `topSentinel`
- `onLoadMore`
- `onEvictChunk`
- `visibleChunks`
- `totalItems`

Controller methods:
- `reset()`
- `destroy()`

Rule:
- sentinels must exist in DOM before creation.

## 14.3 `createLazyLoader`

Observer + queue for lazy-loading elements (usually images).

Common options:
- `selector` (default `[data-src]`)
- `root`
- `rootMargin` (default `1000px`)
- `concurrency` (default `6`)
- `onLoad`
- `onError`

Controller methods:
- `observe(el)`
- `refresh()`
- `destroy()`

Behavior:
- sets `img.src = img.dataset.src`
- manages `loading` and `loaded` classes
- retries can be handled through `onError(img, retry)`

---

## 15. App Bootstrap

```javascript
import { createApp } from './index.js';

const app = createApp(AppComponent, '#app-root', { theme: 'dark' }, 'myApp');
```

Returns mounted component instance, or `null` when target container is missing.

---

## 16. Architecture Pattern

```text
Composition root (main.js)
  - create root Module
  - create app stores and services
  - provide shared dependencies via ragotRegistry
  - start orchestration modules
  - modules own child components via adopt/adoptComponent
  - state slices flow module -> component via sync or subscriptions
```

Two lanes to keep separate:
- provisioning lane: `ragotRegistry.provide(...)`
- ownership lane: `adopt(...)` and `adoptComponent(...)`

Suggested ownership map:
- DOM subtree ownership -> `Component`
- sockets/timers/background orchestration -> `Module`
- shared writable state -> `createStateStore`
- cross-cutting app provisioning -> `ragotRegistry`
- broadcast fan-out events -> `bus`

---

## 17. Testing Checklist

For every Module, Component, and store change:

1. lifecycle transitions are called once and remain idempotent
2. teardown removes listeners, timers, socket handlers, and subscriptions
3. state updates trigger expected notifications
4. selector subscriptions skip unchanged slices
5. async waits cancel cleanly on stop/unmount

Timing reminders:
- `Module.setState` notifications are microtask-based
- `Component.setState` renders are rAF-based
- test accordingly (`await Promise.resolve()` and fake timers)

Lab coverage map:
- `Module` behavior: `lab/suites/ModuleSuite.js`
- `adoptComponent` wiring: `lab/suites/AdoptSuite.js`
- cleanup guarantees: `lab/suites/TeardownSuite.js`
- bus semantics: `lab/suites/BusSuite.js`
- store + registry patterns: `lab/suites/StateStoreSuite.js`

---

## 18. High-Impact Pitfalls

1. `watchState` first argument must be a function.
2. `subscribe` first argument must be a function.
3. `adopt()` defaults to stop method `stop`; components usually need `unmount`.
4. Mounting into detached containers breaks measurements and observers.
5. Mixing keyed and unkeyed siblings in `morphDOM` causes ordering issues.
6. Calling `onSocket` with non-socket first argument logs warning and skips binding.
7. Awaiting `waitFor(...)` without cancellation in lifecycle owners can leak pending handles.
8. Using registry for parent-owned child wiring makes ownership and teardown ambiguous.
9. Implementing the same behavior through both direct calls and bus events causes split logic paths.

---

## Part II: API Reference

## 19. Imports and Exports

- `index.js` is the canonical public import surface.
- It re-exports the full public runtime from `RAGOT.js`.
- `RAGOT.js` is the internal namespace implementation used by both ESM and browser builds.

---

## 20. `Module` API Reference

### Constructor

- `new Module(initialState = {})`

### Lifecycle hooks

- `onStart()`
- `onStop()`

### Lifecycle control

- `start() -> this`
- `stop() -> this`

### State APIs

- `setState(partial)`
- `batchState(mutatorFn) -> this`
- `subscribe(fn, options = {}) -> unsubscribe`
- `watchState(fn, options = {}) -> unsubscribe`

`subscribe` options:
- `selector`
- `immediate`
- `owner`

### Managed resource APIs

- `on(target, type, handler, options?)`
- `off(target, type, handler)`
- `listen(event, handler)`
- `emit(event, data?)`
- `timeout(callback, delayMs) -> timeoutId`
- `interval(callback, delayMs) -> intervalId`
- `clearTimeout(timeoutId)`
- `clearInterval(intervalId)`
- `clearTimers()`
- `addCleanup(cleanupFn)`
- `delegate(parent, event, selector, handler)`
- `adopt(child, options = {})`
- `createSelector(inputSelectors, resultFunc)`

### Module-only APIs

- `onSocket(socket, event, handler)`
- `offSocket(socket, event, handler)`
- `adoptComponent(component, options = {})`

`adoptComponent` options:
- `sync`
- `startMethod` (default `mount`)
- `stopMethod` (default `unmount`)
- `startArgs`

---

## 21. `Component` API Reference

### Constructor

- `new Component(initialState = {})`

### Lifecycle hooks

- `onStart()`
- `onStop()`

### Required render

- `render() -> HTMLElement`

### State and rendering

- `setState(partial)`
- `setStateSync(partial)`

### DOM ownership

- `mount(parentEl) -> element`
- `mountBefore(siblingEl) -> element`
- `unmount()`

### Refs

- `ref(name) -> callback`

### Managed resource APIs

Same surface as `Module` except socket methods and `adoptComponent`.

---

## 22. `createStateStore` API Reference

### Factory

- `createStateStore(initialState = {}, options = {}) -> store`

### Store core methods

- `getState()`
- `get(path, fallback?)`
- `set(path, value, meta?)`
- `setState(partialOrFactory, meta?)`
- `patch(partialOrFactory, meta?)`
- `batch(mutator, meta?)`
- `compareAndSet(path, expected, next, meta?)`
- `subscribe(listener, options = {})`
- `registerActions(definitions)`
- `dispatch(actionName, ...args)`
- `listActions()`
- `createSelector(inputSelectors, resultFunc)`
- `getVersion()`
- `getLastChange()`

### Store data

- `store.name`
- `store.actions`

### Subscriber options

- `selector`
- `equals` (default `Object.is`)
- `immediate`

---

## 23. `ragotRegistry` API Reference

### Core methods

- `provide(key, value, owner?, { replace? })`
- `unregister(key, token?)`
- `resolve(key)`
- `require(key)`
- `has(key)`
- `list()`
- `clear()`
- `waitFor(key, { timeoutMs? })`
- `waitForCancellable(key, { timeoutMs? }) -> { promise, cancel }`

### Ownership behavior

When `owner` is provided to `provide`, registration auto-unregisters on owner cleanup.

### `window.ragotModules`

- proxy read interface over registry values
- direct writes and deletes throw unless explicit direct-mutation escape hatch is enabled

---

## 24. `bus` API Reference

- `on(event, callback) -> unsubscribe`
- `off(event, callback)`
- `once(event, callback) -> unsubscribe`
- `emit(event, data?)`
- `clear(event?)`

---

## 25. Utility APIs Reference

### Selectors

- `$(selector, parent = document)`
- `$$(selector, parent = document)`

### DOM

- `createElement`
- `batchAppend`
- `append`
- `prepend`
- `insertBefore`
- `remove`
- `morphDOM`

### Renderers

- `renderList`
- `renderGrid`
- `clearPool`

### Helpers

- `clear`
- `delegateEvent`
- `css`
- `attr`
- `createIcon`
- `show`
- `hide`
- `toggle`
- `animateIn`
- `animateOut`

### Bootstrap

- `createApp`

### Scroll and lazy primitives

- `VirtualScroller`
- `createInfiniteScroll`
- `createLazyLoader`

---

## 26. Source Map

| File | Purpose |
|---|---|
| `index.js` | public entry point |
| `RAGOT.js` | internal namespace implementation behind the public entry |
| `ragotRegistry.js` | registry singleton and proxy access used by the public runtime |
| `core/lifecycle.js` | `Module` and `Component` implementations |
| `core/stateStore.js` | `createStateStore` and `createSelector` |
| `core/bus.js` | event bus implementation |
| `core/dom.js` | element creation and morphing |
| `core/renderers.js` | list and grid reconciliation |
| `core/selectors.js` | `$` and `$$` |
| `core/helpers.js` | helper utilities |
| `core/bootstrap.js` | `createApp` |
| `core/primitives/infiniteScroll.js` | infinite scroll primitive |
| `core/primitives/lazyLoad.js` | lazy load primitive |
| `core/components/VirtualScroller.js` | virtual scroller component |

---

## 27. Maintenance Policy

When framework behavior changes:

1. update this file
2. update tests under `static/js/tests` and lab suites when behavior examples change
3. verify export surface in `RAGOT.js` remains accurate
