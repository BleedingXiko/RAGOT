import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const entryFile = path.join(rootDir, 'scripts', 'build-ragot-browser-entry.js');
const esmTypesFile = path.join(rootDir, 'RAGOT.d.ts');
const globalTypesFile = path.join(rootDir, 'RAGOT.global.d.ts');

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

const esmTypeOutputs = ['ragot.esm.d.ts', 'ragot.esm.min.d.ts'];
const globalTypeOutputs = ['ragot.bundle.d.ts', 'ragot.min.d.ts'];

for (const fileName of esmTypeOutputs) {
    await copyFile(esmTypesFile, path.join(distDir, fileName));
}

const globalTypes = await readFile(globalTypesFile, 'utf8');
const distGlobalTypes = globalTypes.replaceAll("'./RAGOT.js'", "'./ragot.esm.js'");
for (const fileName of globalTypeOutputs) {
    await writeFile(path.join(distDir, fileName), distGlobalTypes);
}

const typeOutputs = [...esmTypeOutputs, ...globalTypeOutputs];

console.log('Built browser bundles:');
for (const output of outputs) {
    console.log(`- ${path.relative(rootDir, output.outfile)}`);
}
for (const fileName of typeOutputs) {
    console.log(`- ${path.join('dist', fileName)}`);
}
