import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const entryFile = path.join(rootDir, 'scripts', 'build-ragot-browser-entry.js');

const banner = `/*!
 * RAGOT
 * Browser bundle generated from index.js
 * Licensed under Apache-2.0
 */`;

const outputs = [
    {
        entryPoints: [entryFile],
        outfile: path.join(distDir, 'ragot.bundle.js'),
        format: 'iife',
        minify: false,
    },
    {
        entryPoints: [entryFile],
        outfile: path.join(distDir, 'ragot.min.js'),
        format: 'iife',
        minify: true,
    },
    {
        entryPoints: [path.join(rootDir, 'index.js')],
        outfile: path.join(distDir, 'ragot.esm.js'),
        format: 'esm',
        minify: false,
    },
    {
        entryPoints: [path.join(rootDir, 'index.js')],
        outfile: path.join(distDir, 'ragot.esm.min.js'),
        format: 'esm',
        minify: true,
    },
];

const sharedConfig = {
    bundle: true,
    platform: 'browser',
    target: ['es2018'],
    logLevel: 'info',
    legalComments: 'none',
    charset: 'utf8',
    banner: { js: banner },
};

await mkdir(distDir, { recursive: true });

for (const output of outputs) {
    await build({
        ...sharedConfig,
        entryPoints: output.entryPoints,
        outfile: output.outfile,
        format: output.format,
        minify: output.minify,
    });
}

console.log('Built browser bundles:');
for (const output of outputs) {
    console.log(`- ${path.relative(rootDir, output.outfile)}`);
}
