/**
 * ModuleSuite — Interactive showcase for the Module class.
 *
 * Covers:
 *  - Module lifecycle (start / stop)
 *  - setState and microtask-batched subscriber notification
 *  - batchState (synchronous atomic multi-field update, single notify)
 *  - watchState (self-subscription with selector + immediate)
 *  - subscribe from a Component with selector + owner auto-cleanup
 *  - createSelector (memoized derived value)
 *
 * Design: a fake "MediaIndexer" Module drives a live dashboard Component.
 * All state changes are imperatively triggered by the user so cause+effect
 * is clearly visible.
 */
import { Module, Component, createElement, renderList, $ } from '../../index.js';

// ─── The Module ────────────────────────────────────────────────────────────

class MediaIndexerModule extends Module {
    constructor() {
        super({
            status: 'idle',       // 'idle' | 'scanning' | 'done' | 'error'
            scanned: 0,
            total: 0,
            errors: 0,
            lastFile: null,
            log: [],              // [{id, msg, ts}]
        });

        // Memoized selector: compute progress % only when scanned or total change
        this.progressPct = this.createSelector(
            [s => s.scanned, s => s.total],
            (scanned, total) => total > 0 ? Math.round((scanned / total) * 100) : 0
        );

        this._scanInterval = null;
        this._logId = 0;
    }

    onStart() {
        // Self-watch: log every status transition.
        // watchState doesn't forward `selector`, so we track lastStatus manually.
        // Defer _appendLog via timeout to avoid re-entrant setState inside _notifyAll.
        let lastStatus = this.state.status;
        this.watchState((state) => {
            if (state.status !== lastStatus) {
                lastStatus = state.status;
                if (state.status !== 'idle') {
                    // Defer via this.timeout() to avoid re-entrant setState inside _notifyAll
                    this.timeout(() => this._appendLog(`Status → ${state.status}`), 0);
                }
            }
        }, { immediate: false });
    }

    onStop() {
        this._stopScan();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    startScan(totalFiles = 120) {
        if (this.state.status === 'scanning') return;
        this.batchState(s => {
            s.status = 'scanning';
            s.scanned = 0;
            s.total = totalFiles;
            s.errors = 0;
            s.lastFile = null;
        });
        this._appendLog(`Scan started — ${totalFiles} files queued`);

        this._scanInterval = this.interval(() => {
            const { scanned, total } = this.state;
            if (scanned >= total) {
                this._stopScan();
                this.setState({ status: 'done' });
                this._appendLog('Scan complete');
                return;
            }

            const isError = Math.random() < 0.07;
            const fileName = `media_${(scanned + 1).toString().padStart(4, '0')}.mp4`;

            // batchState: two field mutations → exactly one subscriber notification
            this.batchState(s => {
                s.scanned = scanned + 1;
                s.lastFile = fileName;
                if (isError) s.errors += 1;
            });

            if (isError) this._appendLog(`Error: ${fileName}`);
        }, 80);
    }

    injectError() {
        if (this.state.status !== 'scanning') return;
        this.batchState(s => {
            s.errors += 1;
            s.lastFile = 'corrupt_file.mp4';
        });
        this._appendLog('Injected error: corrupt_file.mp4');
    }

    resetScan() {
        this._stopScan();
        this.batchState(s => {
            s.status = 'idle';
            s.scanned = 0;
            s.total = 0;
            s.errors = 0;
            s.lastFile = null;
            s.log = [];
        });
    }

    // ── Private ─────────────────────────────────────────────────────────────

    _stopScan() {
        if (this._scanInterval !== null) {
            this.clearInterval(this._scanInterval);
            this._scanInterval = null;
        }
    }

    _appendLog(msg) {
        const entry = {
            id: `log-${++this._logId}`,
            msg,
            ts: new Date().toLocaleTimeString(),
            isError: msg.startsWith('Error') || msg.startsWith('Injected'),
        };
        // Keep last 60 entries
        const log = [entry, ...this.state.log].slice(0, 60);
        this.setState({ log });
    }
}

// ─── The Component (wired to the Module via subscribe) ─────────────────────

class IndexerDashboard extends Component {
    constructor(mod) {
        super({});
        this._mod = mod;
    }

    onStart() {
        // Subscribe to module state — owner:this means auto-cleanup on unmount
        this._mod.subscribe((state) => {
            this._sync(state);
        }, { owner: this, immediate: true });

        // Controls
        this.delegate(this.element, 'click', '[data-mod-action]', (e, target) => {
            const action = target.dataset.modAction;
            if (action === 'start')   this._mod.startScan(150);
            if (action === 'error')   this._mod.injectError();
            if (action === 'reset')   this._mod.resetScan();
        });
    }

    _sync(state) {
        // Status pill
        const pill = this.refs.statusPill;
        if (pill) {
            pill.textContent = state.status.toUpperCase();
            pill.className = `mod-status-pill mod-status-${state.status}`;
        }

        // Progress bar + numbers
        const pct = this._mod.progressPct(state);
        const bar = this.refs.progressBar;
        if (bar) bar.style.width = `${pct}%`;

        const pctLabel = this.refs.pctLabel;
        if (pctLabel) pctLabel.textContent = `${pct}%`;

        const scanned = this.refs.scannedVal;
        if (scanned) scanned.textContent = state.scanned.toLocaleString();

        const total = this.refs.totalVal;
        if (total) total.textContent = state.total.toLocaleString();

        const errors = this.refs.errorsVal;
        if (errors) {
            errors.textContent = state.errors;
            errors.style.color = state.errors > 0 ? 'var(--red)' : 'var(--text-3)';
        }

        const lastFile = this.refs.lastFile;
        if (lastFile) lastFile.textContent = state.lastFile || '—';

        // Buttons
        const startBtn = this.refs.startBtn;
        const errorBtn = this.refs.errorBtn;
        if (startBtn) startBtn.disabled = state.status === 'scanning';
        if (errorBtn) errorBtn.disabled = state.status !== 'scanning';

        // Log
        renderList(
            this.refs.logList,
            state.log,
            item => item.id,
            item => createElement('div', {
                className: `mod-log-entry${item.isError ? ' mod-log-error' : ''}`
            },
                createElement('span', { className: 'mod-log-ts', textContent: item.ts }),
                createElement('span', { className: 'mod-log-msg', textContent: item.msg })
            ),
            null,
            { poolKey: 'module-log' }
        );
    }

    render() {
        return createElement('div', { className: 'mod-dashboard' },

            // ── Stat row ──────────────────────────────────────────────────
            createElement('div', { className: 'mod-stat-row' },
                this._statBox('Status', createElement('span', {
                    ref: this.ref('statusPill'),
                    className: 'mod-status-pill mod-status-idle',
                    textContent: 'IDLE'
                })),
                this._statBox('Progress', createElement('div', { className: 'mod-progress-wrap' },
                    createElement('div', { className: 'mod-progress-track' },
                        createElement('div', {
                            ref: this.ref('progressBar'),
                            className: 'mod-progress-fill',
                            style: { width: '0%' }
                        })
                    ),
                    createElement('span', {
                        ref: this.ref('pctLabel'),
                        className: 'mod-pct-label',
                        textContent: '0%'
                    })
                )),
                this._numStat('Scanned', 'scannedVal', '0'),
                this._numStat('Total', 'totalVal', '0'),
                this._numStat('Errors', 'errorsVal', '0'),
            ),

            // ── Last file ─────────────────────────────────────────────────
            createElement('div', { className: 'mod-last-file' },
                createElement('span', { className: 'mod-last-file-label', textContent: 'Last file:' }),
                createElement('span', {
                    ref: this.ref('lastFile'),
                    className: 'mod-last-file-name',
                    textContent: '—'
                })
            ),

            // ── Controls ──────────────────────────────────────────────────
            createElement('div', { className: 'lab-controls' },
                createElement('button', {
                    ref: this.ref('startBtn'),
                    className: 'lab-btn',
                    dataset: { modAction: 'start' },
                    textContent: 'Start Scan'
                }),
                createElement('button', {
                    ref: this.ref('errorBtn'),
                    className: 'lab-btn lab-btn-outline',
                    dataset: { modAction: 'error' },
                    textContent: 'Inject Error',
                    disabled: true
                }),
                createElement('button', {
                    className: 'lab-btn lab-btn-secondary',
                    dataset: { modAction: 'reset' },
                    textContent: 'Reset'
                })
            ),

            // ── Log ───────────────────────────────────────────────────────
            createElement('div', { className: 'mod-log-panel' },
                createElement('div', { className: 'mod-log-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Module Log' }),
                    createElement('span', { className: 'mod-log-hint', textContent: 'watchState fires on status transitions' })
                ),
                createElement('div', {
                    ref: this.ref('logList'),
                    className: 'mod-log-list'
                })
            )
        );
    }

    _statBox(label, content) {
        return createElement('div', { className: 'mod-stat-box' },
            createElement('div', { className: 'mod-stat-label', textContent: label }),
            createElement('div', { className: 'mod-stat-content' }, content)
        );
    }

    _numStat(label, refName, initial) {
        return this._statBox(label,
            createElement('span', {
                ref: this.ref(refName),
                className: 'mod-num-val',
                textContent: initial
            })
        );
    }
}

// ─── Suite wrapper ─────────────────────────────────────────────────────────

export class ModuleSuite extends Component {
    constructor(props) {
        super(props);
        this._mod = null;
        this._dashboard = null;
    }

    onStart() {
        // Start the module, adopt the dashboard component
        this._mod = new MediaIndexerModule();
        this._mod.start();

        this._dashboard = new IndexerDashboard(this._mod);
        this._dashboard.mount(this.refs.dashContainer);

        // Suite tears down: stop module when suite unmounts
        this.addCleanup(() => {
            this._dashboard.unmount();
            this._mod.stop();
        });
    }

    render() {
        return createElement('div', { className: 'suite-container' },

            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'Module' }),
                createElement('p', {
                    className: 'suite-description',
                    textContent: 'MediaIndexerModule drives a dashboard Component via subscribe(). ' +
                        'batchState merges two field mutations into one notify. ' +
                        'watchState(selector) fires only on status transitions. ' +
                        'createSelector memoizes the progress % so it only recomputes when scanned or total change.'
                })
            ),

            createElement('div', { className: 'sandbox-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'MediaIndexer Module' }),
                    createElement('div', { className: 'mod-api-pills' },
                        this._apiPill('setState'),
                        this._apiPill('batchState'),
                        this._apiPill('watchState'),
                        this._apiPill('subscribe'),
                        this._apiPill('createSelector'),
                    )
                ),
                createElement('div', { ref: this.ref('dashContainer') })
            )
        );
    }

    _apiPill(text) {
        return createElement('span', { className: 'mod-api-pill', textContent: text });
    }
}
