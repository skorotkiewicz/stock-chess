import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { Chess } from 'chess.js';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStockfishTarget } from './scripts/download-stockfish.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function canonicalizeFen(rawFen) {
  if (typeof rawFen !== 'string' || !rawFen.trim()) {
    throw new TypeError('Invalid or missing FEN string');
  }
  const fen = rawFen.trim();
  if (/[\r\n]/.test(fen)) throw new Error('FEN must not contain newline characters');
  try {
    return new Chess(fen).fen();
  } catch {
    throw new Error('Invalid FEN notation');
  }
}

const STOCKFISH_NAME = getStockfishTarget()?.binName;
const STOCKFISH_NAMES = [
  STOCKFISH_NAME,
  process.platform === 'win32' ? 'stockfish.exe' : 'stockfish',
].filter(Boolean);
const STOCKFISH_PATH = process.env.STOCKFISH_PATH ||
  STOCKFISH_NAMES.map((name) => resolve(__dirname, 'stockfish', name)).find(isFile) ||
  resolve(__dirname, 'stockfish', STOCKFISH_NAMES[0] || 'stockfish');
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '16', 10);
const DEFAULT_TASK_TIMEOUT_MS = parseInt(process.env.DEFAULT_TASK_TIMEOUT_MS || '10000', 10);
const MAX_QUEUE_TIMEOUT = parseInt(process.env.MAX_QUEUE_TIMEOUT_MS || '30000', 10);

// Ensure frontend assets are built in dev mode
if (process.env.NODE_ENV !== 'production' &&
    (!existsSync(join(__dirname, 'public/bundle.js')) || !existsSync(join(__dirname, 'public/index.html')))) {
  const { execSync } = await import('node:child_process');
  execSync('node build.js', { stdio: 'inherit' });
}

// Verify Stockfish binary exists
if (!isFile(STOCKFISH_PATH)) {
  console.error(`Stockfish binary not found at: ${STOCKFISH_PATH}`);
  process.exit(1);
}

// Difficulty settings map (5 discrete levels)
const DIFFICULTY_LEVELS = {
  1: { skill: 1, limitElo: 1320, depth: 4, movetime: 150 },
  2: { skill: 5, limitElo: 1600, depth: 7, movetime: 300 },
  3: { skill: 10, limitElo: 1900, depth: 10, movetime: 600 },
  4: { skill: 15, limitElo: 2300, depth: 14, movetime: 1000 },
  5: { skill: 20, limitElo: null, depth: 20, movetime: 1500 },
};

// Stockfish Engine UCI Controller
class StockfishController {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
    this.queue = [];
    this.busy = false;
    this.currentTask = null;
    this.stdoutBuffer = '';
    this.isReady = false;
    this.destroying = false;

    this.startProcess();
  }

  startProcess() {
    this.stdoutBuffer = '';
    this.isReady = false;
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.process = child;

    child.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString();
      this.handleOutput();
    });

    child.on('error', (err) => {
      console.error('Stockfish process error:', err);
      this.isReady = false;
      if (this.currentTask) this.rejectCurrentTask(err);
    });

    child.on('close', (code) => {
      console.log(`Stockfish process exited with code ${code}`);
      if (this.process === child) this.process = null;
      if (this.currentTask) {
        this.rejectCurrentTask(new Error(this.currentTask.error || 'Stockfish process terminated unexpectedly'));
      }
      if (!this.destroying && this.queue.length > 0) {
        console.log('Restarting Stockfish process');
        this.startProcess();
        this.processNext();
      }
    });

    this.send('uci');
    this.send('isready');
  }

  rejectCurrentTask(error) {
    const task = this.currentTask;
    if (!task) return;
    if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
    if (task.signal && task.abortHandler) task.signal.removeEventListener('abort', task.abortHandler);
    this.currentTask = null;
    this.busy = false;
    task.reject(error);
  }

  send(command) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(command + '\n');
    }
  }

  handleOutput() {
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line === 'readyok') {
        this.isReady = true;
      }

      if (this.busy && this.currentTask) {
        if (line.startsWith('info string CRITICAL ERROR:')) {
          this.currentTask.error = line.match(/Reason:\s*(.+)$/)?.[1] ||
            line.replace(/^info string CRITICAL ERROR:\s*/, '');
        }

        if (line.startsWith('info ') && line.includes('score ')) {
          const score = line.match(/score (cp|mate) (-?\d+)/);
          const wdl = line.match(/ wdl (\d+) (\d+) (\d+)/);
          const value = (name) => parseInt(line.match(new RegExp(`(?:^| )${name} (\\d+)`))?.[1] || '0', 10);
          if (score) {
            const multipv = value('multipv') || 1;
            this.currentTask.lines.set(multipv, {
              multipv,
              depth: value('depth'),
              seldepth: value('seldepth'),
              score: { type: score[1], value: parseInt(score[2], 10) },
              wdl: wdl ? { win: Number(wdl[1]), draw: Number(wdl[2]), loss: Number(wdl[3]) } : null,
              nodes: value('nodes'),
              nps: value('nps'),
              hashfull: value('hashfull'),
              tbhits: value('tbhits'),
              time: value('time'),
              pv: line.match(/ pv (.+)$/)?.[1].split(/\s+/) || [],
            });
          }
        }

        if (line.startsWith('bestmove')) {
          const parts = line.split(/\s+/);
          const bestmove = parts[1];
          const ponder = parts[3] || null;
          const task = this.currentTask;

          if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
          if (task.signal && task.abortHandler) task.signal.removeEventListener('abort', task.abortHandler);
          this.currentTask = null;
          this.busy = false;

          if (task.signal?.aborted) {
            const error = new Error('Request aborted');
            error.name = 'AbortError';
            task.reject(error);
          } else {
            const lines = [...task.lines.values()].sort((a, b) => a.multipv - b.multipv);
            const analysis = lines.find((item) => item.multipv === 1) || null;
            task.resolve({
              bestmove,
              ponder,
              turn: task.fen.split(' ')[1],
              eval: analysis?.score || { type: 'cp', value: 0 },
              analysis,
              lines,
            });
          }

          this.processNext();
        }
      }
    }
  }

  query(rawFen, { level = 3, depth, movetime, multipv = 1, signal } = {}) {
    const fen = canonicalizeFen(rawFen);
    if (signal?.aborted) {
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    }
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return Promise.reject(new Error('Engine queue is full'));
    }

    return new Promise((resolve, reject) => {
      const config = DIFFICULTY_LEVELS[level] || DIFFICULTY_LEVELS[3];
      const task = {
        fen,
        config,
        depth: depth || config.depth,
        movetime: movetime || config.movetime,
        multipv,
        lines: new Map(),
        signal,
        resolve,
        reject,
      };

      if (signal) {
        task.abortHandler = () => {
          const index = this.queue.indexOf(task);
          if (index !== -1) {
            this.queue.splice(index, 1);
            const error = new Error('Request aborted');
            error.name = 'AbortError';
            task.reject(error);
          } else if (this.currentTask === task) {
            this.send('stop');
          }
        };
        signal.addEventListener('abort', task.abortHandler, { once: true });
      }

      this.queue.push(task);
      this.processNext();
    });
  }

  evaluate(fen, { depth = 10, movetime = 300, signal } = {}) {
    return this.query(fen, { level: 5, depth, movetime, multipv: 3, signal });
  }

  processNext() {
    if (this.busy || this.queue.length === 0) return;

    while (this.queue[0]?.signal?.aborted) {
      const task = this.queue.shift();
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      task.reject(error);
    }
    if (this.queue.length === 0) return;
    if (!this.process || this.process.exitCode !== null || this.process.killed) this.startProcess();

    this.busy = true;
    this.currentTask = this.queue.shift();
    const task = this.currentTask;
    const timeoutMs = Math.min(MAX_QUEUE_TIMEOUT, Math.max(DEFAULT_TASK_TIMEOUT_MS, task.movetime + 5000));
    task.timeoutTimer = setTimeout(() => {
      if (this.currentTask !== task) return;
      console.warn(`Engine task timed out after ${timeoutMs}ms`);
      const child = this.process;
      this.rejectCurrentTask(new Error('Engine task timed out'));
      child?.kill();
    }, timeoutMs);

    const { fen, config, depth, movetime, multipv } = task;
    this.send('stop');
    this.send('setoption name UCI_ShowWDL value true');
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`setoption name Skill Level value ${config.skill}`);
    if (config.limitElo) {
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${config.limitElo}`);
    } else {
      this.send('setoption name UCI_LimitStrength value false');
    }

    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth} movetime ${movetime}`);
  }

  destroy() {
    this.destroying = true;
    const error = new Error('Engine stopped');
    if (this.currentTask) this.rejectCurrentTask(error);
    for (const task of this.queue.splice(0)) task.reject(error);
    if (this.process) {
      this.send('quit');
      this.process.kill();
      this.process = null;
    }
  }
}

const engine = new StockfishController(STOCKFISH_PATH);

// Helper for parsing JSON body
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > 1e6) {
        tooLarge = true;
        const error = new Error('Payload too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function requestSignal(req, res) {
  const controller = new AbortController();
  req.once('aborted', () => controller.abort());
  res.once('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

function engineErrorStatus(err) {
  if (err.statusCode) return err.statusCode;
  if (err.name === 'AbortError') return 499;
  if (err instanceof SyntaxError || /FEN|fen|newline/.test(err.message)) return 400;
  if (err.message.includes('queue is full')) return 503;
  return 500;
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// HTTP Server
const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  // Stockfish Best Move API
  if (req.method === 'POST' && pathname === '/api/stockfish/move') {
    try {
      const signal = requestSignal(req, res);
      const data = await readJsonBody(req);
      const fen = canonicalizeFen(data.fen);
      const level = typeof data.level === 'number' && Number.isInteger(data.level)
        ? Math.max(1, Math.min(5, data.level))
        : 3;
      const result = await engine.query(fen, { level, signal });
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      if (res.destroyed) return;
      res.writeHead(engineErrorStatus(err), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
    }
    return;
  }

  // Stockfish Position Eval API
  if (req.method === 'POST' && pathname === '/api/stockfish/eval') {
    try {
      const signal = requestSignal(req, res);
      const data = await readJsonBody(req);
      const fen = canonicalizeFen(data.fen);
      const result = await engine.evaluate(fen, { signal });
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      if (res.destroyed) return;
      res.writeHead(engineErrorStatus(err), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
    }
    return;
  }

  // Engine Health Check API
  if (req.method === 'GET' && pathname === '/api/stockfish/health') {
    res.writeHead(engine.isReady ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: engine.isReady ? 'ok' : 'starting',
      engine: 'Stockfish 19',
      ready: engine.isReady,
    }));
    return;
  }

  // Static File Serving
  if (req.method === 'GET') {
    let filePath = join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
      createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

// Graceful cleanup
function gracefulExit() {
  engine.destroy();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

server.listen(PORT, HOST, () => {
  const address = server.address();
  console.log(`Stockfish 19 Chess game running at http://${HOST}:${address.port}`);
});
