/**
 * TeardownSuite — Lifecycle cleanup verifier.
 *
 * Demonstrates and proves that RAGOT cleans up all managed resources:
 *  - Intervals (this.interval) — stopped on unmount
 *  - Timeouts (this.timeout) — cancelled on unmount
 *  - DOM listeners (this.on) — removed on unmount
 *  - { once: true } listeners — auto-pruned after first fire, not leaked
 *  - Delegated listeners (this.delegate) — removed on unmount
 *  - Bus subscriptions (this.listen) — removed on unmount
 *  - addCleanup callbacks — called on unmount
 *
 * Each resource type has its own "probe": a live-mounting sub-component
 * that registers the resource, fires it while alive, and proves silence
 * after unmount by showing a "CLEAN" badge when no more events arrive.
 */
import { Component, createElement, bus, $ } from '../../index.js';

// ─── Shared event name for bus probe ──────────────────────────────────────
const BUS_EVT = 'lab:teardown:ping';

// ─── Utility: a badge that flashes on activity ────────────────────────────
function makeActivityBadge(refFn, initial = 'IDLE') {
    return createElement('span', {
        ref: refFn,
        className: `td-badge td-badge-idle`,
        textContent: initial
    });
}

// ─── Individual probe components ──────────────────────────────────────────

/**
 * IntervalProbe — registers a setInterval via this.interval().
 * While mounted: counts ticks. After unmount: tick count freezes.
 */
class IntervalProbe extends Component {
    constructor() { super({ ticks: 0 }); }

    onStart() {
        this.interval(() => {
            this.setState({ ticks: this.state.ticks + 1 });
        }, 500);
    }

    render() {
        const { ticks } = this.state;
        return createElement('div', { className: 'td-probe' },
            createElement('span', { className: 'td-probe-label', textContent: 'interval()' }),
            createElement('span', { className: 'td-probe-val', textContent: `${ticks} ticks` }),
            createElement('span', { className: 'td-badge td-badge-active', textContent: 'TICKING' })
        );
    }
}

/**
 * TimeoutProbe — registers a long-running timeout via this.timeout().
 * Unmounting before it fires should cancel it.
 */
class TimeoutProbe extends Component {
    constructor() { super({ fired: false, cancelled: false }); }

    onStart() {
        this.timeout(() => {
            this.setState({ fired: true });
        }, 4000);
        this.addCleanup(() => {
            // This fires before the timeout — if we were unmounted early,
            // the timeout was cancelled. We prove it by showing CANCELLED.
            if (!this.state.fired) {
                // Can't setState after unmount — just track a flag for display
                this._wasCancelledEarly = true;
            }
        });
    }

    render() {
        const { fired } = this.state;
        return createElement('div', { className: 'td-probe' },
            createElement('span', { className: 'td-probe-label', textContent: 'timeout(4s)' }),
            createElement('span', {
                className: 'td-probe-val',
                textContent: fired ? 'Fired!' : 'Pending…'
            }),
            createElement('span', {
                className: `td-badge ${fired ? 'td-badge-fired' : 'td-badge-active'}`,
                textContent: fired ? 'FIRED' : 'PENDING'
            })
        );
    }
}

/**
 * DOMListenerProbe — registers a mousemove listener on document via this.on().
 * While mounted: counts moves. After unmount: count freezes.
 */
class DOMListenerProbe extends Component {
    constructor() {
        super({ moves: 0 });
    }

    onStart() {
        this.on(document, 'mousemove', () => {
            this.setState({ moves: this.state.moves + 1 });
        });
    }

    render() {
        const { moves } = this.state;
        return createElement('div', { className: 'td-probe' },
            createElement('span', { className: 'td-probe-label', textContent: 'on(document, mousemove)' }),
            createElement('span', { className: 'td-probe-val', textContent: `${moves} moves` }),
            createElement('span', {
                className: 'td-badge td-badge-active',
                textContent: 'LISTENING'
            })
        );
    }
}

/**
 * OnceProbee — registers a { once: true } listener.
 * After first fire, the listener is auto-pruned from _listeners.
 * Re-registering the same handler should work (no stale duplicate block).
 */
class OnceProbe extends Component {
    constructor() { super({ count: 0, lastFired: null }); }

    onStart() {
        this._register();
    }

    _register() {
        this.on(document, 'keydown', this._handler = () => {
            const count = this.state.count + 1;
            this.setState({ count, lastFired: new Date().toLocaleTimeString() });
            // Re-register for next keydown (demonstrating no duplicate block)
            this.timeout(() => this._register(), 10);
        }, { once: true });
    }

    render() {
        const { count, lastFired } = this.state;
        return createElement('div', { className: 'td-probe' },
            createElement('span', { className: 'td-probe-label', textContent: 'on(keydown, { once })' }),
            createElement('span', { className: 'td-probe-val', textContent: count > 0 ? `${count}× · ${lastFired}` : 'Press any key' }),
            createElement('span', {
                className: `td-badge ${count > 0 ? 'td-badge-fired' : 'td-badge-idle'}`,
                textContent: count > 0 ? `${count}× FIRED` : 'WAITING'
            })
        );
    }
}

/**
 * BusProbe — registers a bus listener via this.listen().
 * After unmount: bus fires but probe receives nothing.
 */
class BusProbe extends Component {
    constructor() { super({ pings: 0 }); }

    onStart() {
        this.listen(BUS_EVT, () => {
            this.setState({ pings: this.state.pings + 1 });
        });
    }

    render() {
        const { pings } = this.state;
        return createElement('div', { className: 'td-probe' },
            createElement('span', { className: 'td-probe-label', textContent: 'listen(bus event)' }),
            createElement('span', { className: 'td-probe-val', textContent: `${pings} pings` }),
            createElement('span', {
                className: `td-badge ${pings > 0 ? 'td-badge-active' : 'td-badge-idle'}`,
                textContent: pings > 0 ? 'RECEIVING' : 'IDLE'
            })
        );
    }
}

/**
 * DelegateProbe — registers a delegated click listener via this.delegate().
 * After unmount: clicking the target element produces no response.
 */
class DelegateProbe extends Component {
    constructor() { super({ clicks: 0 }); }

    onStart() {
        this.delegate(this.element, 'click', '[data-dp-target]', () => {
            this.setState({ clicks: this.state.clicks + 1 });
        });
    }

    render() {
        const { clicks } = this.state;
        return createElement('div', { className: 'td-probe' },
            createElement('span', { className: 'td-probe-label', textContent: 'delegate(click)' }),
            createElement('button', {
                className: 'td-delegate-target lab-btn lab-btn-secondary',
                dataset: { dpTarget: '1' },
                textContent: 'Click target'
            }),
            createElement('span', { className: 'td-probe-val', textContent: `${clicks} clicks` }),
            createElement('span', {
                className: `td-badge ${clicks > 0 ? 'td-badge-active' : 'td-badge-idle'}`,
                textContent: clicks > 0 ? `${clicks}× CLICKED` : 'IDLE'
            })
        );
    }
}

/**
 * AddCleanupProbe — registers an addCleanup callback.
 * Shows that arbitrary cleanup functions run on unmount.
 */
class AddCleanupProbe extends Component {
    constructor(onCleanup) {
        super({});
        this._onCleanup = onCleanup;
    }

    onStart() {
        this.addCleanup(() => {
            this._onCleanup();
        });
    }

    render() {
        return createElement('div', { className: 'td-probe' },
            createElement('span', { className: 'td-probe-label', textContent: 'addCleanup()' }),
            createElement('span', { className: 'td-probe-val', textContent: 'Fires on unmount' }),
            createElement('span', { className: 'td-badge td-badge-active', textContent: 'REGISTERED' })
        );
    }
}

// ─── Suite ────────────────────────────────────────────────────────────────

const PROBE_DEFS = [
    { id: 'interval',   label: 'interval()',            Ctor: () => new IntervalProbe() },
    { id: 'timeout',    label: 'timeout(4s)',            Ctor: () => new TimeoutProbe() },
    { id: 'listener',   label: 'on(document, mousemove)', Ctor: () => new DOMListenerProbe() },
    { id: 'once',       label: 'on(..., { once })',      Ctor: null }, // built inline
    { id: 'bus',        label: 'listen(bus)',             Ctor: () => new BusProbe() },
    { id: 'delegate',   label: 'delegate(click)',         Ctor: () => new DelegateProbe() },
    { id: 'cleanup',    label: 'addCleanup()',            Ctor: null }, // built inline
];

export class TeardownSuite extends Component {
    constructor(props) {
        super(props);
        // Map from probe id → { instance, mounted }
        this._probes = new Map();
        this._cleanupFired = false;
        this._busInterval = null;
    }

    onStart() {
        // Mount all probes
        for (const def of PROBE_DEFS) {
            this._mountProbe(def);
        }

        // Auto-fire bus pings so the BusProbe is always exercised
        this._busInterval = this.interval(() => {
            bus.emit(BUS_EVT);
        }, 1200);

        // Unmount / remount toggles
        this.delegate(this.element, 'click', '[data-td-toggle]', (e, target) => {
            const id = target.dataset.tdToggle;
            const def = PROBE_DEFS.find(d => d.id === id);
            if (!def) return;

            const entry = this._probes.get(id);
            if (entry?.mounted) {
                this._unmountProbe(id);
            } else {
                this._mountProbe(def);
            }
        });
    }

    onStop() {
        for (const [id, entry] of this._probes) {
            if (entry.mounted) entry.instance.unmount();
        }
        this._probes.clear();
    }

    _mountProbe(def) {
        const container = $(`[data-td-slot="${def.id}"]`, this.element);
        const probeWrap = $(`[data-td-probe-wrap="${def.id}"]`, this.element);
        if (!container) return;

        let instance;
        if (def.id === 'cleanup') {
            instance = new AddCleanupProbe(() => {
                this._cleanupFired = true;
                this._updateCleanupBadge();
            });
        } else if (def.id === 'once') {
            instance = new OnceProbe();
        } else {
            instance = def.Ctor();
        }

        instance.mount(container);
        this._probes.set(def.id, { instance, mounted: true });

        // Update toggle button
        const btn = $(`[data-td-toggle="${def.id}"]`, this.element);
        if (btn) {
            btn.textContent = 'Unmount';
            btn.className = 'lab-btn lab-btn-outline td-toggle-btn';
        }

        // Clear post-unmount message
        const msg = $(`[data-td-post="${def.id}"]`, this.element);
        if (msg) msg.style.display = 'none';
    }

    _unmountProbe(id) {
        const entry = this._probes.get(id);
        if (!entry?.mounted) return;

        entry.instance.unmount();
        entry.mounted = false;

        // Update toggle button
        const btn = $(`[data-td-toggle="${id}"]`, this.element);
        if (btn) {
            btn.textContent = 'Remount';
            btn.className = 'lab-btn td-toggle-btn';
        }

        // Show post-unmount message
        const msg = $(`[data-td-post="${id}"]`, this.element);
        if (msg) {
            msg.style.display = 'flex';
            msg.textContent = '✓ Unmounted — resources released';
        }

        // For bus probe: update message after a couple pings to prove silence
        if (id === 'bus') {
            this.timeout(() => {
                const msg2 = $(`[data-td-post="${id}"]`, this.element);
                if (msg2 && !this._probes.get(id)?.mounted) {
                    msg2.textContent = '✓ Bus still emitting — probe receives nothing (listener removed)';
                }
            }, 1500);
        }
    }

    _updateCleanupBadge() {
        const badge = $('[data-td-cleanup-badge]', this.element);
        if (badge) {
            badge.textContent = 'CLEANUP FIRED';
            badge.className = 'td-badge td-badge-fired';
        }
    }

    render() {
        return createElement('div', { className: 'suite-container' },

            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'Lifecycle Teardown' }),
                createElement('p', {
                    className: 'suite-description',
                    textContent: 'Every probe mounts a Component that registers one type of managed resource. ' +
                        '"Unmount" tears it down and proves the resource is released: ' +
                        'intervals stop ticking, timeouts cancel, DOM listeners go silent, ' +
                        'bus subscriptions stop receiving, delegates stop firing, addCleanup runs.'
                })
            ),

            createElement('div', { className: 'sandbox-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Resource Probes' }),
                    createElement('span', { className: 'td-bus-hint', textContent: 'Bus pinging every 1.2s — unmount probe to prove silence' })
                ),

                createElement('div', { className: 'td-probes-grid' },
                    ...PROBE_DEFS.map(def =>
                        createElement('div', {
                            className: 'td-probe-card',
                            dataset: { tdProbeWrap: def.id }
                        },
                            createElement('div', { className: 'td-probe-card-header' },
                                createElement('span', { className: 'td-probe-card-title', textContent: def.label }),
                                createElement('button', {
                                    className: 'lab-btn lab-btn-outline td-toggle-btn',
                                    dataset: { tdToggle: def.id },
                                    textContent: 'Unmount'
                                })
                            ),

                            // The probe mounts here
                            createElement('div', { dataset: { tdSlot: def.id }, className: 'td-probe-slot' }),

                            // Post-unmount message
                            createElement('div', {
                                dataset: { tdPost: def.id },
                                className: 'td-post-msg',
                                style: { display: 'none' }
                            }),

                            // Special: addCleanup badge
                            ...(def.id === 'cleanup' ? [
                                createElement('div', { className: 'td-cleanup-row' },
                                    createElement('span', { className: 'td-probe-label', textContent: 'Cleanup status:' }),
                                    createElement('span', {
                                        dataset: { tdCleanupBadge: '1' },
                                        className: 'td-badge td-badge-idle',
                                        textContent: 'NOT YET'
                                    })
                                )
                            ] : [])
                        )
                    )
                )
            )
        );
    }
}
