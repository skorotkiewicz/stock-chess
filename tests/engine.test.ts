import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeFen, engine } from '../src/server/engine.ts';

test('canonicalizeFen validates and sanitizes input', () => {
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(canonicalizeFen(startFen), startFen);

  // Rejects non-string inputs
  assert.throws(() => canonicalizeFen(123), /Invalid or missing FEN/);
  assert.throws(() => canonicalizeFen(null), /Invalid or missing FEN/);
  assert.throws(() => canonicalizeFen(''), /Invalid or missing FEN/);

  // Rejects newline injection attempts
  assert.throws(() => canonicalizeFen(`${startFen}\nquit`), /newline/);
  assert.throws(() => canonicalizeFen(`${startFen}\r\nsetoption name MultiPV value 100`), /newline/);

  // Rejects invalid chess positions
  assert.throws(() => canonicalizeFen('invalid fen string'), /Invalid FEN notation/);
});

test('engine query respects AbortSignal while queued', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => engine.query('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { signal: controller.signal }),
    { name: 'AbortError' },
  );
});
