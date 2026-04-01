/**
 * MorpherSuite — Tests morphDOM keyed reconciliation and reactive setState.
 *
 * MorpherSuite IS the correct use-case for setState + this.on(this.refs.X):
 *  - render() fully describes the UI from state
 *  - morphDOM patches it in-place on every setState
 *  - BUT: this.on(this.refs.X) registered in onStart() points to the OLD element
 *    after morphDOM replaces it. So we use delegate() on the root instead,
 *    which survives any morphDOM re-render.
 */
import { Component, createElement } from '../../index.js';

export class MorpherSuite extends Component {
    constructor(props) {
        // Pass initial state to super() — never overwrite this.state after construction.
        super({
            count: 0,
            items: [
                { id: '1', name: 'Alpha', color: '#f05454' },
                { id: '2', name: 'Beta', color: '#4caf50' },
                { id: '3', name: 'Gamma', color: '#2196f3' },
                { id: '4', name: 'Delta', color: '#ff9800' }
            ],
            isReverse: false,
            ...props,
        });
    }

    onStart() {
        // delegate() survives morphDOM re-renders because it's attached to the
        // stable root element, not to individual child nodes that may be replaced.
        this.delegate(this.element, 'click', '[data-action]', (e, target) => {
            const action = target.dataset.action;
            switch (action) {
                case 'increment':
                    this.setState({ count: this.state.count + 1 });
                    break;
                case 'decrement':
                    this.setState({ count: this.state.count - 1 });
                    break;
                case 'shuffle':
                    this.setState({
                        items: [...this.state.items].sort(() => Math.random() - 0.5)
                    });
                    break;
                case 'toggle-reverse':
                    this.setState({ isReverse: !this.state.isReverse });
                    break;
            }
        });
    }

    render() {
        const { count, items, isReverse } = this.state;
        const sortedItems = isReverse ? [...items].reverse() : items;

        return createElement('div', { className: 'suite-container' },
            createElement('header', { className: 'suite-header' },
                createElement('h1', { className: 'suite-title', textContent: 'DOM Morpher' }),
                createElement('p', { className: 'suite-description', textContent: 'morphDOM patches in-place on every setState. Keyed items preserve DOM identity across re-orders.' })
            ),

            createElement('div', { className: 'morpher-panels' },

                // --- Counter ---
                createElement('div', { className: 'sandbox-card' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Reactive Counter' }),
                    createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', padding: '20px 0' } },
                        createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } },
                            createElement('span', { textContent: 'Current count', style: { fontSize: '12px', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px' } }),
                            createElement('h2', {
                                style: { fontSize: '72px', color: count >= 0 ? 'var(--red)' : 'var(--blue)', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums', transition: 'color 0.2s' },
                                textContent: count
                            })
                        ),
                        createElement('div', { style: { display: 'flex', gap: '8px' } },
                            createElement('button', { dataset: { action: 'decrement' }, className: 'lab-btn lab-btn-outline', textContent: '−1' }),
                            createElement('button', { dataset: { action: 'increment' }, className: 'lab-btn', textContent: '+1' })
                        )
                    )
                ),

                // --- Keyed List ---
                createElement('div', { className: 'sandbox-card' },
                    createElement('span', { className: 'sandbox-label', textContent: 'Keyed Reconciliation' }),
                    createElement('p', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '16px', lineHeight: '1.5' }, textContent: 'Each item has data-ragot-key. Shuffle proves nodes are moved, not destroyed — inspect in DevTools.' }),
                    createElement('div', { className: 'lab-controls' },
                        createElement('button', { dataset: { action: 'shuffle' }, className: 'lab-btn', textContent: 'Shuffle Keys' }),
                        createElement('button', { dataset: { action: 'toggle-reverse' }, className: 'lab-btn lab-btn-outline', textContent: isReverse ? '↑ Original Order' : '↓ Reverse Order' })
                    ),
                    createElement('div', {
                        className: 'morph-list',
                        style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }
                    },
                        ...sortedItems.map(item =>
                            createElement('div', {
                                className: 'lab-nav-item',
                                dataset: { ragotKey: item.id },
                                style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    borderLeft: `4px solid ${item.color}`,
                                    backgroundColor: 'var(--bg)',
                                    padding: '14px 16px',
                                    borderRadius: '0 8px 8px 0',
                                    transition: 'border-left-color 0.3s'
                                }
                            },
                                createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
                                    createElement('div', { style: { width: '14px', height: '14px', borderRadius: '50%', backgroundColor: item.color, flexShrink: 0 } }),
                                    createElement('span', { textContent: item.name, style: { fontWeight: '600', fontSize: '17px' } })
                                ),
                                createElement('span', {
                                    className: 'vs-lab-index',
                                    textContent: `Key: ${item.id}`,
                                    style: { margin: 0 }
                                })
                            )
                        )
                    )
                )
            )
        );
    }
}
