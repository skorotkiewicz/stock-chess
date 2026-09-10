import assert from 'node:assert/strict';
import test from 'node:test';
import { getStockfishTarget } from '../scripts/download-stockfish.mjs';

test('getStockfishTarget resolves pinned targets with checksums', () => {
  const linuxX64 = getStockfishTarget('linux', 'x64');
  assert.ok(linuxX64);
  assert.equal(linuxX64.binName, 'stockfish-linux-x86-64-universal');
  assert.equal(linuxX64.sha256, '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f');

  const macos = getStockfishTarget('darwin', 'arm64');
  assert.ok(macos);
  assert.equal(macos.binName, 'stockfish-macos-universal');
  assert.equal(macos.sha256, 'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77');

  const winX64 = getStockfishTarget('win32', 'x64');
  assert.ok(winX64);
  assert.equal(winX64.binName, 'stockfish-windows-x86-64-universal.exe');
  assert.equal(winX64.sha256, '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7');

  assert.equal(getStockfishTarget('sunos', 'sparc'), null);
});
