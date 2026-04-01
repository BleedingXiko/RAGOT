/**
 * VSSuite — Dual-axis VirtualScroller showcase.
 *
 * THE KILLER FEATURE: Nested VirtualScrollers with instance recycling.
 *
 *   Streaming mode (default):
 *     - Outer VirtualScroller: vertical. 200 category rows, chunked. Scroll
 *       down to load more, old categories evict from the DOM.
 *     - Inner VirtualScrollers: horizontal. Each category row owns its own
 *       horizontal VS with 200 cards. Scroll sideways — chunks of cards
 *       load/evict left and right.
 *     - Result: 40 000 virtual items, ~600 in the DOM at peak. True infinite
 *       scrolling in BOTH directions simultaneously. No other framework
 *       does this.
 *
 *   Vertical mode:
 *     - 10 000 rows, async chunk latency, classic virtual list.
 *
 *   Stress mode:
 *     - 100 000 rows, 0 ms latency, pure throughput test.
 *
 * Lifecycle: VirtualScroller.registerChildScroller() ties horizontal VS
 * instances to vertical chunk indices. On eviction, children are recycled
 * (paused and pooled) via VirtualScroller.childPoolSize. On reload, pooled
 * instances are reclaimed via reclaimChild() and rebound via rebind(),
 * avoiding DOM recreation. On full teardown, all children are destroyed.
 */
import { Component, createElement, VirtualScroller, clear, $, $$, append } from '../../index.js';
import { makePlaceholderSrc } from '../labUtils.js';

const CATEGORY_NAMES = [
    'Trending Now', 'Recently Added', 'Popular Picks', 'Continue Watching',
    'Top Picks for You', 'Action & Adventure', 'Sci-Fi Favorites', 'Award Winners',
    'Critically Acclaimed', 'Hidden Gems', 'New Releases', 'Classics',
    'Fan Favorites', 'Binge-Worthy', 'Watch It Again', 'Staff Picks',
    'Late Night Vibes', 'Weekend Marathon', 'Quick Bites', 'Documentaries',
    'Feel-Good Picks', 'Mind Benders', 'Cult Classics', 'Family Night',
    'International Hits', 'Animated Worlds', 'Based On Books', 'True Stories',
    'Underground Cinema', 'Director Spotlights',
];

const CARDS_PER_ROW = 200;    // per horizontal rail
const H_CHUNK_SIZE = 10;     // cards per horizontal chunk
const H_MAX_CHUNKS = 3;      // max horizontal chunks live per row
const TOTAL_ROWS = 200;    // total category rows

const MODES = [
    { id: 'streaming', label: 'Streaming', icon: '📺', count: TOTAL_ROWS, chunk: 4, max: 5, delay: true, pool: false },
    { id: 'vertical', label: 'Vertical List', icon: '↕', count: 10_000, chunk: 20, max: 5, delay: true, pool: true },
    { id: 'horizontal', label: 'Horizontal Row', icon: '↔', count: 10_000, chunk: 20, max: 5, delay: true, pool: false },
    { id: 'grid', label: 'CSS Grid', icon: '▦', count: 10_000, chunk: 40, max: 5, delay: true, pool: false },
    { id: 'stress', label: 'Stress Test', icon: '⚡', count: 100_000, chunk: 40, max: 6, delay: false, pool: true },
];

export class VSSuite extends Component {
    constructor(props) {
        super(props);
        this._vs = null;
        this._mode = MODES[0];
        this._chunksLoaded = 0;
        this._chunksEvicted = 0;
        this._hChunksLoaded = 0;
        this._statsRaf = null;
        this._debugEvents = [];
        this._debugSeq = 0;
    }

    onStart() {
        this._mountMode(this._mode);

        this.delegate(this.element, 'click', '[data-vs-mode]', (e, target) => {
            const modeId = target.dataset.vsMode;
            if (modeId === this._mode.id) return;
            const mode = MODES.find(m => m.id === modeId);
            if (!mode) return;
            this._mode = mode;

            $$('[data-vs-mode]', this.element).forEach(el => {
                el.classList.toggle('active', el.dataset.vsMode === modeId);
            });

            this._mountMode(mode);
        });
    }

    onStop() { this._destroyCurrent(); }

    // ─── Mount / destroy ─────────────────────────────────────────────────

    _mountMode(mode) {
        this._destroyCurrent();

        const viewport = this.refs.vsViewport;
        if (!viewport) return;
        clear(viewport);

        this._chunksLoaded = 0;
        this._chunksEvicted = 0;
        this._hChunksLoaded = 0;
        this._debugEvents = [];
        this._debugSeq = 0;
        this._updateStats();

        viewport.className = mode.id === 'horizontal'
            ? 'vs-viewport vs-viewport-horizontal'
            : 'vs-viewport vs-viewport-vertical';

        const desc = this.refs.modeDesc;
        if (desc) desc.textContent = this._descFor(mode);
        const badge = this.refs.modeBadge;
        if (badge) badge.textContent = this._badgeFor(mode);

        const isStreaming = mode.id === 'streaming';

        const vsConfig = {
            totalItems: () => mode.count,
            chunkSize: mode.chunk,
            maxChunks: mode.max,
            renderChunk: (i, loadCtx) => this._buildChunk(i, mode, isStreaming, mode.id, loadCtx),
            debugLabel: isStreaming ? 'parent-v' : `mode:${mode.id}`,
            debugHooks: isStreaming ? {
                onEvent: (entry) => this._recordDebug(entry),
                includeSnapshot: true,
            } : null,
            root: viewport,
            rootMargin: isStreaming ? '800px 0px' : (mode.id === 'horizontal' ? '0px 400px' : '400px 0px'),
            onChunkEvicted: () => { this._chunksEvicted++; },
            // Keep enough recycled child scrollers around to fully restore the
            // current visible parent window on back-scroll without recreating
            // horizontal rail instances from scratch.
            childPoolSize: isStreaming ? mode.chunk * mode.max : 0,
            // Element pooling for uniform-structure modes (vertical + stress).
            // Pooled chunk elements are patched in-place via onRecycle rather than
            // being discarded and rebuilt — eliminates DOM churn on re-entry.
            poolSize: mode.pool ? mode.max : 0,
            onRecycle: mode.pool ? (el, i) => this._recycleChunk(el, i, mode) : undefined,
        };

        // Variant-specific layout configuration
        if (mode.id === 'horizontal') {
            vsConfig.axis = 'horizontal';
            vsConfig.containerClass = 'vs-horz-rail-inner'; // display: contents
            vsConfig.measureChunk = (el) => {
                let w = 0;
                for (const child of el.children) {
                    const s = getComputedStyle(child);
                    w += child.offsetWidth + (parseFloat(s.marginLeft) || 0) + (parseFloat(s.marginRight) || 0);
                }
                return w;
            };
            vsConfig.buildPlaceholder = (i, px) => createElement('div', {
                dataset: { vsPlaceholder: i },
                style: `flex:none; width:${px}px; height:10px; pointer-events:none`
            });
        } else if (mode.id === 'grid') {
            vsConfig.containerClass = 'vs-grid-inner'; // grid layout
            vsConfig.measureChunk = (el) => el.offsetHeight;
            vsConfig.buildPlaceholder = (i, px) => createElement('div', {
                dataset: { vsPlaceholder: i },
                style: `grid-column: 1 / -1; height: ${px}px; pointer-events:none`
            });
        } else {
            // Default vertical
            vsConfig.containerClass = isStreaming ? 'vs-streaming-inner' : 'vs-vert-inner';
            vsConfig.measureChunk = (el) => el.offsetHeight;
            vsConfig.buildPlaceholder = (i, px) => createElement('div', {
                dataset: { vsPlaceholder: i },
                style: `height:${px}px; pointer-events:none`
            });
        }

        this._vs = new VirtualScroller(vsConfig);

        this._vs.mount(viewport);

        this._startStats();
    }

    _destroyCurrent() {
        if (this._statsRaf) {
            cancelAnimationFrame(this._statsRaf);
            this._statsRaf = null;
        }
        // Parent VS handles all child scroller teardown (active + pooled)
        if (this._vs) {
            this._vs.unmount();
            this._vs = null;
        }
    }

    // ─── Chunk builders ──────────────────────────────────────────────────

    async _buildChunk(chunkIndex, mode, isStreaming, modeId, loadCtx = null) {
        const currentVs = this._vs;

        if (mode.delay) {
            await new Promise(r => setTimeout(r, 40 + Math.random() * 140));
        }

        // PREVENT RACE CONDITION LEAK:
        // If the suite was destroyed, mode was switched, or this specific chunk
        // was evicted while we were waiting, abort immediately. Otherwise, we spin
        // up and mount horizontal scrollers that are then discarded by the parent
        // but never unmounted, causing a massive memory/observer leak.
        if (
            this._vs !== currentVs ||
            !currentVs.getVisibleChunks().has(chunkIndex) ||
            (loadCtx && typeof loadCtx.isCurrent === 'function' && !loadCtx.isCurrent())
        ) {
            return null;
        }

        this._chunksLoaded++;

        const start = chunkIndex * mode.chunk;
        const end = Math.min(start + mode.chunk, mode.count);

        if (isStreaming) {
            return this._buildStreamingChunk(chunkIndex, start, end, loadCtx);
        }

        if (modeId === 'grid' || modeId === 'horizontal') {
            return this._buildCardChunk(chunkIndex, start, end);
        }

        return this._buildVerticalChunk(chunkIndex, start, end);
    }

    /**
     * Patch a pooled vertical chunk element in-place with new row data.
     * Called by onRecycle instead of renderChunk when a pooled element is reused.
     * For the vertical/stress modes: each chunk is a div containing N .vs-row elements.
     */
    _recycleChunk(el, chunkIndex, mode) {
        const start = chunkIndex * mode.chunk;
        const end = Math.min(start + mode.chunk, mode.count);
        const rows = el.querySelectorAll('.vs-row');

        if (rows.length === end - start) {
            // Same row count — patch in-place
            for (let k = 0; k < rows.length; k++) {
                const i = start + k;
                const thumb = rows[k].querySelector('img.vs-row-thumb');
                const title = rows[k].querySelector('.vs-row-title');
                const meta  = rows[k].querySelector('.vs-row-meta');
                const badge = rows[k].querySelector('.vs-row-badge');
                const thumbSrc = makePlaceholderSrc(i % 20, `${i}`, 44, 44);
                if (thumb) thumb.src = thumbSrc;
                if (title) title.textContent = `Record #${i.toLocaleString()}`;
                if (meta)  meta.textContent  = `Chunk ${chunkIndex} · offset ${k}`;
                if (badge) badge.textContent  = `#${i}`;
            }
        } else {
            // Different row count (last chunk edge case) — rebuild children
            clear(el);
            for (let i = start; i < end; i++) {
                append(el, this._buildVerticalRow(i, chunkIndex, start));
            }
        }
        this._chunksLoaded++;
    }

    /**
     * STREAMING CHUNK — N category rows, each with its own horizontal
     * VirtualScroller. Uses the parent VS's child pooling: reclaimed
     * instances are rebound to new data, fresh instances are created only
     * when the pool is empty.
     */
    _buildStreamingChunk(chunkIndex, start, end, loadCtx = null) {
        const ownerVs = this._vs;
        const rows = [];
        const childRails = [];

        for (let rowIdx = start; rowIdx < end; rowIdx++) {
            const catName = CATEGORY_NAMES[rowIdx % CATEGORY_NAMES.length];
            const railContainer = createElement('div', { className: 'vs-category-rail' });
            childRails.push({ railContainer, rowIdx });

            rows.push(
                createElement('div', { className: 'vs-category' },
                    createElement('div', { className: 'vs-category-header' },
                        createElement('span', {
                            className: 'vs-category-title',
                            textContent: catName
                        }),
                        createElement('span', {
                            className: 'vs-category-count',
                            textContent: `${CARDS_PER_ROW} cards`
                        })
                    ),
                    railContainer
                )
            );
        }

        const chunkEl = createElement('div', { dataset: { vsChunk: chunkIndex } }, ...rows);
        this._scheduleStreamingChildrenMount(ownerVs, chunkEl, chunkIndex, childRails, loadCtx);
        return chunkEl;
    }

    /**
     * Build one horizontal chunk of cards for a category row.
     */
    _buildHCardChunk(chunkIndex, rowIdx) {
        this._hChunksLoaded++;

        const start = chunkIndex * H_CHUNK_SIZE;
        const end = Math.min(start + H_CHUNK_SIZE, CARDS_PER_ROW);
        const cards = [];

        for (let c = start; c < end; c++) {
            const globalIdx = rowIdx * CARDS_PER_ROW + c;
            const thumbSrc = makePlaceholderSrc(globalIdx % 20, `${c + 1}`, 200, 280);

            cards.push(
                createElement('div', { className: 'vs-hcard' },
                    createElement('div', { className: 'vs-hcard-img' },
                        createElement('img', {
                            src: thumbSrc, alt: '',
                            style: { width: '100%', height: '100%', objectFit: 'cover' }
                        })
                    ),
                    createElement('div', { className: 'vs-hcard-body' },
                        createElement('span', {
                            className: 'vs-hcard-title',
                            textContent: `Title ${(c + 1).toLocaleString()}`
                        }),
                        createElement('span', {
                            className: 'vs-hcard-meta',
                            textContent: `Row ${rowIdx} · Chunk ${chunkIndex}`
                        })
                    )
                )
            );
        }

        // display:contents so cards participate in the rail's flex layout
        return createElement('div', {
            dataset: { vsChunk: chunkIndex },
            style: { display: 'contents' }
        }, ...cards);
    }

    /**
     * VERTICAL CHUNK — classic list rows.
     */
    _buildVerticalChunk(chunkIndex, start, end) {
        const rows = [];
        for (let i = start; i < end; i++) {
            rows.push(this._buildVerticalRow(i, chunkIndex, start));
        }
        return createElement('div', { dataset: { vsChunk: chunkIndex } }, ...rows);
    }

    _buildCardChunk(chunkIndex, start, end) {
        const cards = [];
        for (let i = start; i < end; i++) {
            cards.push(this._buildSimpleCard(i, chunkIndex));
        }
        return createElement('div', {
            dataset: { vsChunk: chunkIndex },
            style: { display: 'contents' }
        }, ...cards);
    }

    _scheduleStreamingChildrenMount(ownerVs, chunkEl, chunkIndex, childRails, loadCtx) {
        const tryMount = () => {
            if (!ownerVs || ownerVs !== this._vs) return;
            if (!ownerVs.getVisibleChunks().has(chunkIndex)) return;
            if (loadCtx && typeof loadCtx.isCurrent === 'function' && !loadCtx.isCurrent()) return;
            if (!chunkEl?.isConnected) {
                requestAnimationFrame(tryMount);
                return;
            }

            for (const { railContainer, rowIdx } of childRails) {
                if (!railContainer?.isConnected) continue;
                if (railContainer.dataset.vsChildMounted === '1') continue;
                railContainer.dataset.vsChildMounted = '1';

                ownerVs.acquireChild(chunkIndex, {
                    axis: 'horizontal',
                    totalItems: () => CARDS_PER_ROW,
                    chunkSize: H_CHUNK_SIZE,
                    maxChunks: H_MAX_CHUNKS,
                    debugLabel: `child:${chunkIndex}:${rowIdx}`,
                    debugHooks: { onEvent: (entry) => this._recordDebug(entry) },
                    root: railContainer,
                    rootMargin: '0px 400px 0px 400px',
                    containerClass: 'vs-horz-rail-inner',
                    renderChunk: (ci) => this._buildHCardChunk(ci, rowIdx),
                    measureChunk: (el) => {
                        let w = 0;
                        for (const card of el.children) {
                            const s = getComputedStyle(card);
                            w += card.offsetWidth
                                + (parseFloat(s.marginLeft) || 0)
                                + (parseFloat(s.marginRight) || 0);
                        }
                        return w || 200;
                    },
                    buildPlaceholder: (i, px) => createElement('div', {
                        className: 'vs-horz-placeholder',
                        style: { width: `${px}px` },
                    }),
                }, railContainer);
            }

            requestAnimationFrame(() => {
                if (!ownerVs || ownerVs !== this._vs) return;
                if (!ownerVs.getVisibleChunks().has(chunkIndex)) return;
                ownerVs.refreshChunkMeasurement?.(chunkIndex);
            });
        };

        requestAnimationFrame(tryMount);
    }

    _buildVerticalRow(i, chunkIndex, start) {
        const thumbSrc = makePlaceholderSrc(i % 20, `${i}`, 44, 44);
        return createElement('div', { className: 'vs-row' },
            createElement('img', {
                src: thumbSrc, alt: '',
                className: 'vs-row-thumb'
            }),
            createElement('div', { className: 'vs-row-body' },
                createElement('span', {
                    className: 'vs-row-title',
                    textContent: `Record #${i.toLocaleString()}`
                }),
                createElement('span', {
                    className: 'vs-row-meta',
                    textContent: `Chunk ${chunkIndex} · offset ${i - start}`
                })
            ),
            createElement('span', {
                className: 'vs-row-badge',
                textContent: `#${i}`
            })
        );
    }

    _buildSimpleCard(i, chunkIndex) {
        const thumbSrc = makePlaceholderSrc(i, `${i + 1}`, 200, 280);
        return createElement('div', { className: 'vs-hcard' },
            createElement('div', { className: 'vs-hcard-img' },
                createElement('img', {
                    src: thumbSrc, alt: '',
                    style: { width: '100%', height: '100%', objectFit: 'cover' }
                })
            ),
            createElement('div', { className: 'vs-hcard-body' },
                createElement('span', {
                    className: 'vs-hcard-title',
                    textContent: `Card #${i.toLocaleString()}`
                }),
                createElement('span', {
                    className: 'vs-hcard-meta',
                    textContent: `Chunk ${chunkIndex}`
                })
            )
        );
    }

    // ─── Live stats ──────────────────────────────────────────────────────

    _startStats() {
        const update = () => {
            this._updateStats();
            this._statsRaf = requestAnimationFrame(update);
        };
        this._statsRaf = requestAnimationFrame(update);
    }

    _updateStats() {
        const loaded = this.refs.statLoaded;
        const visible = this.refs.statVisible;
        const evicted = this.refs.statEvicted;
        const hLoaded = this.refs.statHLoaded;
        const debugTrace = this.refs.debugTrace;

        if (loaded) loaded.textContent = this._chunksLoaded;
        if (visible) visible.textContent = this._vs ? this._vs.getVisibleChunks().size : 0;
        if (evicted) evicted.textContent = this._chunksEvicted;
        if (hLoaded) hLoaded.textContent = this._hChunksLoaded;
        if (debugTrace) debugTrace.textContent = this._debugEvents.join('\n');
    }

    _recordDebug(entry) {
        const {
            event,
            scroller = 'vs',
            chunkIndex = '-',
            token = '-',
            childLabel = '',
            visibleSize = '-',
            visibleWindow = '',
            placeholders = '',
            domWindow = '',
            topPrev = '',
            topNext = '',
            bottomPrev = '',
            bottomNext = '',
        } = entry || {};
        this._debugSeq += 1;
        const suffix = childLabel ? ` ${childLabel}` : '';
        const snapshot = [];
        if (visibleWindow) snapshot.push(`vis=[${visibleWindow}]`);
        if (placeholders) snapshot.push(`ph=${placeholders}`);
        if (domWindow) snapshot.push(`dom=${domWindow}`);
        if (topPrev || topNext || bottomPrev || bottomNext) {
            snapshot.push(`sent=${topPrev || '-'}<T>${topNext || '-'}|${bottomPrev || '-'}<B>${bottomNext || '-'}`);
        }
        const line = `${String(this._debugSeq).padStart(4, '0')} ${scroller} ${event} i=${chunkIndex} t=${token} v=${visibleSize}${suffix}${snapshot.length ? ` ${snapshot.join(' ')}` : ''}`;
        this._debugEvents.push(line);
        if (this._debugEvents.length > 18) this._debugEvents.shift();
    }

    // ─── Description helpers ─────────────────────────────────────────────

    _descFor(mode) {
        switch (mode.id) {
            case 'streaming': {
                const totalVirtual = (TOTAL_ROWS * CARDS_PER_ROW).toLocaleString();
                return `${TOTAL_ROWS} categories × ${CARDS_PER_ROW} cards = ${totalVirtual} virtual items. ` +
                    `Nested VirtualScrollers: vertical row scroller + horizontal card scrollers. ` +
                    `True dual-axis virtualization.`;
            }
            case 'vertical':
                return `${mode.count.toLocaleString()} items in a classic vertical list. Element pooling active — evicted chunk elements are patched in-place on re-entry instead of being rebuilt.`;
            case 'horizontal':
                return `${mode.count.toLocaleString()} cards in a single horizontal row. Uses display:contents for chunk transparency.`;
            case 'grid':
                return `${mode.count.toLocaleString()} cards in a CSS Grid (3-column). VirtualScroller handles row-based windowing.`;
            case 'stress':
                return `Throughput test: ${mode.count.toLocaleString()} rows, 0ms latency. DOM restricted to ${mode.max} active chunks. Element pooling active.`;
        }
    }

    _badgeFor(mode) {
        if (mode.id === 'streaming') {
            const total = (TOTAL_ROWS * CARDS_PER_ROW).toLocaleString();
            return `${total} virtual · ${mode.chunk} rows/chunk · ${H_CHUNK_SIZE} cards/chunk`;
        }
        return `${mode.count.toLocaleString()} items · ${mode.chunk}/chunk · ${mode.max} max`;
    }

    // ─── Render ──────────────────────────────────────────────────────────

    render() {
        const isStreaming = this._mode.id === 'streaming';

        return createElement('div', { className: 'suite-container' },

            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'VirtualScroller' }),
                createElement('p', {
                    className: 'suite-description',
                    textContent: 'Advanced viewport virtualization with support for multiple layout variants: Vertical, Horizontal, Grid, and Nested (Streaming).'
                })
            ),

            createElement('div', { className: 'sandbox-card vs-suite-card' },

                // Top bar: mode pills + live stats
                createElement('div', { className: 'vs-topbar' },
                    createElement('div', { className: 'vs-mode-pills' },
                        ...MODES.map(m =>
                            createElement('button', {
                                className: `vs-mode-pill ${m.id === this._mode.id ? 'active' : ''}`,
                                dataset: { vsMode: m.id },
                                textContent: `${m.icon} ${m.label}`
                            })
                        )
                    ),
                    createElement('div', { className: 'vs-stats' },
                        this._statBox('V-Chunks', 'statLoaded', '0'),
                        this._statBox('Visible', 'statVisible', '0'),
                        this._statBox('Evicted', 'statEvicted', '0'),
                        ...(isStreaming
                            ? [this._statBox('H-Chunks', 'statHLoaded', '0')]
                            : []
                        ),
                    )
                ),

                // Mode description
                createElement('div', { className: 'vs-mode-info' },
                    createElement('span', {
                        ref: this.ref('modeBadge'),
                        className: 'sandbox-label',
                        textContent: this._badgeFor(this._mode)
                    }),
                    createElement('p', {
                        ref: this.ref('modeDesc'),
                        className: 'vs-mode-desc',
                        textContent: this._descFor(this._mode)
                    }),
                    ...(isStreaming
                        ? [createElement('pre', {
                            ref: this.ref('debugTrace'),
                            className: 'vs-debug-trace',
                            style: {
                                maxHeight: '140px',
                                overflow: 'auto',
                                marginTop: '12px',
                                padding: '10px',
                                background: 'rgba(0,0,0,0.45)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '12px',
                                color: '#c7d2ff',
                                fontSize: '11px',
                                lineHeight: '1.35',
                                whiteSpace: 'pre-wrap'
                            },
                            textContent: ''
                        })]
                        : []
                    )
                ),

                // Viewport
                createElement('div', {
                    ref: this.ref('vsViewport'),
                    className: 'vs-viewport vs-viewport-vertical'
                })
            )
        );
    }

    _statBox(label, refName, initial) {
        return createElement('div', { className: 'vs-stat' },
            createElement('span', { className: 'vs-stat-value', ref: this.ref(refName), textContent: initial }),
            createElement('span', { className: 'vs-stat-label', textContent: label })
        );
    }
}
