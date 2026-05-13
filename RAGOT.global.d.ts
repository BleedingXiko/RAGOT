declare global {
    interface Window {
        RAGOT: import('./RAGOT.js').RAGOTNamespace;
        ragotRegistry: import('./RAGOT.js').RAGOTRegistry;
        ragotModules: import('./RAGOT.js').RAGOTModules;
        __RAGOT_ALLOW_DIRECT_MUTATION__?: boolean;
        __RAGOT_WARN_MISSING_TARGET__?: boolean;
    }

    var RAGOT: import('./RAGOT.js').RAGOTNamespace;
    var ragotRegistry: import('./RAGOT.js').RAGOTRegistry;
    var ragotModules: import('./RAGOT.js').RAGOTModules;
}

export {};
