import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const isExecutableFile = (candidate: string) => {
	try {
		return statSync(candidate).isFile();
	} catch {
		return false;
	}
};

// ponytail: binary path resolved from CWD candidates (my-app or repo root).
// Set STOCKFISH_PATH when running from another working directory.
const CANDIDATE_NAMES = [
	'stockfish-linux-x86-64-universal',
	'stockfish-linux-arm64-universal',
	'stockfish-macos-universal',
	'stockfish-windows-x86-64-universal.exe',
	'stockfish-windows-arm64-universal.exe',
	process.platform === 'win32' ? 'stockfish.exe' : 'stockfish',
];

const STOCKFISH_PATH =
	process.env.STOCKFISH_PATH ??
	CANDIDATE_NAMES.flatMap((name) => [
		resolve(process.cwd(), 'stockfish', name),
		resolve(process.cwd(), name),
		resolve(process.cwd(), '../stockfish', name),
	]).find((candidate) => isExecutableFile(candidate)) ??
	resolve(process.cwd(), 'stockfish', CANDIDATE_NAMES[0]);

if (!isExecutableFile(STOCKFISH_PATH)) {
	throw new Error(`Stockfish binary not found at: ${STOCKFISH_PATH}`);
}

// Difficulty settings map (5 discrete levels)
const DIFFICULTY_LEVELS: Record<number, { skill: number; limitElo: number | null; depth: number; movetime: number }> = {
	1: { skill: 1, limitElo: 1320, depth: 4, movetime: 150 },
	2: { skill: 5, limitElo: 1600, depth: 7, movetime: 300 },
	3: { skill: 10, limitElo: 1900, depth: 10, movetime: 600 },
	4: { skill: 15, limitElo: 2300, depth: 14, movetime: 1000 },
	5: { skill: 20, limitElo: null, depth: 20, movetime: 1500 },
};

interface EngineLine {
	multipv: number;
	depth: number;
	seldepth: number;
	score: { type: 'cp' | 'mate'; value: number };
	wdl: { win: number; draw: number; loss: number } | null;
	nodes: number;
	nps: number;
	hashfull: number;
	tbhits: number;
	time: number;
	pv: string[];
}

interface EngineTask {
	fen: string;
	config: { skill: number; limitElo: number | null };
	depth: number;
	movetime: number;
	multipv: number;
	lines: Map<number, EngineLine>;
	error?: string;
	resolve: (result: unknown) => void;
	reject: (err: Error) => void;
}

export interface EngineResult {
	bestmove: string;
	ponder: string | null;
	turn: string;
	eval: { type: 'cp' | 'mate'; value: number };
	analysis: EngineLine | null;
	lines: EngineLine[];
}

// Stockfish Engine UCI Controller
class StockfishController {
	queue: EngineTask[] = [];
	busy = false;
	currentTask: EngineTask | null = null;
	stdoutBuffer = '';
	isReady = false;
	destroying = false;
	process: ReturnType<typeof spawn> | null = null;

	constructor() {
		this.startProcess();
	}

	startProcess() {
		this.stdoutBuffer = '';
		this.isReady = false;
		this.process = spawn(STOCKFISH_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });

		this.process.stdout!.on('data', (chunk: Buffer) => {
			this.stdoutBuffer += chunk.toString();
			this.handleOutput();
		});

		this.process.on('error', (err) => {
			console.error('Stockfish process error:', err);
			this.isReady = false;
			if (this.currentTask) {
				const task = this.currentTask;
				this.currentTask = null;
				this.busy = false;
				task.reject(err);
			}
		});

		this.process.on('close', (code: number | null) => {
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

	send(command: string) {
		if (this.process && this.process.stdin!.writable) {
			this.process.stdin!.write(command + '\n');
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
					const value = (name: string) => parseInt(line.match(new RegExp(`(?:^| )${name} (\\d+)`))?.[1] || '0', 10);
					if (score) {
						const multipv = value('multipv') || 1;
						this.currentTask.lines.set(multipv, {
							multipv,
							depth: value('depth'),
							seldepth: value('seldepth'),
							score: { type: score[1] as 'cp' | 'mate', value: parseInt(score[2], 10) },
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

					this.currentTask = null;
					this.busy = false;

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

					this.processNext();
				}
			}
		}
	}

	query(
		fen: string,
		options: { level?: number; depth?: number; movetime?: number; multipv?: number } = {},
	): Promise<EngineResult> {
		const { level = 3, depth, movetime, multipv = 1 } = options;
		return new Promise((resolve, reject) => {
			const config = DIFFICULTY_LEVELS[level] || DIFFICULTY_LEVELS[3];
			const targetDepth = depth || config.depth;
			const targetMovetime = movetime || config.movetime;

			this.queue.push({
				fen,
				config,
				depth: targetDepth,
				movetime: targetMovetime,
				multipv,
				lines: new Map(),
				resolve: resolve as (result: unknown) => void,
				reject,
			});

			this.processNext();
		});
	}

	evaluate(fen: string, { depth = 10, movetime = 300 }: { depth?: number; movetime?: number } = {}) {
		return this.query(fen, { level: 3, depth, movetime, multipv: 3 });
	}

	processNext() {
		if (this.busy || this.queue.length === 0) return;

		this.busy = true;
		this.currentTask = this.queue.shift()!;

		const { fen, config, depth, movetime, multipv } = this.currentTask;

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
		if (this.process) {
			this.send('quit');
			this.process.kill();
		}
	}
}

export const engine = new StockfishController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		engine.destroy();
		process.exit(0);
	});
}
