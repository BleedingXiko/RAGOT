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
 * Global Event Bus (Pub / Sub)
 */

/**
 * Global Event Bus for decoupled component communication.
 */
class EventBus {
    constructor() {
        this.events = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event - Event name
     * @param {Function} callback - Function to call when event is emitted
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event - Event name
     * @param {Function} callback - Function to remove
     */
    off(event, callback) {
        if (this.events.has(event)) {
            this.events.get(event).delete(callback);
            if (this.events.get(event).size === 0) {
                this.events.delete(event);
            }
        }
    }

    /**
     * Emit an event with data.
     * @param {string} event - Event name
     * @param {any} [data] - Data to pass to listeners
     */
    emit(event, data) {
        if (this.events.has(event)) {
            for (const callback of this.events.get(event)) {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`[EventBus] Error in listener for ${event}:`, e);
                }
            }
        }
    }

    /**
     * Subscribe to an event exactly once — auto-unsubscribes after first call.
     * @param {string} event - Event name
     * @param {Function} callback - Function to call once
     * @returns {Function} Unsubscribe function (no-op after first call)
     */
    once(event, callback) {
        const wrapper = (data) => {
            this.off(event, wrapper);
            callback(data);
        };
        return this.on(event, wrapper);
    }

    /**
     * Clear all listeners for an event (or all events).
     * @param {string} [event] - Event name to clear. If omitted, clears all events.
     */
    clear(event) {
        if (event) {
            this.events.delete(event);
        } else {
            this.events.clear();
        }
    }
}

export const bus = new EventBus();

export function shouldWarnMissingTarget() {
    try {
        return typeof window !== 'undefined' && window.__RAGOT_WARN_MISSING_TARGET__ === true;
    } catch (e) {
        return false;
    }
}
