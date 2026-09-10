import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

console.log('--- Running Chess App Verification Tests ---');

// 1. Verify build artifacts
assert(existsSync('public/bundle.js'), 'public/bundle.js must exist');
assert(statSync('public/bundle.js').size > 10000, 'public/bundle.js must not be empty');
assert(existsSync('public/style.css'), 'public/style.css must exist');
assert(statSync('public/style.css').size > 5000, 'public/style.css must not be empty');
console.log('✓ Build artifacts verified');

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

  // 5. Test Stockfish Move generation
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const moveRes = await fetch(`http://localhost:${TEST_PORT}/api/stockfish/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: startFen, level: 1 }),
  });
  assert.strictEqual(moveRes.status, 200, 'Move API should return 200');
  const moveData = await moveRes.json();
  assert(typeof moveData.bestmove === 'string' && moveData.bestmove.length >= 4, 'bestmove should be UCI notation');
  console.log(`✓ Stockfish 19 move generation passed (bestmove: ${moveData.bestmove})`);

  // 6. Test Stockfish Eval
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
