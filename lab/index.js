/**
 * RAGOT Lab Entry Point
 * type="module" is inherently deferred — no raw DOMContentLoaded needed.
 */
import { createApp, $, clear } from '../index.js';
import { LabApp } from './LabApp.js';

// Clear the static loader before mounting
clear($('#ragot-lab-root'));

createApp(LabApp, '#ragot-lab-root', { activeSuite: 'morpher' }, 'ragotLab');
