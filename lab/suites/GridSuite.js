/**
 * GridSuite — Tests renderGrid with keyed node pooling.
 *
 * Items and layout state live in private instance fields (_items, _cols),
 * not component state. renderGrid is imperative — it patches refs.gridRoot
 * directly. setState() would trigger morphDOM and destroy that subtree.
 *
 * All images are offline SVG data URIs — no network needed.
 */
import { Component, createElement, renderGrid, $ } from '../../index.js';
import { makePlaceholderSrc } from '../labUtils.js';

export class GridSuite extends Component {
    constructor(props) {
        super(props);
        this._items = Array.from({ length: 12 }, (_, i) => ({
            id: `item-${i}`,
            title: `Grid Cell ${i}`,
            index: i
        }));
        this._cols = 'auto-fill';
    }

    onStart() {
        this._renderMyGrid();

        this.on(this.refs.addBtn, 'click', () => {
            const i = this._items.length;
            this._items = [{
                id: `item-${Date.now()}`,
                title: `New Cell`,
                index: i
            }, ...this._items];
            this._renderMyGrid();
        });

        this.on(this.refs.shuffleBtn, 'click', () => {
            this._items = [...this._items].sort(() => Math.random() - 0.5);
            this._renderMyGrid();
        });

        this.on(this.refs.removeBtn, 'click', () => {
            if (this._items.length === 0) return;
            this._items = this._items.slice(1);
            this._renderMyGrid();
        });

        this.on(this.refs.colSelect, 'change', (e) => {
            this._cols = e.target.value;
            this._renderMyGrid();
        });
    }

    _renderMyGrid() {
        const cols = this._cols;
        renderGrid(
            this.refs.gridRoot,
            this._items,
            (item) => item.id,
            (item) => createElement('div', { className: 'lab-card', style: { padding: '0', overflow: 'hidden' } },
                createElement('div', { className: 'lazy-image-wrapper' },
                    createElement('img', {
                        src: makePlaceholderSrc(item.index, `#${item.index}`, 300, 170),
                        alt: item.title,
                        className: 'lazy-image loaded',
                        style: { width: '100%', height: '100%', objectFit: 'cover' }
                    })
                ),
                createElement('div', { style: { padding: '14px' } },
                    createElement('div', { className: 'lab-card-title', textContent: item.title }),
                    createElement('div', { className: 'lab-card-meta', style: { marginTop: '4px' }, textContent: `Key: ${item.id}` })
                )
            ),
            (el, item) => {
                const titleEl = $('.lab-card-title', el);
                if (titleEl && titleEl.textContent !== item.title) titleEl.textContent = item.title;
            },
            {
                poolKey: 'lab-grid-cards',
                columns: cols === 'auto-fill' ? undefined : parseInt(cols, 10),
                columnWidth: cols === 'auto-fill' ? '160px' : undefined,
                gap: '14px'
            }
        );
    }

    render() {
        return createElement('div', { className: 'suite-container' },
            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'renderGrid' }),
                createElement('p', { className: 'suite-description', textContent: 'Keyed grid reconciliation with node pooling. Nodes are reused from a pool — not destroyed on shuffle or insert. All images are offline SVG data URIs.' })
            ),

            createElement('div', { className: 'sandbox-card' },
                createElement('div', { className: 'sandbox-header' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Grid Controls' }),
                    createElement('div', { className: 'grid-controls-row' },
                        createElement('label', { textContent: 'Columns:', style: { fontSize: '12px', color: 'var(--text-2)' } }),
                        createElement('select', {
                            ref: this.ref('colSelect'),
                            className: 'grid-col-select'
                        },
                            createElement('option', { value: 'auto-fill', textContent: 'Auto-fill' }),
                            createElement('option', { value: '2', textContent: '2 Cols' }),
                            createElement('option', { value: '3', textContent: '3 Cols' }),
                            createElement('option', { value: '4', textContent: '4 Cols' }),
                            createElement('option', { value: '6', textContent: '6 Cols' })
                        )
                    )
                ),
                createElement('div', { className: 'lab-controls', style: { paddingBottom: '20px', borderBottom: '1px solid var(--border)', marginBottom: '24px' } },
                    createElement('button', { ref: this.ref('addBtn'), className: 'lab-btn', textContent: 'Insert Node' }),
                    createElement('button', { ref: this.ref('shuffleBtn'), className: 'lab-btn lab-btn-outline', textContent: 'Shuffle Keys' }),
                    createElement('button', { ref: this.ref('removeBtn'), className: 'lab-btn lab-btn-outline', textContent: 'Pop First' })
                ),
                createElement('div', { ref: this.ref('gridRoot') })
            )
        );
    }
}
