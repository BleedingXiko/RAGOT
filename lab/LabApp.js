/**
 * LabApp — Root orchestrator for the RAGOT Lab.
 *
 * Suite switching via delegate() on [data-action="switch-suite"].
 * Each suite is mounted/unmounted properly so its full lifecycle runs.
 * On mobile: sidebar collapses to a horizontal scrolling nav strip.
 */
import { Component, createElement, clear, $, $$, append } from '../index.js';
import { VSSuite } from './suites/VSSuite.js';
import { MorpherSuite } from './suites/MorpherSuite.js';
import { GridSuite } from './suites/GridSuite.js';
import { ListSuite } from './suites/ListSuite.js';
import { LazyLoadSuite } from './suites/LazyLoadSuite.js';
import { ModuleSuite } from './suites/ModuleSuite.js';
import { BusSuite } from './suites/BusSuite.js';
import { AdoptSuite } from './suites/AdoptSuite.js';
import { TeardownSuite } from './suites/TeardownSuite.js';
import { StateStoreSuite } from './suites/StateStoreSuite.js';

const SUITES = [
    { id: 'morpher', label: 'morphDOM', group: 'Component', Ctor: MorpherSuite },
    { id: 'virtual-scroller', label: 'VirtualScroller', group: 'Component', Ctor: VSSuite },
    { id: 'grid', label: 'renderGrid', group: 'Component', Ctor: GridSuite },
    { id: 'list', label: 'renderList', group: 'Component', Ctor: ListSuite },
    { id: 'lazy-load', label: 'createLazyLoader', group: 'Component', Ctor: LazyLoadSuite },
    { id: 'module', label: 'Module', group: 'Module', Ctor: ModuleSuite },
    { id: 'bus', label: 'Event Bus', group: 'Module', Ctor: BusSuite },
    { id: 'adopt', label: 'adoptComponent', group: 'Module', Ctor: AdoptSuite },
    { id: 'teardown', label: 'Teardown', group: 'Module', Ctor: TeardownSuite },
    { id: 'state-store', label: 'StateStore', group: 'State', Ctor: StateStoreSuite },
];

export class LabApp extends Component {
    constructor(initialState = {}) {
        // _activeSuiteId is a plain instance property — NOT component state.
        // LabApp's shell (sidebar, nav, layout) is completely static after the
        // initial mount. Nothing here should ever trigger a morphDOM re-render,
        // because render() always returns an empty suiteContainer, and morphDOM
        // would wipe any imperatively-mounted suite inside it.
        super({});
        this._activeSuiteId = initialState.activeSuite || 'morpher';
        this._activeSuiteInstance = null;
    }

    onStart() {
        this.delegate(this.element, 'click', '[data-action="switch-suite"]', (e, target) => {
            const suiteId = target.dataset.suite;
            if (suiteId === this._activeSuiteId) return;
            this._switchSuite(suiteId);

            // Update active class on nav items imperatively — no setState needed.
            $$('[data-action="switch-suite"]', this.element).forEach(el => {
                el.classList.toggle('active', el.dataset.suite === suiteId);
            });
        });

        // Mount initial suite
        this._switchSuite(this._activeSuiteId);
    }

    _switchSuite(suiteId) {
        const container = this.refs.suiteContainer;
        if (!container) return;

        // Unmount previous suite
        if (this._activeSuiteInstance) {
            this._activeSuiteInstance.unmount();
            this._activeSuiteInstance = null;
        }

        clear(container);

        const entry = SUITES.find(s => s.id === suiteId);
        if (entry) {
            this._activeSuiteInstance = new entry.Ctor({});
            this._activeSuiteInstance.mount(container);
        } else {
            append(container,
                createElement('div', { className: 'suite-header', style: { padding: '40px 0' } },
                    createElement('h1', { className: 'suite-title', textContent: 'Coming Soon' }),
                    createElement('p', { className: 'suite-description', textContent: `The "${suiteId}" suite is under construction.` })
                )
            );
        }

        // Plain property update — intentionally NOT setState.
        // Any setState call here would trigger morphDOM on LabApp, which would
        // replace suiteContainer (always empty in render()) and destroy the suite.
        this._activeSuiteId = suiteId;
    }

    render() {
        // Called ONCE at mount. Never called again — no setState is ever triggered.
        // The nav active class and suite content are managed imperatively after this.
        const groups = [...new Set(SUITES.map(s => s.group))];
        const navChildren = [];
        for (const group of groups) {
            navChildren.push(
                createElement('div', { className: 'lab-nav-group-label', textContent: group })
            );
            const groupSuites = SUITES.filter(s => s.group === group);
            for (const s of groupSuites) {
                navChildren.push(
                    createElement('div', {
                        className: `lab-nav-item ${s.id === this._activeSuiteId ? 'active' : ''}`,
                        dataset: { action: 'switch-suite', suite: s.id },
                        textContent: s.label
                    })
                );
            }
        }

        return createElement('div', { className: 'lab-layout' },
            createElement('aside', { className: 'lab-sidebar' },
                createElement('div', { className: 'lab-logo-container' },
                    createElement('div', { className: 'lab-logo', textContent: 'RAGOT LAB' })
                ),
                createElement('nav', { className: 'lab-nav' },
                    ...navChildren
                )
            ),
            createElement('main', { className: 'lab-content' },
                createElement('div', { ref: this.ref('suiteContainer') })
            )
        );
    }
}
