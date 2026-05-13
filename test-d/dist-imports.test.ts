import RAGOT, {
    Component,
    Module,
    createElement,
    createStateStore,
} from '../dist/ragot.esm.min.js';

class Panel extends Component<{ title: string }> {
    render() {
        return createElement('section', { textContent: this.state.title });
    }
}

class Worker extends Module<{ active: boolean }> {}

const panel = new Panel({ title: 'Hello' });
panel.setState({ title: 'World' });

const worker = new Worker({ active: false });
worker.setState({ active: true });

const store = createStateStore({ enabled: true });
store.subscribe((enabled) => {
    enabled.valueOf();
}, { selector: (state) => state.enabled });

RAGOT.createElement('div', { textContent: 'typed' });
