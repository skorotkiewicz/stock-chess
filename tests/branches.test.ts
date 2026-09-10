import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { BranchState, parseVariationPgn } from '../src/lib/branches.ts';

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

test('parseVariationPgn and toPgn preserve alternatives on correct ply', () => {
  const pgn1 = '1. e4 e5 (1... c5) 2. Nf3 *';
  const parsed1 = parseVariationPgn(pgn1);
  assert.ok(parsed1);
  assert.equal(parsed1.items.length, 2);
  assert.equal(parsed1.items[1].forkPly, 1);
  assert.deepEqual(parsed1.items[1].moves, ['e2e4', 'c7c5']);
  assert.match(parsed1.toPgn(), /1\. e4 e5 \(1\.\.\. c5\) 2\. Nf3 \*/);

  const pgn2 = '1. e4 (1. d4 d5) e5 *';
  const parsed2 = parseVariationPgn(pgn2);
  assert.ok(parsed2);
  assert.equal(parsed2.items.length, 2);
  assert.equal(parsed2.items[1].forkPly, 0);
  assert.deepEqual(parsed2.items[1].moves, ['d2d4', 'd7d5']);
  assert.match(parsed2.toPgn(), /1\. e4 \(1\. d4 d5\) e5 \*/);

  // Interactive variation creation
  const live = new BranchState(new Chess().fen(), ['e2e4', 'e7e5', 'g1f3']);
  live.view(1);
  live.append('c7c5');
  assert.match(live.toPgn(), /1\. e4 e5 \(1\.\.\. c5\) 2\. Nf3 \*/);
});
