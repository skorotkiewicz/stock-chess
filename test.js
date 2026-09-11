import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { buildEditorFen } from './src/editor-position.js';
import { classifyMove, formatAnalysisScore, formatWhiteWdl, uciLineToSan } from './src/analysis.js';
import { BranchState, parseVariationPgn } from './src/branches.js';
import { getStockfishTarget } from './scripts/download-stockfish.mjs';

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

assert.strictEqual(formatAnalysisScore({ type: 'cp', value: 28 }, 'b'), '-0.28');
assert.strictEqual(formatAnalysisScore({ type: 'mate', value: -3 }, 'b'), '+M3');
assert.strictEqual(formatWhiteWdl(null, 'b'), 'White W/D/L: unavailable');
assert.strictEqual(
  formatWhiteWdl({ win: 100, draw: 400, loss: 500 }, 'b'),
  'White W/D/L: 50.0% / 40.0% / 10.0%',
);
assert.deepStrictEqual(
  uciLineToSan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['g1f3', 'b8c6']),
  ['Nf3', 'Nc6'],
);
const beforeMove = {
  turn: 'w',
  bestmove: 'd2d4',
  analysis: { wdl: { win: 500, draw: 400, loss: 100 } },
};
const afterMistake = {
  turn: 'b',
  analysis: { wdl: { win: 250, draw: 400, loss: 350 } },
};
assert.strictEqual(classifyMove(beforeMove, afterMistake, 'd2d4'), 'Best');
assert.strictEqual(classifyMove(beforeMove, afterMistake, 'e2e4'), 'Mistake');
console.log('✓ Analysis formatting and move classification verified');

const branches = new BranchState('start', ['e2e4', 'e7e5']);
branches.active.analysis.set(1, 'cached');
branches.view(1);
const variation = branches.append('c7c5');
assert.strictEqual(variation.created, true, 'Moving from history should create a branch');
assert.strictEqual(branches.active.name, 'Variation 1');
assert.deepStrictEqual(branches.active.moves, ['e2e4', 'c7c5']);
assert.strictEqual(branches.active.analysis.get(1), 'cached', 'A branch should retain prefix analysis');
branches.select('main');
assert.deepStrictEqual(branches.active.moves, ['e2e4', 'e7e5'], 'Main branch should remain unchanged');
assert.strictEqual(branches.viewedPly, 2, 'Selecting a branch should jump to its tip');
branches.select(variation.branch.id);
assert.strictEqual(branches.viewedPly, 2, 'Selecting a variation should jump to its tip');
branches.active.analysis.set(2, 'discarded');
branches.takeback(1);
assert.deepStrictEqual(branches.active.moves, ['e2e4'], 'Takeback should affect only the active branch');
assert.strictEqual(branches.active.analysis.has(2), false, 'Takeback should discard later analysis');
branches.select('main');
assert.deepStrictEqual(branches.active.moves, ['e2e4', 'e7e5'], 'Takeback should preserve sibling branches');

const parsedBranches = parseVariationPgn('1. e4 e5 (1... c5) 2. Nf3 *');
assert(parsedBranches, 'Variation PGN should parse');
assert.strictEqual(parsedBranches.items[1].forkPly, 1, 'Black variation should attach after White move');
assert.deepStrictEqual(parsedBranches.items[1].moves, ['e2e4', 'c7c5']);
assert.match(parsedBranches.toPgn(), /1\. e4 e5 \(1\.\.\. c5\) 2\. Nf3 \*$/);
assert.strictEqual(
  parseVariationPgn('1. e4 definitely-not-a-move *'),
  null,
  'Invalid PGN must not be silently truncated',
);

const customFen = '8/8/8/8/8/8/4K3/6k1 w - - 0 1';
const customPosition = new BranchState(customFen);
assert.match(customPosition.toPgn(), /\[SetUp "1"\]/);
assert.match(customPosition.toPgn(), new RegExp(`\\[FEN "${customFen}"\\]`));
assert.match(customPosition.toPgn(), /\n\n\*$/);
const blackToMove = new BranchState('8/8/8/8/8/8/4K3/6k1 b - - 0 12', ['g1g2']);
assert.match(blackToMove.toPgn(), /\n\n12\.\.\. Kg2 \*$/);
const escapedHeaders = parseVariationPgn(String.raw`[Event "A\"B\\C"]

1. e4 *`);
assert.strictEqual(escapedHeaders.headers.Event, 'A"B\\C');
assert(escapedHeaders.toPgn().includes(String.raw`[Event "A\"B\\C"]`));
const pgnPath = existsSync('assets/pgn.md') ? 'assets/pgn.md' : 'pgn.md';
const pgnExamples = [...readFileSync(pgnPath, 'utf8').matchAll(/```pgn\n([\s\S]*?)```/g)];
const branchExample = parseVariationPgn(pgnExamples.at(-1)[1]);
assert.strictEqual(branchExample.items.length, 4, 'Bundled branch example should contain four branches');
assert.strictEqual(parseVariationPgn(branchExample.toPgn()).items.length, 4, 'Bundled branches should round-trip');
console.log('✓ Move history branches and variation PGN verified');

const linuxTarget = getStockfishTarget('linux', 'x64');
assert.strictEqual(linuxTarget.binName, 'stockfish-linux-x86-64-universal');
assert.strictEqual(linuxTarget.sha256, '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f');
assert.strictEqual(getStockfishTarget('sunos', 'sparc'), null);
console.log('✓ Pinned Stockfish download targets verified');

// 1. Verify build artifacts
assert(existsSync('public/bundle.js'), 'public/bundle.js must exist');
assert(statSync('public/bundle.js').size > 10000, 'public/bundle.js must not be empty');
assert(existsSync('public/style.css'), 'public/style.css must exist');
assert(statSync('public/style.css').size > 5000, 'public/style.css must not be empty');
const currentTarget = getStockfishTarget();
const genericBinary = process.platform === 'win32' ? 'stockfish/stockfish.exe' : 'stockfish/stockfish';
const stockfishBinary = [
  process.env.STOCKFISH_PATH,
  currentTarget && `stockfish/${currentTarget.binName}`,
  genericBinary,
].filter(Boolean).find(existsSync);
assert(stockfishBinary, `Stockfish binary must exist for ${process.platform}-${process.arch}`);
assert(statSync(stockfishBinary).size > 1000000, 'Stockfish binary must be valid');
console.log('✓ Build artifacts and Stockfish binary verified');

// 2. Start server on an available local port
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const serverProcess = spawn('node', ['server.js'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

function cleanup() {
  serverProcess.kill();
}

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const TEST_PORT = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server did not start')), 10000);
  serverProcess.once('error', reject);
  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stdout.on('data', (output) => {
    const match = output.match(/127\.0\.0\.1:(\d+)/);
    if (!match) return;
    clearTimeout(timeout);
    resolve(Number(match[1]));
  });
});
const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

for (let attempts = 0; attempts < 100; attempts += 1) {
  const response = await fetch(`${baseUrl}/api/stockfish/health`).catch(() => null);
  if (response?.ok) break;
  if (attempts === 99) throw new Error('Stockfish did not become ready');
  await new Promise((resolve) => setTimeout(resolve, 100));
}

try {
  // 3. Test static assets
  const htmlRes = await fetch(`${baseUrl}/`);
  assert.strictEqual(htmlRes.status, 200, 'Index HTML should return 200');
  const htmlText = await htmlRes.text();
  assert(htmlText.includes('Stockfish 19 Chess'), 'Index HTML should contain title');
  assert(htmlText.includes('id="analysisPanel"'), 'Index HTML should contain analysis panel');
  assert(htmlText.includes('id="branchSelect"'), 'Index HTML should contain branch selector');
  console.log('✓ Static HTML served correctly');

  const jsRes = await fetch(`${baseUrl}/bundle.js`);
  assert.strictEqual(jsRes.status, 200, 'bundle.js should return 200');
  console.log('✓ Client JS bundle served correctly');

  const cssRes = await fetch(`${baseUrl}/style.css`);
  assert.strictEqual(cssRes.status, 200, 'style.css should return 200');
  console.log('✓ CSS stylesheet served correctly');

  const favRes = await fetch(`${baseUrl}/favicon.svg`);
  assert.strictEqual(favRes.status, 200, 'favicon.svg should return 200');
  console.log('✓ Favicon served correctly');

  const malformedHostResponse = await new Promise((resolve, reject) => {
    const socket = createConnection(TEST_PORT, '127.0.0.1');
    let response = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write('GET / HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n'));
    socket.on('data', (chunk) => { response += chunk; });
    socket.on('error', reject);
    socket.on('close', () => resolve(response));
  });
  assert.match(malformedHostResponse, /^HTTP\/1\.1 200 /, 'Malformed Host header must not crash the server');
  console.log('✓ Malformed Host header handled safely');

  // 4. Test Stockfish Health
  const healthRes = await fetch(`${baseUrl}/api/stockfish/health`);
  assert.strictEqual(healthRes.status, 200, 'Health check should return 200');
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, 'ok', 'Health status should be ok');
  assert.strictEqual(healthData.engine, 'Stockfish 19', 'Engine should be Stockfish 19');
  console.log('✓ Stockfish 19 health check passed');

  // 5. Test Stockfish error reporting and recovery
  const unsupportedFen = 'rQbqkbnr/pppppppp/8/8/8/8/PPPPPPqP/RNBQKBNR w KQkq - 0 1';
  const errorRes = await fetch(`${baseUrl}/api/stockfish/move`, {
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

  const injectedFenRes = await fetch(`${baseUrl}/api/stockfish/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: `${START_FEN}\nquit`, level: 1 }),
  });
  assert.strictEqual(injectedFenRes.status, 400, 'FEN command injection should return 400');
  assert.match((await injectedFenRes.json()).error, /newline/);
  console.log('✓ FEN input validation passed');

  const oversizedRes = await fetch(`${baseUrl}/api/stockfish/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: 'x'.repeat(1_000_001) }),
  });
  assert.strictEqual(oversizedRes.status, 413, 'Oversized payload should return 413');
  assert.strictEqual((await oversizedRes.json()).error, 'Payload too large');
  console.log('✓ Oversized payload rejected with HTTP 413');

  // 6. Test Stockfish Move generation for White (Level 1) and Black (Level 5)
  const startFen = START_FEN;
  const moveRes1 = await fetch(`${baseUrl}/api/stockfish/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: startFen, level: 1 }),
  });
  assert.strictEqual(moveRes1.status, 200, 'Move API should return 200');
  const moveData1 = await moveRes1.json();
  assert(typeof moveData1.bestmove === 'string' && moveData1.bestmove.length >= 4, 'bestmove should be UCI notation');
  console.log(`✓ Stockfish 19 White (Lv 1) move passed: ${moveData1.bestmove}`);

  const blackTurnFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const moveRes2 = await fetch(`${baseUrl}/api/stockfish/move`, {
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
  const evalRes = await fetch(`${baseUrl}/api/stockfish/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: startFen }),
  });
  assert.strictEqual(evalRes.status, 200, 'Eval API should return 200');
  const evalData = await evalRes.json();
  assert(evalData.eval && typeof evalData.eval.value === 'number', 'eval should return numeric value');
  assert.strictEqual(evalData.lines.length, 3, 'Eval should return three candidate lines');
  assert(evalData.analysis.depth > 0, 'Analysis should include search depth');
  assert(evalData.analysis.seldepth > 0, 'Analysis should include selective depth');
  assert(evalData.analysis.nodes > 0, 'Analysis should include searched nodes');
  assert(evalData.analysis.nps > 0, 'Analysis should include nodes per second');
  assert(typeof evalData.analysis.hashfull === 'number', 'Analysis should include hash usage');
  assert(evalData.analysis.time > 0, 'Analysis should include elapsed time');
  assert(Array.isArray(evalData.analysis.pv) && evalData.analysis.pv.length > 0, 'Analysis should include a PV');
  assert.strictEqual(
    evalData.analysis.wdl.win + evalData.analysis.wdl.draw + evalData.analysis.wdl.loss,
    1000,
    'WDL values should total 1000',
  );
  console.log(`✓ Stockfish 19 analysis passed (${evalData.lines.length} lines, depth ${evalData.analysis.depth})`);

  console.log('\n--- All tests passed successfully! ---');
  process.exit(0);
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
} finally {
  cleanup();
}
