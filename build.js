import * as esbuild from 'esbuild';
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { downloadStockfish } from './scripts/download-stockfish.mjs';

// 1. Ensure the pinned Stockfish binary for this platform is present.
await downloadStockfish({ force: process.env.FORCE_STOCKFISH_DOWNLOAD === '1' });

// 2. Prepare public directory and copy HTML template
if (!existsSync('public')) {
  mkdirSync('public', { recursive: true });
}
copyFileSync('src/index.html', 'public/index.html');
// Cache-bust asset URLs so browsers never reuse a stale bundle
const cacheBust = Date.now();
let indexHtml = readFileSync('public/index.html', 'utf8');
indexHtml = indexHtml
  .replace('/style.css', `/style.css?v=${cacheBust}`)
  .replace('/bundle.js', `/bundle.js?v=${cacheBust}`);
writeFileSync('public/index.html', indexHtml);

// 3. Build JS bundle
await esbuild.build({
  entryPoints: ['src/app.js'],
  bundle: true,
  outfile: 'public/bundle.js',
  format: 'esm',
  minify: true,
  sourcemap: true,
});

// 4. Build CSS bundle
await esbuild.build({
  entryPoints: ['src/style.css'],
  bundle: true,
  outfile: 'public/style.css',
  minify: true,
});

console.log('Build completed: Stockfish verified, bundles generated in public/.');
