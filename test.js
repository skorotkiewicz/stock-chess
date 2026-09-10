import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { buildEditorFen } from './src/editor-position.js';

console.log('--- Running Chess App Verification Tests ---');

const homePieces = new Map([
  ['e1', { color: 'white', role: 'king' }],
  ['a1', { color: 'white', role: 'rook' }],
  ['h1', { color: 'white', role: 'rook' }],
  ['e8', { color: 'black', role: 'king' }],
  ['a8', { color: 'black', role: 'rook' }],
  ['h8', { color: 'black', role: 'rook' }],
]);
const placement = 'r3k2r/8/8/8/8/8/8/R3K2R';
assert.strictEqual(
  buildEditorFen(placement, 'b', 'KQkq', homePieces),
  `${placement} b KQkq - 0 1`,
  'Editor should preserve side to move and supported castling rights',
);
assert.strictEqual(
  buildEditorFen(placement, 'w', '-', homePieces),
  `${placement} w - - 0 1`,
  'Editor should not invent lost castling rights',
);
homePieces.delete('h1');
assert.strictEqual(
  buildEditorFen(placement, 'w', 'KQkq', homePieces),
  `${placement} w Qkq - 0 1`,
  'Editor should remove castling rights without the required rook',
);
console.log('✓ Board editor FEN metadata verified');

// 1. Verify build artifacts
assert(existsSync('public/bundle.js'), 'public/bundle.js must exist');
assert(statSync('public/bundle.js').size > 10000, 'public/bundle.js must not be empty');
assert(existsSync('public/style.css'), 'public/style.css must exist');
assert(statSync('public/style.css').size > 5000, 'public/style.css must not be empty');
assert(existsSync('stockfish/stockfish-linux-x86-64-universal'), 'Stockfish binary must exist');
assert(statSync('stockfish/stockfish-linux-x86-64-universal').size > 1000000, 'Stockfish binary must be valid');
console.log('✓ Build artifacts and Stockfish binary verified');

// 2. Start server on test port 3456
const TEST_PORT = 3456;
const serverProcess = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(TEST_PORT) },
  stdio: ['pipe', 'pipe', 'inherit'],
});

function cleanup() {
  serverProcess.kill();
}

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Wait for server to be ready
await new Promise((resolve) => setTimeout(resolve, 800));

try {
  // 3. Test static assets
  const htmlRes = await fetch(`http://localhost:${TEST_PORT}/`);
  assert.strictEqual(htmlRes.status, 200, 'Index HTML should return 200');
  const htmlText = await htmlRes.text();
  assert(htmlText.includes('Stockfish 19 Chess'), 'Index HTML should contain title');
  console.log('✓ Static HTML served correctly');

  const jsRes = await fetch(`http://localhost:${TEST_PORT}/bundle.js`);
  assert.strictEqual(jsRes.status, 200, 'bundle.js should return 200');
  console.log('✓ Client JS bundle served correctly');

  const cssRes = await fetch(`http://localhost:${TEST_PORT}/style.css`);
  assert.strictEqual(cssRes.status, 200, 'style.css should return 200');
  console.log('✓ CSS stylesheet served correctly');

  // 4. Test Stockfish Health
  const healthRes = await fetch(`http://localhost:${TEST_PORT}/api/stockfish/health`);
  assert.strictEqual(healthRes.status, 200, 'Health check should return 200');
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, 'ok', 'Health status should be ok');
  assert.strictEqual(healthData.engine, 'Stockfish 19', 'Engine should be Stockfish 19');
  console.log('✓ Stockfish 19 health check passed');

  // 5. Test Stockfish error reporting and recovery
  const unsupportedFen = 'rQbqkbnr/pppppppp/8/8/8/8/PPPPPPqP/RNBQKBNR w KQkq - 0 1';
  const errorRes = await fetch(`http://localhost:${TEST_PORT}/api/stockfish/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: unsupportedFen, level: 1 }),
  });
  assert.strictEqual(errorRes.status, 500, 'Unsupported position should return 500');
  const errorData = await errorRes.json();
  assert.strictEqual(
    errorData.error,
    'Unsupported position. Too many pieces for BLACK.',
    'API should return Stockfish error details',
  );
  console.log('✓ Stockfish error reporting passed');

  // 6. Test Stockfish Move generation for White (Level 1) and Black (Level 5)
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const moveRes1 = await fetch(`http://localhost:${TEST_PORT}/api/stockfish/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: startFen, level: 1 }),
  });
  assert.strictEqual(moveRes1.status, 200, 'Move API should return 200');
  const moveData1 = await moveRes1.json();
  assert(typeof moveData1.bestmove === 'string' && moveData1.bestmove.length >= 4, 'bestmove should be UCI notation');
  console.log(`✓ Stockfish 19 White (Lv 1) move passed: ${moveData1.bestmove}`);

  const blackTurnFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const moveRes2 = await fetch(`http://localhost:${TEST_PORT}/api/stockfish/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: blackTurnFen, level: 5 }),
  });
  assert.strictEqual(moveRes2.status, 200, 'Move API should return 200');
  const moveData2 = await moveRes2.json();
  assert(typeof moveData2.bestmove === 'string' && moveData2.bestmove.length >= 4, 'bestmove should be UCI notation');
  console.log(`✓ Stockfish 19 Black (Lv 5) move passed: ${moveData2.bestmove}`);

  // 7. Test FEN and PGN parsing
  const { Chess } = await import('chess.js');
  const testChess = new Chess();
  testChess.move('e4');
  testChess.move('e5');
  const exportedPgn = testChess.pgn();
  const exportedFen = testChess.fen();

  const importedPgnChess = new Chess();
  importedPgnChess.loadPgn(exportedPgn);
  assert.strictEqual(importedPgnChess.history().length, 2, 'PGN import should reconstruct move history');

  const importedFenChess = new Chess();
  importedFenChess.load(exportedFen);
  assert.strictEqual(importedFenChess.fen(), exportedFen, 'FEN import should match exported FEN');
  console.log('✓ PGN and FEN import/export logic verified');

  // 8. Test Stockfish Eval
  const evalRes = await fetch(`http://localhost:${TEST_PORT}/api/stockfish/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: startFen }),
  });
  assert.strictEqual(evalRes.status, 200, 'Eval API should return 200');
  const evalData = await evalRes.json();
  assert(evalData.eval && typeof evalData.eval.value === 'number', 'eval should return numeric value');
  console.log(`✓ Stockfish 19 eval passed (eval: ${evalData.eval.type} ${evalData.eval.value})`);

  console.log('\n--- All tests passed successfully! ---');
  process.exit(0);
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
} finally {
  cleanup();
}
