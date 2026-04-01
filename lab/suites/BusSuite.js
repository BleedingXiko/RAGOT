/**
 * BusSuite — Global bus pub/sub showcase.
 *
 * Demonstrates:
 *  - bus.emit / listen / unlisten from Component and Module
 *  - Multiple independent listeners on the same event
 *  - Auto-cleanup: listeners registered via this.listen() are removed on unmount
 *  - Bus subscriber count (introspection on the bus.events map)
 *
 * Design: a "Broadcast Tower" that lets you fire named events (alerts, chat,
 * sync signals) and N "Receiver" components each independently listening.
 * Detaching a receiver proves that its listener is removed from the bus.
 */
import { Module, Component, createElement, bus, renderList, $$ } from '../../index.js';

// ─── Event names (local to this suite) ────────────────────────────────────
const EVT_ALERT  = 'lab:bus:alert';
const EVT_CHAT   = 'lab:bus:chat';
const EVT_SYNC   = 'lab:bus:sync';
const EVT_CLEAR  = 'lab:bus:clear';

const EVENTS = [
    { id: EVT_ALERT, label: 'Alert',  color: 'var(--red)',    icon: '🔔' },
    { id: EVT_CHAT,  label: 'Chat',   color: 'var(--blue)',   icon: '💬' },
    { id: EVT_SYNC,  label: 'Sync',   color: 'var(--orange)', icon: '🔄' },
    { id: EVT_CLEAR, label: 'Clear',  color: 'var(--green)',  icon: '✓' },
];

let _msgId = 0;
function makeMsg(event, payload) {
    const def = EVENTS.find(e => e.id === event);
    return {
        id: `msg-${++_msgId}`,
        event,
        label: def?.label ?? event,
        color: def?.color ?? 'var(--text-2)',
        icon: def?.icon ?? '•',
        payload,
        ts: new Date().toLocaleTimeString(),
    };
}

// ─── Receiver Component ───────────────────────────────────────────────────

class ReceiverComponent extends Component {
    constructor(idx, onDetach) {
        super({ messages: [], attached: true });
        this._idx = idx;
        this._onDetach = onDetach;
        this._colors = ['var(--red)', 'var(--blue)', 'var(--orange)', 'var(--green)'];
    }

    onStart() {
        // Register bus listeners — these are lifecycle-owned and auto-removed on unmount
        this.listen(EVT_ALERT,  d => this._receive(EVT_ALERT, d));
        this.listen(EVT_CHAT,   d => this._receive(EVT_CHAT, d));
        this.listen(EVT_SYNC,   d => this._receive(EVT_SYNC, d));
        this.listen(EVT_CLEAR,  () => this.setState({ messages: [] }));

        this.delegate(this.element, 'click', '[data-recv-detach]', () => {
            this._onDetach(this._idx);
        });
    }

    _receive(event, payload) {
        const msg = makeMsg(event, payload);
        this.setState({ messages: [msg, ...this.state.messages].slice(0, 20) });
    }

    render() {
        const { messages, attached } = this.state;
        const color = this._colors[this._idx % this._colors.length];

        return createElement('div', {
            className: 'bus-receiver',
            style: { '--recv-color': color }
        },
            createElement('div', { className: 'bus-recv-header' },
                createElement('div', { className: 'bus-recv-dot', style: { background: color } }),
                createElement('span', { className: 'bus-recv-title', textContent: `Receiver ${this._idx + 1}` }),
                createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' } },
                    createElement('span', { className: 'bus-recv-count', textContent: `${messages.length} msgs` }),
                    createElement('button', {
                        className: 'bus-detach-btn',
                        dataset: { recvDetach: '1' },
                        textContent: 'Detach'
                    })
                )
            ),

            createElement('div', { className: 'bus-recv-feed' },
                messages.length === 0
                    ? createElement('div', { className: 'bus-recv-empty', textContent: 'Waiting for events…' })
                    : createElement('div', {},
                        ...messages.map(msg =>
                            createElement('div', { className: 'bus-msg-row' },
                                createElement('span', {
                                    className: 'bus-msg-icon',
                                    style: { color: msg.color },
                                    textContent: msg.icon
                                }),
                                createElement('span', { className: 'bus-msg-label', textContent: msg.label }),
                                createElement('span', { className: 'bus-msg-payload', textContent: msg.payload || '' }),
                                createElement('span', { className: 'bus-msg-ts', textContent: msg.ts })
                            )
                        )
                    )
            )
        );
    }
}

// ─── Suite ────────────────────────────────────────────────────────────────

export class BusSuite extends Component {
    constructor(props) {
        super(props);
        this._receivers = []; // { idx, instance }
        this._nextIdx = 0;
        this._broadcastLog = [];
        this._logId = 0;
        this._autoInterval = null;
    }

    onStart() {
        this.delegate(this.element, 'click', '[data-bus-emit]', (e, target) => {
            const event = target.dataset.busEmit;
            const payload = target.dataset.busPayload || '';
            bus.emit(event, payload);
            this._addBroadcast(event, payload);
            this._updateCounters();
        });

        this.delegate(this.element, 'click', '[data-bus-add-recv]', () => {
            this._addReceiver();
        });

        this.delegate(this.element, 'click', '[data-bus-auto]', () => {
            if (this._autoInterval) {
                this.clearInterval(this._autoInterval);
                this._autoInterval = null;
                const btn = $('[data-bus-auto]', this.element);
                if (btn) btn.textContent = 'Auto-broadcast';
            } else {
                const evts = [EVT_ALERT, EVT_CHAT, EVT_SYNC];
                let i = 0;
                this._autoInterval = this.interval(() => {
                    const event = evts[i++ % evts.length];
                    const payload = `tick-${i}`;
                    bus.emit(event, payload);
                    this._addBroadcast(event, payload);
                    this._updateCounters();
                }, 800);
                const btn = $('[data-bus-auto]', this.element);
                if (btn) btn.textContent = 'Stop Auto';
            }
        });

        // Add two receivers to start
        this._addReceiver();
        this._addReceiver();
    }

    onStop() {
        // Unmount all receivers
        for (const r of this._receivers) r.instance.unmount();
        this._receivers = [];
    }

    _addReceiver() {
        const idx = this._nextIdx++;
        const instance = new ReceiverComponent(idx, (i) => this._detachReceiver(i));
        const container = this.refs.receiversGrid;
        if (container) instance.mount(container);
        this._receivers.push({ idx, instance });
        this._updateCounters();
    }

    _detachReceiver(idx) {
        const entry = this._receivers.find(r => r.idx === idx);
        if (!entry) return;
        entry.instance.unmount(); // removes bus listeners
        this._receivers = this._receivers.filter(r => r.idx !== idx);
        this._addBroadcast('__detach__', `Receiver ${idx + 1} detached — listeners removed`);
        this._updateCounters();
    }

    _addBroadcast(event, payload) {
        const def = EVENTS.find(e => e.id === event);
        const entry = {
            id: `bc-${++this._logId}`,
            label: event === '__detach__' ? '⚠ detach' : (def?.label ?? event),
            payload,
            color: event === '__detach__' ? 'var(--orange)' : (def?.color ?? 'var(--text-2)'),
            ts: new Date().toLocaleTimeString(),
        };
        this._broadcastLog = [entry, ...this._broadcastLog].slice(0, 40);
        this._renderBroadcastLog();
    }

    _renderBroadcastLog() {
        renderList(
            this.refs.broadcastLog,
            this._broadcastLog,
            item => item.id,
            item => createElement('div', { className: 'bus-bc-row' },
                createElement('span', { className: 'bus-bc-label', style: { color: item.color }, textContent: item.label }),
                createElement('span', { className: 'bus-bc-payload', textContent: item.payload }),
                createElement('span', { className: 'bus-bc-ts', textContent: item.ts })
            ),
            null,
            { poolKey: 'bus-broadcast-log' }
        );
    }

    _updateCounters() {
        const recvCount = this.refs.recvCount;
        if (recvCount) recvCount.textContent = this._receivers.length;

        // Introspect live listener count on the bus for our events
        let listenerCount = 0;
        for (const evt of [EVT_ALERT, EVT_CHAT, EVT_SYNC, EVT_CLEAR]) {
            listenerCount += bus.events.get(evt)?.size ?? 0;
        }
        const lCount = this.refs.listenerCount;
        if (lCount) lCount.textContent = listenerCount;
    }

    render() {
        return createElement('div', { className: 'suite-container' },

            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'Event Bus' }),
                createElement('p', {
                    className: 'suite-description',
                    textContent: 'Demonstrates the global bus pub/sub. Each Receiver registers ' +
                        'listeners via this.listen() — lifecycle-owned and auto-removed on unmount. ' +
                        'Click "Detach" to unmount a receiver and watch its active listener count drop. ' +
                        '"Auto-broadcast" fires a rotating sequence of events so you can see fan-out in real time.'
                })
            ),

            // ── Broadcast Tower ──────────────────────────────────────────
            createElement('div', { className: 'sandbox-card bus-tower-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Broadcast Tower' }),
                    createElement('div', { className: 'bus-counters' },
                        createElement('div', { className: 'bus-counter' },
                            createElement('span', { ref: this.ref('recvCount'), className: 'bus-counter-val', textContent: '0' }),
                            createElement('span', { className: 'bus-counter-label', textContent: 'Receivers' })
                        ),
                        createElement('div', { className: 'bus-counter' },
                            createElement('span', { ref: this.ref('listenerCount'), className: 'bus-counter-val', textContent: '0' }),
                            createElement('span', { className: 'bus-counter-label', textContent: 'Active Listeners' })
                        )
                    )
                ),

                createElement('div', { className: 'bus-emit-grid' },
                    ...EVENTS.map(evt =>
                        createElement('button', {
                            className: 'bus-emit-btn',
                            dataset: { busEmit: evt.id, busPayload: `payload-${Math.floor(Math.random() * 999)}` },
                            style: { '--evt-color': evt.color }
                        },
                            createElement('span', { className: 'bus-emit-icon', textContent: evt.icon }),
                            createElement('span', { className: 'bus-emit-label', textContent: `Emit ${evt.label}` })
                        )
                    )
                ),

                createElement('div', { className: 'lab-controls', style: { marginTop: '12px' } },
                    createElement('button', {
                        className: 'lab-btn lab-btn-outline',
                        dataset: { busAuto: '1' },
                        textContent: 'Auto-broadcast'
                    }),
                    createElement('button', {
                        className: 'lab-btn lab-btn-secondary',
                        dataset: { busAddRecv: '1' },
                        textContent: '+ Add Receiver'
                    })
                ),

                createElement('div', { className: 'bus-bc-panel' },
                    createElement('div', { className: 'bus-bc-header' },
                        createElement('span', { className: 'sandbox-label', textContent: 'Emit Log' })
                    ),
                    createElement('div', { ref: this.ref('broadcastLog'), className: 'bus-bc-list' })
                )
            ),

            // ── Receivers ────────────────────────────────────────────────
            createElement('div', { className: 'sandbox-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Receivers' }),
                    createElement('span', { className: 'bus-hint', textContent: 'Detach proves listeners auto-remove on unmount' })
                ),
                createElement('div', {
                    ref: this.ref('receiversGrid'),
                    className: 'bus-receivers-grid'
                })
            )
        );
    }
}
