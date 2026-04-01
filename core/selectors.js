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
 * Quick Selectors
 */

/**
 * Select a single element using querySelector.
 * @param {string} selector - CSS selector
 * @param {ParentNode} [parent=document] - Parent element to search within
 * @returns {Element|null}
 */
export const $ = (selector, parent = document) => parent.querySelector(selector);

/**
 * Select multiple elements using querySelectorAll.
 * @param {string} selector - CSS selector
 * @param {ParentNode} [parent=document] - Parent element to search within
 * @returns {Element[]}
 */
export const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
