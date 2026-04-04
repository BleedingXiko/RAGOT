# RAGOT

**Rapid Assertions Generalized On Time** — a lifecycle-first frontend framework for vanilla JS.

No build step. No dependencies. No virtual DOM. Just ES modules and explicit ownership of your DOM and side effects.

If you want distributable browser builds, the repo also includes an optional local bundle step that generates global-script and ESM builds in `dist/`.

---

## Why RAGOT

Most frontend frameworks make teardown an afterthought. RAGOT makes it the contract.

- Every `Module` and `Component` has a **defined lifecycle** — `start`/`stop`, `mount`/`unmount`
- Listeners, timers, sockets, and subscriptions are **registered through the lifecycle** so they clean up automatically
- DOM ownership is **explicit** — each subtree has one owner, no ambiguity
- Works on low-powered hardware — minimal runtime overhead, no diffing overhead from unnecessary re-renders

---

## Live Lab

The RAGOT Lab is an interactive browser-based showcase of every subsystem. No install, no build — open it and run suites live.

**[Open RAGOT Lab →](https://bleedingxiko.github.io/RAGOT/lab/)**

Suites included:

| Suite | What it demonstrates |
|---|---|
| `morphDOM` | In-place DOM patching with keyed reconciliation |
| `VirtualScroller` | Nested virtual scrolling — 40,000 virtual items, ~600 in DOM |
| `renderGrid` | Keyed grid reconciliation with pooling |
| `renderList` | Keyed list reconciliation |
| `createLazyLoader` | Intersection-observer lazy image loading |
| `Module` | Lifecycle, state, subscriptions, timers |
| `Event Bus` | Pub/sub broadcast semantics |
| `adoptComponent` | Parent-owned child component wiring |
| `Teardown` | Cleanup guarantees — every resource released on stop/unmount |
| `StateStore` | Proxy-tracked shared state with selector subscriptions |

---

## Run the Lab locally

The lab is pure static files — you just need any static file server pointed at the repo root.

**Python (no install):**
```sh
python3 -m http.server 8080
# open http://localhost:8080/lab/
```

**Node (no install, npx):**
```sh
npx serve .
# open http://localhost:3000/lab/
```

> ES modules require a server — opening `lab/index.html` directly via `file://` won't work.

---

## Use in your project

Copy the `ragot/` folder into your project and import from the entry point:

```js
import { Module, Component, createElement, bus } from './ragot/index.js';
```

Or import the full namespace:

```js
import RAGOT from './ragot/index.js';
```

`./ragot/index.js` is the public entry. The other top-level files in the repo are implementation details for packaging and bundling.

If you want a classic script tag build instead, generate the bundle from the repo root:

```sh
npm install
npm run build
```

That emits:

- `./dist/ragot.bundle.js`
- `./dist/ragot.min.js`
- `./dist/ragot.esm.js`
- `./dist/ragot.esm.min.js`

For a classic script tag build:

```html
<script src="./ragot/dist/ragot.min.js"></script>
<script>
  const { Component, createElement, bus, ragotRegistry } = window.RAGOT;
</script>
```

For an ESM app:

```js
import RAGOT, { Component, createElement, ragotRegistry } from './ragot/dist/ragot.esm.js';
```

The ESM default export and the script-tag `window.RAGOT` namespace expose the same public runtime, including `ragotRegistry` and `ragotModules`. The script-tag build also exposes `window.ragotRegistry` and `window.ragotModules` directly.

If you do not want to build locally, download the prebuilt browser files from the repository's GitHub Releases. Each published release can attach:

- `ragot.bundle.js`
- `ragot.min.js`
- `ragot.esm.js`
- `ragot.esm.min.js`

---

## Core primitives

| Export | Role |
|---|---|
| `Module` | Non-visual orchestration — sockets, timers, subscriptions |
| `Component` | DOM owner — renders, mounts, and manages one subtree |
| `createStateStore` | Proxy-tracked mutable state with subscriber notifications |
| `createSelector` | Memoized selector composition |
| `ragotRegistry` | Lifecycle-aware dependency injection |
| `ragotModules` | Read-only proxy access to registry entries |
| `bus` | Global pub/sub for broadcast events |
| `createElement` | Declarative DOM element creation |
| `morphDOM` | In-place DOM patching with keyed reconciliation |
| `renderList` / `renderGrid` | Keyed list/grid reconciliation with element pooling |
| `VirtualScroller` | Bidirectional virtual scrolling Component |
| `createInfiniteScroll` | Low-level IntersectionObserver scroll primitive |
| `createLazyLoader` | Lazy image loading engine |
| `createApp` | Bootstrap a root Component into the DOM |

---

## Quick start

**Component:**
```js
import { Component, createElement } from './ragot/index.js';

class Counter extends Component {
    render() {
        return createElement('button', {
            textContent: `Count: ${this.state.count}`,
            onClick: () => this.setState({ count: this.state.count + 1 })
        });
    }
}

new Counter({ count: 0 }).mount(document.getElementById('app'));
```

**Module:**
```js
import { Module } from './ragot/index.js';

class PollingModule extends Module {
    onStart() {
        this.interval(() => this._tick(), 10_000);
    }

    _tick() { /* background work */ }
}

new PollingModule().start();
```

**Shared state:**
```js
import { createStateStore } from './ragot/index.js';

const store = createStateStore({ count: 0 }, { name: 'counter' });

store.registerActions({
    increment: (s) => s.set('count', s.getState().count + 1),
});

store.subscribe((state) => console.log(state.count));
store.dispatch('increment');
```

---

## Docs

Full guide and API reference: [`ragot.md`](./ragot.md)

Covers lifecycle model, state semantics, registry patterns, virtual scrolling, lazy loading, DOM utilities, and a complete decision matrix for when to use each primitive.

---

## License

Apache 2.0 — see [`LICENSE`](./LICENSE).
Copyright 2026 BleedingXIko
