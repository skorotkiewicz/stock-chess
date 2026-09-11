import { chmodSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STOCKFISH_VERSION = 'sf_19';
export const RELEASE_BASE_URL = `https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_VERSION}`;

export const TARGET_MAP = {
  'linux-x64': {
    archive: 'stockfish-linux-x86-64-universal.tar.gz',
    sha256: '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f',
    binName: 'stockfish-linux-x86-64-universal',
  },
  'linux-arm64': {
    archive: 'stockfish-linux-arm64-universal.tar.gz',
    sha256: 'fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01',
    binName: 'stockfish-linux-arm64-universal',
  },
  'darwin-arm64': {
    archive: 'stockfish-macos-universal.tar.gz',
    sha256: 'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77',
    binName: 'stockfish-macos-universal',
  },
  'darwin-x64': {
    archive: 'stockfish-macos-universal.tar.gz',
    sha256: 'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77',
    binName: 'stockfish-macos-universal',
  },
  'win32-x64': {
    archive: 'stockfish-windows-x86-64-universal.zip',
    sha256: '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7',
    binName: 'stockfish-windows-x86-64-universal.exe',
  },
  'win32-arm64': {
    archive: 'stockfish-windows-arm64-universal.zip',
    sha256: '8372ad3f0d7276deb2c70f801f541ec7db463219fc6d9c7592864e542aa4f401',
    binName: 'stockfish-windows-arm64-universal.exe',
  },
};

export function getStockfishTarget(platform = process.platform, arch = process.arch) {
  return TARGET_MAP[`${platform}-${arch}`] || null;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function downloadStockfish({ force = process.argv.includes('--force') } = {}) {
  const target = getStockfishTarget();
  if (!target) {
    console.warn(
      `No prebuilt Stockfish 19 binary configured for ${process.platform}-${process.arch}. ` +
      'Set STOCKFISH_PATH to point to a valid Stockfish binary.',
    );
    return;
  }

  const genericName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish';
  const targetBin = resolve('stockfish', target.binName);
  const genericBin = resolve('stockfish', genericName);
  if (!force && (isFile(targetBin) || isFile(genericBin))) {
    console.log(`Stockfish already present at ${isFile(targetBin) ? targetBin : genericBin}`);
    return;
  }

  const url = `${RELEASE_BASE_URL}/${target.archive}`;
  console.log(`Downloading Stockfish (${STOCKFISH_VERSION}) from ${url} ...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const checksum = createHash('sha256').update(data).digest('hex');
  if (checksum !== target.sha256) {
    throw new Error(
      `Checksum verification failed for ${target.archive}:\n` +
      `Expected: ${target.sha256}\nReceived: ${checksum}`,
    );
  }

  const archivePath = resolve('stockfish.archive.tmp');
  writeFileSync(archivePath, data);
  try {
    if (target.archive.endsWith('.tar.gz')) {
      execFileSync('tar', ['-xzf', archivePath, '-C', resolve('.')], { stdio: 'inherit' });
    } else if (process.platform === 'win32') {
      try {
        execFileSync('tar', ['-xf', archivePath, '-C', resolve('.')], { stdio: 'inherit' });
      } catch {
        execFileSync(
          'powershell',
          ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${resolve('.')}' -Force`],
          { stdio: 'inherit' },
        );
      }
    } else {
      execFileSync('unzip', ['-q', archivePath, '-d', resolve('.')], { stdio: 'inherit' });
    }

    if (!isFile(targetBin)) throw new Error(`${target.binName} not found inside downloaded archive`);
    if (process.platform !== 'win32') chmodSync(targetBin, 0o755);
    console.log(`Stockfish installed at ${targetBin}`);
  } finally {
    rmSync(archivePath, { force: true });
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  downloadStockfish().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
