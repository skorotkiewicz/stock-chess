// Downloads the Stockfish binary into stockfish/ if it is missing.
// Runs on `npm run stockfish` (and via postinstall).
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const STOCKFISH_URL =
  'https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-linux-x86-64-universal.tar.gz';
const STOCKFISH_BIN = resolve('stockfish/stockfish-linux-x86-64-universal');

if (existsSync(STOCKFISH_BIN)) {
  console.log(`Stockfish already present at ${STOCKFISH_BIN}`);
  process.exit(0);
}

console.log(`Downloading Stockfish from ${STOCKFISH_URL} ...`);
const res = await fetch(STOCKFISH_URL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const tarball = resolve('stockfish.tar.gz.tmp');
writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));

const tmp = resolve('stockfish.tmp');
mkdirSync(tmp, { recursive: true });
try {
  execFileSync('tar', ['-xzf', tarball, '-C', tmp], { stdio: 'inherit' });

  const findBinary = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findBinary(full);
        if (found) return found;
      } else if (entry.name === 'stockfish-linux-x86-64-universal') {
        return full;
      }
    }
    return null;
  };
  const binary = findBinary(tmp);
  if (!binary) throw new Error('stockfish-linux-x86-64-universal not found inside the archive');

  mkdirSync(resolve('stockfish'), { recursive: true });
  try {
    renameSync(binary, STOCKFISH_BIN);
  } catch {
    copyFileSync(binary, STOCKFISH_BIN); // cross-filesystem fallback
  }
  chmodSync(STOCKFISH_BIN, 0o755);
  console.log(`Stockfish installed at ${STOCKFISH_BIN}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(tarball, { force: true });
}
