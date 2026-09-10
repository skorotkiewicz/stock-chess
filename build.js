import * as esbuild from 'esbuild';
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync, createWriteStream, chmodSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';

const STOCKFISH_URL = 'https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-linux-x86-64-universal.tar.gz';
const STOCKFISH_BIN = resolve('stockfish/stockfish-linux-x86-64-universal');

async function ensureStockfish() {
  const force = process.env.FORCE_STOCKFISH_DOWNLOAD === '1';

  if (!force && existsSync(STOCKFISH_BIN)) {
    console.log(`Stockfish binary verified at ${STOCKFISH_BIN}`);
    return;
  }

  console.log(`Downloading Stockfish from ${STOCKFISH_URL}...`);
  const response = await fetch(STOCKFISH_URL);
  if (!response.ok) {
    throw new Error(`Failed to download Stockfish: HTTP ${response.status} ${response.statusText}`);
  }

  const tempTar = resolve('temp-stockfish.tar.gz');
  const fileStream = createWriteStream(tempTar);
  await pipeline(Readable.fromWeb(response.body), fileStream);

  console.log('Extracting Stockfish archive...');
  execSync(`tar -xzf "${tempTar}"`, { stdio: 'inherit' });

  if (existsSync(STOCKFISH_BIN)) {
    chmodSync(STOCKFISH_BIN, 0o755);
    console.log(`Stockfish 19 ready at ${STOCKFISH_BIN}`);
  } else {
    throw new Error(`Stockfish binary not found after extraction at ${STOCKFISH_BIN}`);
  }

  try {
    unlinkSync(tempTar);
  } catch {
    // Ignore cleanup error if file was removed
  }
}

// 1. Ensure Stockfish binary is present
await ensureStockfish();

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
