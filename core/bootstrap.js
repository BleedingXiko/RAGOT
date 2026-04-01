// Copyright 2026 BleedingXIko
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * App Bootstrap
 */

import { Component } from './lifecycle.js';

/**
 * Mount a root Component into the DOM and expose it globally.
 * Replaces manual document.getElementById + new MyComponent().mount() boilerplate.
 *
 * @param {Function} ComponentClass - A class extending Component
 * @param {string|HTMLElement} container - Selector string or DOM element
 * @param {Object} [initialState={}]
 * @param {string} [globalName] - If provided, exposed as window[globalName]
 * @returns {Component} The mounted instance
 *
 * @example
 * const app = createApp(AppComponent, '#app', { theme: 'dark' }, 'myApp');
 */
export function createApp(ComponentClass, container, initialState = {}, globalName) {
    const root = typeof container === 'string' ? document.querySelector(container) : container;
    if (!root) {
        console.error(`[RAGOT] createApp: container not found — "${container}"`);
        return null;
    }
    const instance = new ComponentClass(initialState);
    instance.mount(root);
    if (globalName) window[globalName] = instance;
    return instance;
}
