import RAGOT from '../index.js';

const scope = typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
        ? window
        : typeof self !== 'undefined'
            ? self
            : this;

scope.RAGOT = RAGOT;
