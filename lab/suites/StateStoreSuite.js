/**
 * StateStoreSuite — Shared state store and registry showcase.
 *
 * Covers:
 *  - createStateStore: setState, batch, set (dot-path), get, subscribe with selector
 *  - registerActions / dispatch / store.actions.*
 *  - compareAndSet (optimistic conditional write)
 *  - store.createSelector (memoized derived value scoped to the store)
 *  - ragotRegistry: provide (with owner for auto-unregister), waitForCancellable
 *
 * Design: a shared "Notification Centre" store is created once in the Suite.
 * Two independent Panel components each subscribe to it independently — neither
 * receives the store as a prop at construction time; they look it up through the
 * registry after the suite registers it, proving the decoupled wiring model.
 *
 * Part 1 — Store demo: controls write to the store, both panels reflect every change.
 * Part 2 — Registry demo: a simulated async service is registered with a delay;
 * the consumer panel uses waitForCancellable so it wires up correctly even when
 * the service arrives late — and cancels cleanly if the suite unmounts first.
 */
import { Module, Component, createElement, renderList, createStateStore, ragotRegistry, $ } from '../../index.js';

// ─── Store definition ─────────────────────────────────────────────────────

/**
 * Create the shared notification store.
 * Called fresh on every suite mount so each visit starts with clean state.
 */
function makeNotificationStore() {
    const store = createStateStore({
        notifications: [],    // [{ id, type, title, body, read, ts }]
        filter: 'all',        // 'all' | 'unread' | 'alerts'
        theme: 'light',       // 'light' | 'dark'
        stats: {
            total: 0,
            unread: 0,
            alerts: 0,
        },
    }, { name: 'lab:notifications' });

    // Derived selector: visible items based on filter
    const visibleSelector = store.createSelector(
        [s => s.notifications, s => s.filter],
        (notifications, filter) => {
            if (filter === 'unread') return notifications.filter(n => !n.read);
            if (filter === 'alerts') return notifications.filter(n => n.type === 'alert');
            return notifications;
        }
    );

    // Register named actions — each action fn receives (store, ...args).
    // Inside store.batch(), the mutator receives (stateProxy, store) — mutate stateProxy directly.
    store.registerActions({
        addNotification(s, { type = 'info', title, body }) {
            const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const entry = { id, type, title, body, read: false, ts: new Date().toLocaleTimeString() };
            // batch: mutator(stateProxy, store) — stateProxy is the live mutable state
            s.batch((state) => {
                const next = [entry, ...state.notifications].slice(0, 30);
                state.notifications = next;
                // set() on the store for dot-path writes into the nested stats object
                s.set('stats.total', next.length);
                s.set('stats.unread', next.filter(n => !n.read).length);
                s.set('stats.alerts', next.filter(n => n.type === 'alert').length);
            });
        },

        markAllRead(s) {
            s.batch((state) => {
                state.notifications = state.notifications.map(n => ({ ...n, read: true }));
                s.set('stats.unread', 0);
            });
        },

        clearAll(s) {
            s.setState({ notifications: [], stats: { total: 0, unread: 0, alerts: 0 } });
        },

        setFilter(s, filter) {
            // Just set directly — compareAndSet for the theme field is shown in CasDemo
            s.set('filter', filter);
        },
    });

    return { store, visibleSelector };
}

// ─── Stats Panel Component ─────────────────────────────────────────────────
// Subscribes to the store via the registry — demonstrates decoupled wiring.

class StatsPanelModule extends Module {
    constructor() {
        super({ ready: false, total: 0, unread: 0, alerts: 0, version: 0, lastChange: null });
    }

    onStart() {
        // waitForCancellable: safe to use in onStart() — cancel registered as cleanup
        // so if the module stops before the key is provided, the promise is rejected
        // and .then() never runs.
        const { promise, cancel } = ragotRegistry.waitForCancellable('lab:notif-store');
        this.addCleanup(cancel);

        promise.then(({ store }) => {
            this.setState({ ready: true });

            // Subscribe to the full store state — the changeMeta.version increments on every
            // change, making it safe to track even when nested object proxy refs don't change.
            const unsub = store.subscribe((state, meta) => {
                // Read stats fields directly from the live state proxy
                this.setState({
                    total: store.get('stats.total') ?? 0,
                    unread: store.get('stats.unread') ?? 0,
                    alerts: store.get('stats.alerts') ?? 0,
                    version: meta.version,
                    lastChange: meta.type,
                });
            }, { immediate: true });

            this.addCleanup(unsub);
        }).catch(() => { /* cancelled on unmount — expected */ });
    }
}

class StatsPanel extends Component {
    constructor(mod) {
        super({ ready: false, total: 0, unread: 0, alerts: 0, version: 0, lastChange: null });
        this._mod = mod;
    }

    onStart() {
        this._mod.subscribe(state => {
            this.setState(state);
        }, { owner: this, immediate: true });
    }

    render() {
        const { ready, total, unread, alerts, version, lastChange } = this.state;

        if (!ready) {
            return createElement('div', { className: 'ss-panel ss-panel-waiting' },
                createElement('div', { className: 'ss-panel-title', textContent: 'Stats Panel' }),
                createElement('div', { className: 'ss-waiting', textContent: 'Waiting for registry…' })
            );
        }

        return createElement('div', { className: 'ss-panel' },
            createElement('div', { className: 'ss-panel-title', textContent: 'Stats Panel' }),
            createElement('div', { className: 'ss-hint', textContent: 'Wired via ragotRegistry.waitForCancellable()' }),

            createElement('div', { className: 'ss-stats-grid' },
                this._stat('Total', total, 'var(--text-1)'),
                this._stat('Unread', unread, 'var(--orange)'),
                this._stat('Alerts', alerts, 'var(--red)'),
            ),

            createElement('div', { className: 'ss-meta-row' },
                createElement('span', { className: 'ss-meta-label', textContent: 'Store version:' }),
                createElement('span', { className: 'ss-meta-val', textContent: `v${version}` }),
                createElement('span', { className: 'ss-meta-label', textContent: 'Last change:' }),
                createElement('span', { className: 'ss-meta-val', textContent: lastChange || '—' })
            )
        );
    }

    _stat(label, value, color) {
        return createElement('div', { className: 'ss-stat' },
            createElement('span', { className: 'ss-stat-val', style: { color }, textContent: String(value) }),
            createElement('span', { className: 'ss-stat-label', textContent: label })
        );
    }
}

// ─── Notification Feed Component ───────────────────────────────────────────
// Subscribes to the full store state and applies the memoized derived selector
// locally. Subscribes without a slice selector because proxy references are
// stable (same proxy object even after mutations) — the store version counter
// is the reliable change signal.

class FeedPanel extends Component {
    constructor(store, visibleSelector) {
        super({ items: [], filter: 'all' });
        this._store = store;
        this._visibleSelector = visibleSelector;
    }

    onStart() {
        // Subscribe to full state — fire on every change.
        // Apply the memoized visibleSelector to compute the filtered list.
        const unsub = this._store.subscribe((state) => {
            // visibleSelector is memoized: re-computes only when notifications or filter change.
            const items = Array.from(this._visibleSelector(state));
            const filter = this._store.get('filter');
            this.setState({ items, filter });
        }, { immediate: true });

        this.addCleanup(unsub);

        // Delegate: mark individual item read
        this.delegate(this.element, 'click', '[data-feed-read]', (e, target) => {
            const id = target.dataset.feedRead;
            // Read current notifications as a plain array copy for mutation
            const current = Array.from(this._store.getState().notifications);
            const updated = current.map(n => n.id === id ? { ...n, read: true } : n);
            // batch: mutator receives (stateProxy, store)
            this._store.batch((state) => {
                state.notifications = updated;
                this._store.set('stats.unread', updated.filter(n => !n.read).length);
            });
        });
    }

    render() {
        const { items, filter } = this.state;

        return createElement('div', { className: 'ss-panel ss-feed-panel' },
            createElement('div', { className: 'ss-panel-title' },
                createElement('span', { textContent: 'Notification Feed' }),
                createElement('span', {
                    className: 'ss-filter-badge',
                    textContent: filter
                })
            ),
            createElement('div', { className: 'ss-hint', textContent: 'Wired via store.subscribe({ selector: visibleSelector })' }),

            items.length === 0
                ? createElement('div', { className: 'ss-empty', textContent: 'No notifications yet — add some above.' })
                : createElement('div', {
                    ref: this.ref('feedList'),
                    className: 'ss-feed-list'
                },
                    ...items.map(item =>
                        createElement('div', {
                            className: `ss-notif-row${item.read ? ' ss-notif-read' : ''}`,
                            dataset: { ragotKey: item.id }
                        },
                            createElement('div', {
                                className: `ss-notif-dot ss-notif-dot-${item.type}`
                            }),
                            createElement('div', { className: 'ss-notif-body' },
                                createElement('div', { className: 'ss-notif-title', textContent: item.title }),
                                createElement('div', { className: 'ss-notif-desc', textContent: item.body }),
                                createElement('div', { className: 'ss-notif-ts', textContent: item.ts })
                            ),
                            !item.read
                                ? createElement('button', {
                                    className: 'ss-read-btn',
                                    dataset: { feedRead: item.id },
                                    textContent: 'Mark read'
                                  })
                                : createElement('span', { className: 'ss-read-check', textContent: '✓' })
                        )
                    )
                )
        );
    }
}

// ─── compareAndSet Demo Component ─────────────────────────────────────────

class CasDemo extends Component {
    constructor(store) {
        super({ theme: 'light', casResult: null });
        this._store = store;
    }

    onStart() {
        const unsub = this._store.subscribe(theme => {
            this.setState({ theme });
        }, { selector: s => s.theme, immediate: true });
        this.addCleanup(unsub);

        this.delegate(this.element, 'click', '[data-cas-action]', (e, target) => {
            const action = target.dataset.casAction;
            const { theme } = this._store.getState();

            if (action === 'cas-pass') {
                // compareAndSet: expected === current → succeeds
                const ok = this._store.compareAndSet('theme', theme, theme === 'light' ? 'dark' : 'light');
                this.setState({ casResult: ok ? `✓ Passed — theme flipped to "${this._store.get('theme')}"` : '✗ Unexpected: should have passed' });
            } else if (action === 'cas-fail') {
                // compareAndSet: expected !== current → fails (no write)
                const wrongExpected = theme === 'light' ? 'dark' : 'light';
                const ok = this._store.compareAndSet('theme', wrongExpected, 'contrast');
                this.setState({ casResult: ok ? '✗ Unexpected: should have failed' : `✓ Failed as expected — theme unchanged: "${theme}"` });
            }
        });
    }

    render() {
        const { theme, casResult } = this.state;

        return createElement('div', { className: 'ss-panel ss-cas-panel' },
            createElement('div', { className: 'ss-panel-title', textContent: 'compareAndSet' }),
            createElement('div', { className: 'ss-hint', textContent: 'Conditional write — only succeeds when expected === current value' }),

            createElement('div', { className: 'ss-cas-current' },
                createElement('span', { className: 'ss-meta-label', textContent: 'store.get("theme"):' }),
                createElement('span', {
                    className: 'ss-cas-theme-badge',
                    textContent: theme
                })
            ),

            createElement('div', { className: 'lab-controls', style: { marginTop: '12px' } },
                createElement('button', {
                    className: 'lab-btn',
                    dataset: { casAction: 'cas-pass' },
                    textContent: 'CAS (should pass)'
                }),
                createElement('button', {
                    className: 'lab-btn lab-btn-outline',
                    dataset: { casAction: 'cas-fail' },
                    textContent: 'CAS (should fail)'
                })
            ),

            casResult
                ? createElement('div', { className: 'ss-cas-result', textContent: casResult })
                : null
        );
    }
}

// ─── Suite ────────────────────────────────────────────────────────────────

const NOTIF_TYPES = [
    { type: 'info',    label: 'Info',    color: 'var(--blue)' },
    { type: 'alert',   label: 'Alert',   color: 'var(--red)' },
    { type: 'success', label: 'Success', color: 'var(--green)' },
];

const SAMPLE_TITLES = [
    'Upload complete', 'New connection', 'Sync finished', 'Drive mounted',
    'Transcode done', 'Guest joined', 'Config saved', 'Index updated',
];

export class StateStoreSuite extends Component {
    constructor(props) {
        super(props);
        this._store = null;
        this._visibleSelector = null;
        this._statsModule = null;
        this._statsPanel = null;
        this._feedPanel = null;
        this._casPanel = null;
        this._autoInterval = null;
        this._msgCount = 0;
    }

    onStart() {
        // Create the shared store fresh for this suite instance
        const { store, visibleSelector } = makeNotificationStore();
        this._store = store;
        this._visibleSelector = visibleSelector;

        // Register the store in the registry with this suite as owner.
        // Auto-unregisters when the suite unmounts — no manual cleanup needed.
        ragotRegistry.provide('lab:notif-store', { store }, this, { replace: true });

        // Stats panel: wires itself via the registry (decoupled)
        this._statsModule = new StatsPanelModule();
        this._statsModule.start();
        this._statsPanel = new StatsPanel(this._statsModule);
        this._statsPanel.mount(this.refs.statsPanelSlot);

        // Feed panel: wires directly to store + selector
        this._feedPanel = new FeedPanel(this._store, this._visibleSelector);
        this._feedPanel.mount(this.refs.feedPanelSlot);

        // compareAndSet demo panel
        this._casPanel = new CasDemo(this._store);
        this._casPanel.mount(this.refs.casPanelSlot);

        this.addCleanup(() => {
            this._statsPanel.unmount();
            this._feedPanel.unmount();
            this._casPanel.unmount();
            this._statsModule.stop();
        });

        // Controls: add notification buttons
        this.delegate(this.element, 'click', '[data-ss-add]', (e, target) => {
            const type = target.dataset.ssAdd;
            const title = SAMPLE_TITLES[this._msgCount % SAMPLE_TITLES.length];
            this._msgCount++;
            this._store.actions.addNotification({
                type,
                title,
                body: `Event #${this._msgCount} · ${new Date().toLocaleTimeString()}`
            });
        });

        // Filter buttons
        this.delegate(this.element, 'click', '[data-ss-filter]', (e, target) => {
            const filter = target.dataset.ssFilter;
            this._store.actions.setFilter(filter);

            // Update active state imperatively (store subscription drives FeedPanel)
            const btns = this.element.querySelectorAll('[data-ss-filter]');
            btns.forEach(b => b.classList.toggle('active', b.dataset.ssFilter === filter));
        });

        // Action buttons
        this.delegate(this.element, 'click', '[data-ss-action]', (e, target) => {
            const action = target.dataset.ssAction;
            if (action === 'mark-read') this._store.actions.markAllRead();
            if (action === 'clear')     this._store.actions.clearAll();
            if (action === 'auto') {
                if (this._autoInterval) {
                    this.clearInterval(this._autoInterval);
                    this._autoInterval = null;
                    target.textContent = 'Auto-add';
                } else {
                    this._autoInterval = this.interval(() => {
                        const types = ['info', 'alert', 'success'];
                        const type = types[this._msgCount % types.length];
                        const title = SAMPLE_TITLES[this._msgCount % SAMPLE_TITLES.length];
                        this._msgCount++;
                        this._store.actions.addNotification({
                            type,
                            title,
                            body: `Auto #${this._msgCount}`
                        });
                    }, 900);
                    target.textContent = 'Stop Auto';
                }
            }
        });
    }

    render() {
        return createElement('div', { className: 'suite-container' },

            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'StateStore & Registry' }),
                createElement('p', {
                    className: 'suite-description',
                    textContent: 'A shared "Notification Centre" store is created once by the Suite. ' +
                        'StatsPanel wires itself via ragotRegistry.waitForCancellable() — it never receives the store as a prop. ' +
                        'FeedPanel subscribes directly with a memoized derived selector. ' +
                        'compareAndSet shows conditional writes. ' +
                        'The registry registration is owned by the Suite so it auto-unregisters on unmount.'
                })
            ),

            // ── Controls ─────────────────────────────────────────────────
            createElement('div', { className: 'sandbox-card ss-controls-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Store Controls' }),
                    createElement('div', { className: 'ss-api-pills' },
                        this._pill('registerActions'),
                        this._pill('dispatch / actions.*'),
                        this._pill('batch'),
                        this._pill('set (dot-path)'),
                    )
                ),

                // Add notification buttons
                createElement('div', { className: 'ss-add-row' },
                    createElement('span', { className: 'ss-add-label', textContent: 'Add notification:' }),
                    ...NOTIF_TYPES.map(t =>
                        createElement('button', {
                            className: 'lab-btn ss-add-btn',
                            dataset: { ssAdd: t.type },
                            style: { '--notif-color': t.color }
                        },
                            createElement('span', {
                                className: 'ss-add-dot',
                                style: { background: t.color }
                            }),
                            createElement('span', { textContent: t.label })
                        )
                    )
                ),

                // Filter + bulk actions
                createElement('div', { className: 'lab-controls', style: { marginTop: '12px' } },
                    createElement('div', { className: 'ss-filter-group' },
                        createElement('span', { className: 'ss-add-label', textContent: 'Filter:' }),
                        ...['all', 'unread', 'alerts'].map(f =>
                            createElement('button', {
                                className: `lab-btn lab-btn-secondary${f === 'all' ? ' active' : ''}`,
                                dataset: { ssFilter: f },
                                textContent: f
                            })
                        )
                    ),
                    createElement('button', {
                        className: 'lab-btn lab-btn-outline',
                        dataset: { ssAction: 'mark-read' },
                        textContent: 'Mark all read'
                    }),
                    createElement('button', {
                        className: 'lab-btn lab-btn-outline',
                        dataset: { ssAction: 'clear' },
                        textContent: 'Clear all'
                    }),
                    createElement('button', {
                        className: 'lab-btn',
                        dataset: { ssAction: 'auto' },
                        textContent: 'Auto-add'
                    })
                )
            ),

            // ── Two-column: stats + CAS ───────────────────────────────────
            createElement('div', { className: 'ss-two-col' },
                createElement('div', { ref: this.ref('statsPanelSlot') }),
                createElement('div', { ref: this.ref('casPanelSlot') })
            ),

            // ── Feed ─────────────────────────────────────────────────────
            createElement('div', { ref: this.ref('feedPanelSlot') })
        );
    }

    _pill(text) {
        return createElement('span', { className: 'mod-api-pill', textContent: text });
    }
}
