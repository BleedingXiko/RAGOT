/**
 * AdoptSuite — Module → Component wiring via adoptComponent with sync.
 *
 * Demonstrates:
 *  - A Module that owns two child Components via adoptComponent()
 *  - The sync callback: how module state is pushed into component state
 *    with identity guards to avoid unnecessary re-renders
 *  - Module.stop() automatically unmounts all adopted components
 *  - mountBefore() — inserts a component before a sibling node
 *
 * Design: a fake "Playlist" Module drives two adopted components:
 *   - PlaylistBar (shows the current track + controls)
 *   - QueueView (shows the full queue with live highlight)
 * Toggling "Stop Module" unmounts BOTH components in one call.
 */
import { Module, Component, createElement, renderList, $, clear } from '../../index.js';
import { makePlaceholderSrc } from '../labUtils.js';

// ─── Data ─────────────────────────────────────────────────────────────────

const TRACKS = Array.from({ length: 12 }, (_, i) => ({
    id: `track-${i}`,
    title: `Track ${String(i + 1).padStart(2, '0')} — ${['Intro', 'Rise', 'Drop', 'Build', 'Bridge', 'Hook', 'Verse', 'Break', 'Solo', 'Outro', 'Reprise', 'Coda'][i]}`,
    artist: ['Ghost', 'Neon', 'Pulse', 'Echo'][i % 4],
    duration: 120 + i * 17,
    thumb: makePlaceholderSrc(i, `${i + 1}`, 48, 48),
}));

function fmtTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── PlaylistModule ─────────────────────────────────────────────────────────

class PlaylistModule extends Module {
    constructor() {
        super({
            tracks: TRACKS,
            currentIdx: 0,
            playing: false,
            elapsed: 0,
        });
        this._ticker = null;
    }

    onStart() {
        this.watchState(s => {
            if (s.playing && this._ticker === null) {
                this._startTick();
            } else if (!s.playing && this._ticker !== null) {
                this._stopTick();
            }
        }, { selector: s => s.playing, immediate: false });
    }

    onStop() { this._stopTick(); }

    play()  { this.setState({ playing: true }); }
    pause() { this.setState({ playing: false }); }

    next() {
        const next = (this.state.currentIdx + 1) % this.state.tracks.length;
        this.batchState(s => { s.currentIdx = next; s.elapsed = 0; });
    }

    prev() {
        const prev = (this.state.currentIdx - 1 + this.state.tracks.length) % this.state.tracks.length;
        this.batchState(s => { s.currentIdx = prev; s.elapsed = 0; });
    }

    seek(idx) {
        this.batchState(s => { s.currentIdx = idx; s.elapsed = 0; s.playing = true; });
    }

    _startTick() {
        this._ticker = this.interval(() => {
            const { elapsed, currentIdx, tracks } = this.state;
            const dur = tracks[currentIdx].duration;
            if (elapsed >= dur - 1) {
                this.next();
            } else {
                this.setState({ elapsed: elapsed + 1 });
            }
        }, 100); // fast for demo
    }

    _stopTick() {
        if (this._ticker !== null) {
            this.clearInterval(this._ticker);
            this._ticker = null;
        }
    }
}

// ─── PlaylistBar Component ─────────────────────────────────────────────────

class PlaylistBar extends Component {
    constructor(mod) {
        super({ track: null, playing: false, elapsed: 0, pct: 0 });
        this._mod = mod;
    }

    onStart() {
        this.delegate(this.element, 'click', '[data-pb-action]', (e, target) => {
            const a = target.dataset.pbAction;
            if (a === 'play')  this._mod.play();
            if (a === 'pause') this._mod.pause();
            if (a === 'next')  this._mod.next();
            if (a === 'prev')  this._mod.prev();
        });
    }

    render() {
        const { track, playing, elapsed, pct } = this.state;
        if (!track) return createElement('div', { className: 'pb-empty', textContent: 'No track loaded' });

        return createElement('div', { className: 'pb-bar' },
            createElement('img', { src: track.thumb, className: 'pb-thumb', alt: '' }),

            createElement('div', { className: 'pb-info' },
                createElement('div', { className: 'pb-title', textContent: track.title }),
                createElement('div', { className: 'pb-artist', textContent: track.artist }),
                createElement('div', { className: 'pb-progress' },
                    createElement('span', { className: 'pb-time', textContent: fmtTime(elapsed) }),
                    createElement('div', { className: 'pb-track' },
                        createElement('div', { className: 'pb-fill', style: { width: `${pct}%` } })
                    ),
                    createElement('span', { className: 'pb-time pb-time-total', textContent: fmtTime(track.duration) })
                )
            ),

            createElement('div', { className: 'pb-controls' },
                createElement('button', { className: 'pb-btn', dataset: { pbAction: 'prev' }, textContent: '⏮' }),
                createElement('button', {
                    className: `pb-btn pb-btn-play${playing ? ' playing' : ''}`,
                    dataset: { pbAction: playing ? 'pause' : 'play' },
                    textContent: playing ? '⏸' : '▶'
                }),
                createElement('button', { className: 'pb-btn', dataset: { pbAction: 'next' }, textContent: '⏭' })
            )
        );
    }
}

// ─── QueueView Component ───────────────────────────────────────────────────

class QueueView extends Component {
    constructor(mod) {
        super({ tracks: [], currentIdx: 0 });
        this._mod = mod;
    }

    onStart() {
        this.delegate(this.element, 'click', '[data-qv-idx]', (e, target) => {
            this._mod.seek(parseInt(target.dataset.qvIdx, 10));
        });
    }

    render() {
        const { tracks, currentIdx } = this.state;
        return createElement('div', { className: 'qv-list' },
            ...tracks.map((t, i) =>
                createElement('div', {
                    className: `qv-row${i === currentIdx ? ' qv-row-active' : ''}`,
                    dataset: { qvIdx: i }
                },
                    createElement('div', { className: 'qv-num', textContent: String(i + 1).padStart(2, '0') }),
                    createElement('img', { src: t.thumb, className: 'qv-thumb', alt: '' }),
                    createElement('div', { className: 'qv-body' },
                        createElement('div', { className: 'qv-title', textContent: t.title }),
                        createElement('div', { className: 'qv-artist', textContent: t.artist })
                    ),
                    createElement('div', { className: 'qv-dur', textContent: fmtTime(t.duration) }),
                    i === currentIdx
                        ? createElement('div', { className: 'qv-playing-indicator' },
                            createElement('span', { className: 'qv-bar' }),
                            createElement('span', { className: 'qv-bar' }),
                            createElement('span', { className: 'qv-bar' })
                          )
                        : createElement('div', { className: 'qv-play-icon', textContent: '▶' })
                )
            )
        );
    }
}

// ─── Suite ────────────────────────────────────────────────────────────────

export class AdoptSuite extends Component {
    constructor(props) {
        super(props);
        this._mod = null;
        this._bar = null;
        this._queue = null;
        this._running = true;
    }

    onStart() {
        this._start();

        this.delegate(this.element, 'click', '[data-adopt-toggle]', () => {
            if (this._running) {
                this._stop();
            } else {
                this._start();
            }
        });
    }

    onStop() {
        this._stop();
    }

    _start() {
        if (this._running && this._mod) return;
        this._running = true;

        this._mod = new PlaylistModule();
        this._bar = new PlaylistBar(this._mod);
        this._queue = new QueueView(this._mod);

        // adoptComponent: mount + sync wired automatically
        this._mod.adoptComponent(this._bar, {
            startArgs: [this.refs.barContainer],
            sync: (comp, s) => {
                const track = s.tracks[s.currentIdx];
                const pct = track ? Math.round((s.elapsed / track.duration) * 100) : 0;
                comp.setState({ track, playing: s.playing, elapsed: s.elapsed, pct });
            }
        });

        this._mod.adoptComponent(this._queue, {
            startArgs: [this.refs.queueContainer],
            sync: (comp, s) => {
                // Identity guard: only update if relevant state changed
                if (comp.state.tracks !== s.tracks || comp.state.currentIdx !== s.currentIdx) {
                    comp.setState({ tracks: s.tracks, currentIdx: s.currentIdx });
                }
            }
        });

        this._mod.start();

        const btn = $('[data-adopt-toggle]', this.element);
        if (btn) {
            btn.textContent = 'Stop Module';
            btn.className = 'lab-btn lab-btn-outline';
        }

        const indicator = this.refs.moduleIndicator;
        if (indicator) {
            indicator.textContent = 'RUNNING';
            indicator.className = 'adopt-indicator adopt-indicator-running';
        }
    }

    _stop() {
        if (!this._running) return;
        this._running = false;

        // One call stops module AND unmounts both adopted components
        if (this._mod) {
            this._mod.stop();
            this._mod = null;
            this._bar = null;
            this._queue = null;
        }

        const btn = $('[data-adopt-toggle]', this.element);
        if (btn) {
            btn.textContent = 'Start Module';
            btn.className = 'lab-btn';
        }

        const indicator = this.refs.moduleIndicator;
        if (indicator) {
            indicator.textContent = 'STOPPED';
            indicator.className = 'adopt-indicator adopt-indicator-stopped';
        }

        // Clear containers using RAGOT clear() — never raw innerHTML
        const bc = this.refs.barContainer;
        const qc = this.refs.queueContainer;
        if (bc) clear(bc);
        if (qc) clear(qc);
    }

    render() {
        return createElement('div', { className: 'suite-container' },

            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'adoptComponent' }),
                createElement('p', {
                    className: 'suite-description',
                    textContent: 'PlaylistModule owns two child Components via adoptComponent(). ' +
                        'The sync callback pushes slices of module state into each component\'s setState. ' +
                        'QueueView uses an identity guard in its sync so it only re-renders when tracks or currentIdx change. ' +
                        '"Stop Module" calls module.stop() once — both adopted components unmount automatically.'
                })
            ),

            // ── Module control bar ───────────────────────────────────────
            createElement('div', { className: 'adopt-control-bar' },
                createElement('div', { className: 'adopt-control-left' },
                    createElement('span', { className: 'sandbox-label', textContent: 'PlaylistModule' }),
                    createElement('span', {
                        ref: this.ref('moduleIndicator'),
                        className: 'adopt-indicator adopt-indicator-stopped',
                        textContent: 'STOPPED'
                    })
                ),
                createElement('button', {
                    className: 'lab-btn',
                    dataset: { adoptToggle: '1' },
                    textContent: 'Start Module'
                })
            ),

            // ── PlaylistBar ──────────────────────────────────────────────
            createElement('div', { className: 'sandbox-card adopt-bar-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'PlaylistBar Component' }),
                    createElement('span', { className: 'adopt-hint', textContent: 'adoptComponent({ sync }) → setState on every module state change' })
                ),
                createElement('div', { ref: this.ref('barContainer') })
            ),

            // ── QueueView ────────────────────────────────────────────────
            createElement('div', { className: 'sandbox-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'QueueView Component' }),
                    createElement('span', { className: 'adopt-hint', textContent: 'Identity guard in sync: only re-renders when tracks or currentIdx change' })
                ),
                createElement('div', {
                    ref: this.ref('queueContainer'),
                    className: 'adopt-queue-scroll'
                })
            )
        );
    }
}
