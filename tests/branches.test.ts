import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { BranchState } from '../src/lib/branches.ts';

test('PGN export includes termination and custom-position headers', () => {
  const game = new BranchState(new Chess().fen(), ['e2e4']);
  assert.match(game.toPgn(), /\n\n1\. e4 \*$/);

  const fen = '8/8/8/8/8/8/4K3/6k1 w - - 0 1';
  const position = new BranchState(fen);
  const pgn = position.toPgn();
  assert.match(pgn, /\[SetUp "1"\]/);
  assert.match(pgn, new RegExp(`\\[FEN "${fen}"\\]`));
  assert.match(pgn, /\n\n\*$/);
});
