import * as esbuild from 'esbuild';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (!existsSync('public')) {
  mkdirSync('public', { recursive: true });
}

await esbuild.build({
  entryPoints: ['src/app.js'],
  bundle: true,
  outfile: 'public/bundle.js',
  format: 'esm',
  minify: true,
  sourcemap: true,
});

await esbuild.build({
  entryPoints: ['src/style.css'],
  bundle: true,
  outfile: 'public/style.css',
  minify: true,
});

console.log('Build completed: public/bundle.js and public/style.css generated.');
