import '../dist/ragot.min.js';

window.RAGOT.createElement('div', { textContent: 'typed global' });

const registryValue = window.ragotRegistry.provide('answer', 42, null, { replace: true });
registryValue.toFixed();

window.ragotModules.answer;
