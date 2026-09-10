import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const STOCKFISH_PATH = resolve(__dirname, 'stockfish/stockfish-linux-x86-64-universal');

// Ensure frontend assets are built
if (!existsSync(join(__dirname, 'public/bundle.js')) || !existsSync(join(__dirname, 'public/index.html'))) {
  const { execSync } = await import('node:child_process');
  execSync('node build.js', { stdio: 'inherit' });
}

// Verify Stockfish binary exists
if (!existsSync(STOCKFISH_PATH)) {
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
    this.process = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });

    this.process.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString();
      this.handleOutput();
    });

    this.process.on('close', (code) => {
      console.log(`Stockfish process exited with code ${code}`);
      if (this.currentTask) {
        const task = this.currentTask;
        this.currentTask = null;
        this.busy = false;
        task.reject(new Error(task.error || 'Stockfish process terminated unexpectedly'));
      }
      if (!this.destroying) {
        console.log('Restarting Stockfish process');
        this.startProcess();
        this.processNext();
      }
    });

    this.send('uci');
    this.send('isready');
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
          const match = line.match(/score (cp|mate) (-?\d+)/);
          if (match) {
            this.currentTask.eval = {
              type: match[1],
              value: parseInt(match[2], 10),
            };
          }
        }

        if (line.startsWith('bestmove')) {
          const parts = line.split(/\s+/);
          const bestmove = parts[1];
          const ponder = parts[3] || null;
          const task = this.currentTask;

          this.currentTask = null;
          this.busy = false;

          task.resolve({
            bestmove,
            ponder,
            eval: task.eval || { type: 'cp', value: 0 },
          });

          this.processNext();
        }
      }
    }
  }

  query(fen, { level = 3, depth, movetime } = {}) {
    return new Promise((resolve, reject) => {
      const config = DIFFICULTY_LEVELS[level] || DIFFICULTY_LEVELS[3];
      const targetDepth = depth || config.depth;
      const targetMovetime = movetime || config.movetime;

      this.queue.push({
        fen,
        config,
        depth: targetDepth,
        movetime: targetMovetime,
        resolve,
        reject,
      });

      this.processNext();
    });
  }

  evaluate(fen, { depth = 10, movetime = 300 } = {}) {
    return this.query(fen, { level: 3, depth, movetime });
  }

  processNext() {
    if (this.busy || this.queue.length === 0) return;

    this.busy = true;
    this.currentTask = this.queue.shift();
    this.currentTask.eval = null;

    const { fen, config, depth, movetime } = this.currentTask;

    this.send('stop');
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
    if (this.process) {
      this.send('quit');
      this.process.kill();
    }
  }
}

const engine = new StockfishController(STOCKFISH_PATH);

// Helper for parsing JSON body
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Stockfish Best Move API
  if (req.method === 'POST' && pathname === '/api/stockfish/move') {
    try {
      const data = await readJsonBody(req);
      if (!data.fen) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing fen parameter' }));
        return;
      }

      const result = await engine.query(data.fen, { level: data.level });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Stockfish Position Eval API
  if (req.method === 'POST' && pathname === '/api/stockfish/eval') {
    try {
      const data = await readJsonBody(req);
      if (!data.fen) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing fen parameter' }));
        return;
      }

      const result = await engine.evaluate(data.fen);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Engine Health Check API
  if (req.method === 'GET' && pathname === '/api/stockfish/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', engine: 'Stockfish 19', ready: engine.isReady }));
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
process.on('SIGINT', () => {
  engine.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  engine.destroy();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Stockfish 19 Chess game running at http://localhost:${PORT}`);
});
