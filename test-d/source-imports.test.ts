import RAGOT, {
    Component,
    Module,
    VirtualScroller,
    createElement,
    createStateStore,
    ragotRegistry,
} from '../index.js';

class CounterView extends Component<{ count: number }> {
    render() {
        return createElement('button', {
            textContent: `Count: ${this.state.count}`,
            onClick: () => this.setState({ count: this.state.count + 1 }),
        });
    }
}

class CounterModule extends Module<{ ready: boolean; count: number }> {
    onStart() {
        this.subscribe((count) => {
            count.toFixed();
        }, { selector: (state) => state.count, immediate: true });
    }
}

const view = new CounterView({ count: 0 });
view.setState({ count: 1 });

const module = new CounterModule({ ready: false, count: 0 });
module.batchState((state) => {
    state.ready = true;
});

const store = createStateStore({ count: 0, label: 'demo' }, { name: 'counter' });
store.set('count', 1);
store.subscribe((label) => {
    label.toUpperCase();
}, { selector: (state) => state.label });

const el = createElement('div', {
    className: ['counter', 'active'],
    dataset: { count: store.getState().count },
}, createElement('span', { textContent: store.getState().label }));

ragotRegistry.provide('counterStore', store, module, { replace: true });
const resolved = ragotRegistry.require<typeof store>('counterStore');
resolved.getState().count.toFixed();

new VirtualScroller({
    chunkSize: 20,
    totalItems: () => 100,
    renderChunk: (i) => createElement('section', { dataset: { index: i } }),
}).getVisibleChunks();

RAGOT.append(el, 'ok');
