/**
 * ListSuite — Tests renderList with a live task-queue simulation.
 *
 * Same principle as GridSuite: items live in this._items (private field),
 * not in component state. The interval timer mutates _items directly and
 * calls _renderMyList() imperatively — no setState, no morphDOM cycle.
 *
 * this.on(this.refs.X) is safe here for the same reason: refs are set once
 * by render(), and since setState is never called, they remain valid.
 */
import { Component, createElement, renderList, $ } from '../../index.js';

const STATUSES = ['Ready', 'Syncing...', 'Pending', 'Error'];
const STATUS_COLORS = {
    'Ready': { fg: 'var(--green)', bg: 'rgba(74,222,128,0.12)' },
    'Syncing...': { fg: 'var(--orange)', bg: 'rgba(251,146,60,0.12)' },
    'Pending': { fg: 'var(--blue)', bg: 'rgba(56,189,248,0.12)' },
    'Error': { fg: 'var(--red)', bg: 'rgba(240,84,84,0.12)' },
};

function makeTask(i) {
    const status = STATUSES[i % STATUSES.length];
    return {
        id: `task-${i}`,
        title: `Task Element ${i}`,
        desc: `Node ID: ${i * 401} · spawned at boot`,
        status,
        progress: status === 'Ready' ? 100 : Math.floor(Math.random() * 60)
    };
}

export class ListSuite extends Component {
    constructor(props) {
        super(props);
        // Private — no setState(), morphDOM never runs after mount
        this._items = Array.from({ length: 8 }, (_, i) => makeTask(i));
        this._nextId = this._items.length;
    }

    onStart() {
        this._renderMyList();

        this.on(this.refs.addBtn, 'click', () => {
            this._items = [{
                id: `task-${Date.now()}`,
                title: `Injected Task`,
                desc: `Spawned: ${new Date().toLocaleTimeString()}`,
                status: 'Pending',
                progress: 0
            }, ...this._items];
            this._renderMyList();
        });

        this.on(this.refs.shuffleBtn, 'click', () => {
            this._items = [...this._items].sort(() => Math.random() - 0.5);
            this._renderMyList();
        });

        this.on(this.refs.clearBtn, 'click', () => {
            this._items = this._items.filter(t => t.status !== 'Ready');
            this._renderMyList();
        });

        // Simulate live progress ticks every second
        this.interval(() => {
            this._items = this._items.map(item => {
                if (item.status === 'Ready' || item.status === 'Error') return item;
                const newProg = item.progress + Math.floor(Math.random() * 20) + 5;
                if (newProg >= 100) {
                    return { ...item, progress: 100, status: 'Ready' };
                }
                return { ...item, progress: newProg };
            });
            this._renderMyList();
        }, 800);
    }

    _renderMyList() {
        renderList(
            this.refs.listRoot,
            this._items,
            (item) => item.id,

            // CREATE: called when a new key enters the list
            (item) => {
                const sc = STATUS_COLORS[item.status] || STATUS_COLORS['Pending'];
                return createElement('div', {
                    className: 'vs-lab-item',
                    style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px', transition: 'background 0.3s' }
                },
                    // Row 1: title + status badge
                    createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
                        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                            createElement('span', { className: 'vs-lab-text', textContent: item.title, style: { fontWeight: '600' } }),
                            createElement('span', { className: 'lab-card-meta', textContent: item.desc })
                        ),
                        createElement('span', {
                            dataset: { statusBadge: 'true' },
                            className: 'vs-lab-index',
                            textContent: item.status,
                            style: { flexShrink: 0, color: sc.fg, backgroundColor: sc.bg, margin: 0 }
                        })
                    ),
                    // Row 2: progress bar
                    createElement('div', { style: { width: '100%', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' } },
                        createElement('div', {
                            dataset: { progressFill: 'true' },
                            style: {
                                height: '100%',
                                width: `${item.progress}%`,
                                background: sc.fg,
                                transition: 'width 0.5s ease, background 0.3s ease',
                                borderRadius: '2px'
                            }
                        })
                    )
                );
            },

            // UPDATE: called when a key already exists — patch only what changed
            (el, item) => {
                const sc = STATUS_COLORS[item.status] || STATUS_COLORS['Pending'];

                const badge = $('[data-status-badge="true"]', el);
                if (badge) {
                    if (badge.textContent !== item.status) badge.textContent = item.status;
                    badge.style.color = sc.fg;
                    badge.style.backgroundColor = sc.bg;
                }

                const fill = $('[data-progress-fill="true"]', el);
                if (fill) {
                    fill.style.width = `${item.progress}%`;
                    fill.style.background = sc.fg;
                }
            },
            { poolKey: 'lab-list-tasks' }
        );
    }

    render() {
        return createElement('div', { className: 'suite-container' },
            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'renderList' }),
                createElement('p', { className: 'suite-description', textContent: 'Live task-queue simulation. renderList patches only changed sub-nodes (status badge, progress bar) every 800ms without touching the rest of the DOM. Shuffle to verify key-based ordering.' })
            ),

            createElement('div', { className: 'sandbox-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Task Queue' })
                ),
                createElement('div', { className: 'lab-controls', style: { paddingBottom: '20px', borderBottom: '1px solid var(--border)', marginBottom: '20px' } },
                    createElement('button', { ref: this.ref('addBtn'), className: 'lab-btn', textContent: 'Inject Task' }),
                    createElement('button', { ref: this.ref('shuffleBtn'), className: 'lab-btn lab-btn-outline', textContent: 'Shuffle Order' }),
                    createElement('button', { ref: this.ref('clearBtn'), className: 'lab-btn lab-btn-outline', textContent: 'Clear Finished' })
                ),
                createElement('div', {
                    ref: this.ref('listRoot'),
                    style: { display: 'flex', flexDirection: 'column', gap: '8px' }
                })
            )
        );
    }
}
