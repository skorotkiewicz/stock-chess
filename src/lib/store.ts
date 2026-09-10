import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Chess } from 'chess.js';
import { buildEditorFen } from './editor-position';
import { classifyMove, formatAnalysisScore, formatWhiteWdl, uciLineToSan } from './analysis';
import { BranchState } from './branches';

export interface HistoryCell {
  ply: number;
  san: string;
  active: boolean;
  future: boolean;
  evalText: string | null;
  quality: string | null;
}

export interface HistoryRow {
  num: string;
  white: HistoryCell | null;
  black: HistoryCell | null;
}

export interface AnalysisView {
  message: string | null;
  evalText: string | null;
  wdlText: string | null;
  statsText: string | null;
  best: string | null;
  ponder: string | null;
  lines: { n: number; score: string; moves: string }[] | null;
}

export interface Snapshot {
  statusText: string;
  statusKind: 'normal' | 'check' | 'gameover' | 'error';
  evalText: string;
  evalBlackPct: number;
  topColor: 'white' | 'black';
  bottomColor: 'white' | 'black';
  topName: string;
  bottomName: string;
  topStatus: string;
  bottomStatus: string;
  whiteType: 'human' | 'stockfish';
  whiteLevel: number;
  blackType: 'human' | 'stockfish';
  blackLevel: number;
  paused: boolean;
  rows: HistoryRow[];
  showMoveAnalysis: boolean;
  showAnalysis: boolean;
  analysis: AnalysisView;
  branchHidden: boolean;
  branchItems: { id: string; name: string }[];
  branchActiveId: string;
  branchStatus: string | null;
  editMode: boolean;
  editorSelected: { color: 'white' | 'black'; role: string } | null;
  promotion: { orig: string; dest: string } | null;
  ioOpen: boolean;
  ioText: string;
  ioFeedback: { text: string; error: boolean } | null;
}

const PIECE_SYMBOLS: Record<string, string> = {
  'w king': '♔', 'w queen': '♕', 'w rook': '♖', 'w bishop': '♗', 'w knight': '♘', 'w pawn': '♙',
  'b king': '♚', 'b queen': '♛', 'b rook': '♜', 'b bishop': '♝', 'b knight': '♞', 'b pawn': '♟',
};

// Sound synthesizer using Web Audio API
class ChessAudio {
  ctx: AudioContext | null = null;

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  play(type: 'capture' | 'check' | 'move') {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (type === 'capture') {
        osc.frequency.setValueAtTime(650, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.06);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (type === 'check') {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1100, now + 0.05);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else {
        // Normal move
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.05);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      }
    } catch {
      // Audio autoplay restrictions or errors ignored
    }
  }
}

export function initialSnapshot(): Snapshot {
  return {
    statusText: 'White to move',
    statusKind: 'normal',
    evalText: '0.0',
    evalBlackPct: 50,
    topColor: 'black',
    bottomColor: 'white',
    topName: 'Black (Stockfish Lv 3)',
    bottomName: 'White (Human)',
    topStatus: 'Waiting',
    bottomStatus: 'Your turn',
    whiteType: 'human',
    whiteLevel: 3,
    blackType: 'stockfish',
    blackLevel: 3,
    paused: false,
    rows: [],
    showMoveAnalysis: true,
    showAnalysis: false,
    analysis: { message: 'Analyzing position...', evalText: null, wdlText: null, statsText: null, best: null, ponder: null, lines: null },
    branchHidden: true,
    branchItems: [{ id: 'main', name: 'Main' }],
    branchActiveId: 'main',
    branchStatus: null,
    editMode: false,
    editorSelected: null,
    promotion: null,
    ioOpen: false,
    ioText: '',
    ioFeedback: null,
  };
}

type PlayerType = 'human' | 'stockfish';

export class ChessStore {
  chess = new Chess();
  branches: BranchState;
  ground: Api | null = null;
  isEngineThinking = false;
  isMatchPaused = false;
  pendingPromotion: { orig: string; dest: string } | null = null;
  engineTimer: ReturnType<typeof setTimeout> | null = null;
  engineAbortController: AbortController | null = null;
  editMode = false;
  selectedPiece: { color: 'white' | 'black'; role: string } | null = null;
  analysisGeneration = 0;
  showMoveAnalysis = true;
  showAnalysis = false;
  whiteType: PlayerType = 'human';
  whiteLevel = 3;
  blackType: PlayerType = 'stockfish';
  blackLevel = 3;
  quickFlash: string | null = null;
  quickFlashTimer: ReturnType<typeof setTimeout> | null = null;
  audio = new ChessAudio();
  sync: (snapshot: Snapshot) => void;

  constructor(sync: (snapshot: Snapshot) => void) {
    this.sync = sync;
    this.branches = new BranchState(this.chess.fen());
  }

  // ----- snapshot -----

  snapshot(): Snapshot {
    const orientation = this.ground ? this.ground.state.orientation : 'white';
    const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';

    const whiteName = this.whiteType === 'stockfish' ? `White (Stockfish Lv ${this.whiteLevel})` : 'White (Human)';
    const blackName = this.blackType === 'stockfish' ? `Black (Stockfish Lv ${this.blackLevel})` : 'Black (Human)';
    const topColor = orientation === 'white' ? 'black' : 'white';
    const bottomColor = orientation === 'white' ? 'white' : 'black';

    const statusOf = (color: 'white' | 'black'): string => {
      if (this.branches.isReviewing) return currentTurn === color ? 'Choose move' : 'Reviewing';
      if (this.chess.isGameOver()) return 'Finished';
      if (this.isMatchPaused) return 'Paused';
      if (currentTurn !== color) return 'Waiting';
      const cfg = this.getPlayerConfig(color);
      if (cfg.type === 'stockfish') {
        return this.isEngineThinking ? 'Thinking...' : 'Ready';
      }
      return 'Your turn';
    };

    let statusText: string;
    let statusKind: Snapshot['statusKind'] = 'normal';
    if (this.quickFlash) {
      statusText = this.quickFlash;
    } else if (this.statusTextOverride) {
      statusText = this.statusTextOverride.text;
      statusKind = this.statusTextOverride.kind;
    } else if (this.editMode) {
      statusText = 'Board editor active';
    } else if (this.branches.isReviewing) {
      statusText = `Reviewing ${this.branches.active.name}. Play a move to create a variation.`;
    } else if (this.chess.isCheckmate()) {
      statusText = `Checkmate! ${this.chess.turn() === 'w' ? 'Black' : 'White'} wins.`;
      statusKind = 'gameover';
    } else if (this.chess.isStalemate()) {
      statusText = 'Game drawn by stalemate.';
      statusKind = 'gameover';
    } else if (this.chess.isThreefoldRepetition()) {
      statusText = 'Game drawn by threefold repetition.';
      statusKind = 'gameover';
    } else if (this.chess.isInsufficientMaterial()) {
      statusText = 'Game drawn by insufficient material.';
      statusKind = 'gameover';
    } else if (this.chess.isDraw()) {
      statusText = 'Game drawn by 50-move rule.';
      statusKind = 'gameover';
    } else if (this.chess.inCheck()) {
      statusText = `${this.chess.turn() === 'w' ? 'White' : 'Black'} is in check!`;
      statusKind = 'check';
    } else if (this.isMatchPaused) {
      statusText = 'Match paused';
    } else {
      const side = this.chess.turn() === 'w' ? 'White' : 'Black';
      const config = this.getPlayerConfig(side.toLowerCase());
      statusText = config.type === 'stockfish' ? `Stockfish (${side}) is calculating...` : `${side} to move`;
    }

    const history = this.buildBranchChess(this.branches.active.moves.length).history({ verbose: true });
    const rows: HistoryRow[] = [];
    const cell = (move: (typeof history)[number], ply: number): HistoryCell => {
      const after = this.branches.active.analysis.get(ply + 1)?.data;
      const before = this.branches.active.analysis.get(ply)?.data;
      const playedMove = `${move.from}${move.to}${move.promotion || ''}`;
      const quality = classifyMove(before, after, playedMove);
      return {
        ply,
        san: move.san,
        active: ply === this.branches.viewedPly - 1,
        future: ply >= this.branches.viewedPly,
        evalText: after ? formatAnalysisScore(after.eval, after.turn) : null,
        quality,
      };
    };
    for (let i = 0; i < history.length; i += 2) {
      rows.push({
        num: `${Math.floor(i / 2) + 1}.`,
        white: cell(history[i], i),
        black: history[i + 1] ? cell(history[i + 1], i + 1) : null,
      });
    }

    const analysisView: AnalysisView = { message: null, evalText: null, wdlText: null, statsText: null, best: null, ponder: null, lines: null };
    const currentAnalysis = this.branches.active.analysis.get(this.branches.viewedPly);
    if (currentAnalysis && !currentAnalysis.data.analysis) {
      analysisView.message = 'No analysis available.';
    } else if (currentAnalysis?.data.analysis) {
      const data = currentAnalysis.data;
      const analysis = data.analysis;
      const bestLine = uciLineToSan(currentAnalysis.fen, [data.bestmove, data.ponder].filter(Boolean));
      analysisView.evalText = formatAnalysisScore(analysis.score, data.turn);
      analysisView.wdlText = formatWhiteWdl(analysis.wdl, data.turn);
      analysisView.statsText = `Depth ${analysis.depth}/${analysis.seldepth} · ${analysis.nodes.toLocaleString()} nodes · ${analysis.nps.toLocaleString()} NPS · Hash ${(analysis.hashfull / 10).toFixed(1)}% · ${analysis.time} ms · TB ${analysis.tbhits}`;
      analysisView.best = bestLine[0] || data.bestmove || 'None';
      analysisView.ponder = bestLine[1] || data.ponder || 'None';
      analysisView.lines = data.lines.map((line: any) => ({
        n: line.multipv,
        score: formatAnalysisScore(line.score, data.turn),
        moves: uciLineToSan(currentAnalysis.fen, line.pv).join(' ') || 'No continuation',
      }));
    } else {
      analysisView.message = this.analysisMessage || 'Analyzing position...';
    }

    return {
      statusText,
      statusKind,
      evalText: this.evalText,
      evalBlackPct: this.evalBlackPct,
      topColor,
      bottomColor,
      topName: topColor === 'black' ? blackName : whiteName,
      bottomName: bottomColor === 'white' ? whiteName : blackName,
      topStatus: statusOf(topColor),
      bottomStatus: statusOf(bottomColor),
      whiteType: this.whiteType,
      whiteLevel: this.whiteLevel,
      blackType: this.blackType,
      blackLevel: this.blackLevel,
      paused: this.isMatchPaused,
      rows,
      showMoveAnalysis: this.showMoveAnalysis,
      showAnalysis: this.showAnalysis,
      analysis: analysisView,
      branchHidden: this.branches.items.length === 1,
      branchItems: this.branches.items.map(({ id, name }) => ({ id, name })),
      branchActiveId: this.branches.activeId,
      branchStatus: this.branches.isReviewing
        ? `Reviewing ${this.branches.active.name} at ply ${this.branches.viewedPly}. Play a move to create a variation.`
        : null,
      editMode: this.editMode,
      editorSelected: this.selectedPiece,
      promotion: this.pendingPromotion,
      ioOpen: this.ioOpen,
      ioText: this.ioText,
      ioFeedback: this.ioFeedback,
    };
  }

  analysisMessage: string | null = 'Analyzing position...';
  evalText = '0.0';
  evalBlackPct = 50;
  ioOpen = false;
  ioText = '';
  ioFeedback: { text: string; error: boolean } | null = null;

  emit() {
    this.sync(this.snapshot());
  }

  // ----- helpers -----

  getPlayerConfig(color: string): { type: PlayerType; level: number } {
    if (color === 'white' || color === 'w') {
      return { type: this.whiteType, level: this.whiteLevel };
    }
    return { type: this.blackType, level: this.blackLevel };
  }

  getLegalDests(chessInstance: Chess): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const move of chessInstance.moves({ verbose: true })) {
      if (!dests.has(move.from)) dests.set(move.from, []);
      const list = dests.get(move.from)!;
      if (!list.includes(move.to)) list.push(move.to);
    }
    return dests;
  }

  moveToUci(move: { from: string; to: string; promotion?: string }) {
    return `${move.from}${move.to}${move.promotion || ''}`;
  }

  buildBranchChess(ply = this.branches.viewedPly) {
    const game = new Chess(this.branches.rootFen);
    for (const [key, value] of Object.entries(this.branches.headers)) game.setHeader(key, value);
    for (const uci of this.branches.active.moves.slice(0, ply)) {
      game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
    }
    return game;
  }

  rebuildChess() {
    this.chess = this.buildBranchChess();
  }

  // Full variation-tree PGN (main line + parenthesized variations).
  activeBranchPgn() {
    return this.branches.toPgn();
  }

  resetBranchesFromGame(game: Chess) {
    const headers = game.getHeaders();
    const moves = game.history({ verbose: true }).map((m) => this.moveToUci(m));
    while (game.undo()) {}
    this.branches = new BranchState(game.fen(), moves, headers);
    this.rebuildChess();
  }

  currentAnalyses() {
    return this.branches.active.analysis;
  }

  scoreToWhitePercent(score: { type: 'cp' | 'mate'; value: number } | null, currentTurn: string) {
    if (!score) return 50;
    const sideMultiplier = currentTurn === 'w' ? 1 : -1;
    if (score.type === 'mate') {
      const mateScore = score.value * sideMultiplier;
      return mateScore > 0 ? 100 : 0;
    }
    const cpScore = score.value * sideMultiplier;
    const clamped = Math.max(-1200, Math.min(1200, cpScore));
    const winProbability = 2 / (1 + Math.exp(-0.0036 * clamped)) - 1;
    return 50 + 50 * winProbability;
  }

  updateEvalBar(score: { type: 'cp' | 'mate'; value: number }, currentTurn: string) {
    if (!score) return;
    const whitePercent = this.scoreToWhitePercent(score, currentTurn);
    const isFlipped = this.ground ? this.ground.state.orientation === 'black' : false;
    this.evalText = formatAnalysisScore(score, currentTurn);
    this.evalBlackPct = isFlipped ? whitePercent : 100 - whitePercent;
  }

  setAnalysisMessage(message: string) {
    this.analysisMessage = message;
  }

  resetAnalysis(message = 'Analyzing position...') {
    this.analysisGeneration += 1;
    this.analysisMessage = message;
    this.currentAnalyses().clear();
  }

  // ----- board -----

  attachBoard(el: HTMLElement) {
    this.ground = Chessground(el, {
      fen: this.chess.fen(),
      orientation: 'white',
      turnColor: 'white',
      coordinates: true,
      animation: {
        enabled: true,
        duration: 200,
      },
      movable: {
        color: 'white',
        free: false,
        dests: this.getLegalDests(this.chess),
        events: {
          after: (orig, dest) => this.onUserMove(orig, dest),
        },
      },
      premovable: { enabled: false },
      drawable: { enabled: true },
    });

    // Palette piece placement: intercept mousedown/touchstart in capture phase
    el.addEventListener('mousedown', (e) => this.onBoardPlace(e), true);
    el.addEventListener('touchstart', (e) => this.onBoardPlace(e), true);

    this.emit();
    this.requestEvalOnly();
  }

  updateBoard() {
    this.statusTextOverride = null;
    if (!this.ground) return;
    if (this.editMode) {
      this.ground.set({
        lastMove: undefined,
        check: false,
        autoCastle: false,
        movable: { free: true, color: 'both' },
        draggable: { enabled: true, deleteOnDropOff: true },
        animation: { enabled: false },
      });
      return;
    }
    const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';
    const config = this.getPlayerConfig(currentTurn);
    const isHumanTurn = (this.branches.isReviewing || config.type === 'human') &&
      !this.isEngineThinking && !this.isMatchPaused && !this.chess.isGameOver();

    this.ground.set({
      fen: this.chess.fen(),
      turnColor: currentTurn,
      check: this.chess.inCheck(),
      autoCastle: true,
      animation: { enabled: true },
      draggable: { enabled: true, deleteOnDropOff: false },
      movable: {
        free: false,
        color: isHumanTurn ? currentTurn : undefined,
        dests: isHumanTurn ? this.getLegalDests(this.chess) : new Map(),
      },
    });
  }

  showBranchPosition() {
    this.analysisGeneration += 1;
    this.rebuildChess();
    this.pendingPromotion = null;
    if (this.ground) {
      const lastMove = this.chess.history({ verbose: true }).at(-1);
      this.ground.set({ lastMove: lastMove ? [lastMove.from, lastMove.to] : undefined });
    }

    const cached = this.currentAnalyses().get(this.branches.viewedPly);
    if (cached) {
      this.updateEvalBar(cached.data.eval, cached.data.turn);
    } else {
      this.analysisMessage = 'Analyzing position...';
    }

    this.updateBoard();
    this.emit();
    if (!cached) this.requestEvalOnly();
    this.checkEngineTurn();
  }

  navigateToPly(ply: number) {
    this.cancelEngineMove();
    this.branches.view(ply);
    this.showBranchPosition();
  }

  selectBranch(id: string) {
    this.cancelEngineMove();
    this.branches.select(id);
    this.showBranchPosition();
  }

  // ----- engine -----

  cancelEngineMove() {
    if (this.engineTimer) clearTimeout(this.engineTimer);
    this.engineTimer = null;
    if (this.engineAbortController) this.engineAbortController.abort();
    this.engineAbortController = null;
    this.isEngineThinking = false;
  }

  checkEngineTurn() {
    if (this.editMode || this.branches.isReviewing || this.isEngineThinking || this.isMatchPaused || this.chess.isGameOver()) return;
    const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';
    const config = this.getPlayerConfig(currentTurn);

    if (config.type === 'stockfish') {
      const whiteConfig = this.getPlayerConfig('white');
      const blackConfig = this.getPlayerConfig('black');
      const isEngineVsEngine = whiteConfig.type === 'stockfish' && blackConfig.type === 'stockfish';

      if (this.engineTimer) clearTimeout(this.engineTimer);

      // Engine vs Engine has a comfortable pacing delay to watch moves
      const delay = isEngineVsEngine ? 650 : 150;
      this.engineTimer = setTimeout(() => {
        this.engineTimer = null;
        this.requestEngineMove(config.level);
      }, delay);
    }
  }

  recordBranchMove(move: { from: string; to: string; promotion?: string }) {
    const result = this.branches.append(this.moveToUci(move));
    if (result.created) this.analysisGeneration += 1;
  }

  playMoveSound(move: { captured?: string }) {
    if (this.chess.inCheck()) {
      this.audio.play('check');
    } else if (move.captured) {
      this.audio.play('capture');
    } else {
      this.audio.play('move');
    }
  }

  executeMove(orig: string, dest: string, promotion?: string) {
    try {
      const move = this.chess.move({ from: orig, to: dest, promotion });
      if (!move) {
        this.updateBoard();
        this.emit();
        return;
      }

      this.recordBranchMove(move);
      this.playMoveSound(move);

      if (this.ground) this.ground.set({ lastMove: [orig as Key, dest as Key] });

      this.updateBoard();
      this.emit();
      const nextPlayer = this.getPlayerConfig(this.chess.turn());
      if (nextPlayer.type === 'human' || this.chess.isGameOver()) this.requestEvalOnly();
      this.checkEngineTurn();
    } catch (err) {
      console.error('Invalid move attempted:', err);
      this.updateBoard();
      this.emit();
    }
  }

  onUserMove(orig: string, dest: string) {
    const piece = this.chess.get(orig as any);
    const isPawnPromotion = piece && piece.type === 'p' && (
      (piece.color === 'w' && orig[1] === '7' && dest[1] === '8') ||
      (piece.color === 'b' && orig[1] === '2' && dest[1] === '1')
    );

    if (isPawnPromotion) {
      this.pendingPromotion = { orig, dest };
      this.emit();
    } else {
      this.executeMove(orig, dest);
    }
  }

  choosePromotion(piece: string) {
    if (!this.pendingPromotion) return;
    const { orig, dest } = this.pendingPromotion;
    this.pendingPromotion = null;
    this.executeMove(orig, dest, piece);
  }

  parseEngineResponse(res: Response) {
    return res.json().catch(() => ({} as any)).then((data) => {
      if (!res.ok) throw new Error(data.error || `Server returned HTTP ${res.status}`);
      return data;
    });
  }

  showEngineError(err: Error) {
    this.quickFlash = null;
    this.statusTextOverride = { text: `Stockfish error: ${err.message}`, kind: 'error' as const };
    this.analysisMessage = this.statusTextOverride.text;
  }

  statusTextOverride: { text: string; kind: Snapshot['statusKind'] } | null = null;

  async requestEngineMove(level: number) {
    if (this.isEngineThinking || this.isMatchPaused || this.chess.isGameOver()) return;
    const controller = new AbortController();
    this.engineAbortController = controller;
    this.isEngineThinking = true;
    this.emit();

    const fen = this.chess.fen();

    try {
      const res = await fetch('/api/stockfish/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, level }),
        signal: controller.signal,
      });

      const data = await this.parseEngineResponse(res);
      if (controller !== this.engineAbortController) return;
      this.engineAbortController = null;
      this.isEngineThinking = false;

      if (this.editMode || fen !== this.chess.fen()) return;

      this.currentAnalyses().set(this.chess.history().length, { data, fen });
      this.emit();

      if (!data.bestmove || data.bestmove === '(none)') {
        this.updateBoard();
        this.emit();
        return;
      }

      const orig = data.bestmove.slice(0, 2);
      const dest = data.bestmove.slice(2, 4);
      const promotion = data.bestmove.slice(4, 5) || undefined;

      const move = this.chess.move({ from: orig, to: dest, promotion });
      if (move) {
        this.recordBranchMove(move);
        this.playMoveSound(move);
        if (this.ground) this.ground.set({ lastMove: [orig as Key, dest as Key] });
      }

      if (data.eval) this.updateEvalBar(data.eval, data.turn);

      this.updateBoard();
      this.emit();
      this.requestEvalOnly();
      this.checkEngineTurn();
    } catch (err) {
      if (controller !== this.engineAbortController) return;
      this.engineAbortController = null;
      this.isEngineThinking = false;
      if ((err as Error).name !== 'AbortError') console.error('Stockfish request failed:', err);
      this.updateBoard();
      this.showEngineError(err as Error);
      this.emit();
    }
  }

  async requestEvalOnly() {
    if (this.isEngineThinking || this.editMode || !this.ground) return;
    const fen = this.chess.fen();
    const ply = this.chess.history().length;
    const generation = this.analysisGeneration;
    try {
      const res = await fetch('/api/stockfish/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen }),
      });
      const data = await this.parseEngineResponse(res);
      if (this.editMode || generation !== this.analysisGeneration || fen !== this.chess.fen() || ply !== this.chess.history().length) return;
      if (data.eval) this.updateEvalBar(data.eval, data.turn);
      this.currentAnalyses().set(ply, { data, fen });
      this.emit();
    } catch (err) {
      console.error('Eval request failed:', err);
      if (!this.editMode && generation === this.analysisGeneration && fen === this.chess.fen()) {
        this.showEngineError(err as Error);
        this.emit();
      }
    }
  }

  // ----- controls -----

  undoMove() {
    if (this.isEngineThinking || this.editMode || this.branches.viewedPly === 0) return;
    this.cancelEngineMove();

    if (this.branches.isReviewing) {
      this.branches.view(this.branches.viewedPly - 1);
    } else {
      const whiteConfig = this.getPlayerConfig('white');
      const blackConfig = this.getPlayerConfig('black');
      const isHumanVsEngine = (whiteConfig.type === 'human' && blackConfig.type === 'stockfish') ||
                              (whiteConfig.type === 'stockfish' && blackConfig.type === 'human');
      this.branches.takeback(isHumanVsEngine && this.branches.viewedPly >= 2 ? 2 : 1);
    }

    this.showBranchPosition();
  }

  onBoardPlace(e: MouseEvent | TouchEvent) {
    if (!this.editMode || !this.selectedPiece || !this.ground) return;
    const isTouch = 'touches' in e;
    if (!isTouch && e.button !== 0) return;
    const pos: [number, number] | null = isTouch
      ? (e.touches[0] ? [e.touches[0].clientX, e.touches[0].clientY] : null)
      : [e.clientX, e.clientY];
    if (!pos) return;
    const key = this.ground.getKeyAtDomPos(pos);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    this.ground.setPieces(new Map([[key, { color: this.selectedPiece.color, role: this.selectedPiece.role as any }]] as any));
  }

  selectEditorPiece(color: 'white' | 'black', role: string) {
    this.selectedPiece = this.selectedPiece && this.selectedPiece.role === role && this.selectedPiece.color === color
      ? null
      : { color, role };
    this.emit();
  }

  enterEditMode() {
    this.cancelEngineMove();
    this.resetAnalysis('Finish editing to analyze this position.');
    this.editMode = true;
    this.selectedPiece = null;
    this.pendingPromotion = null;
    this.updateBoard();
    this.emit();
  }

  exitEditMode() {
    const existingCastling = this.chess.fen().split(' ')[2];

    try {
      this.chess.load(buildEditorFen(this.ground!.getFen(), this.chess.turn(), existingCastling, this.ground!.state.pieces));
    } catch (err) {
      this.statusTextOverride = {
        text: `Invalid position: ${(err as Error).message.replace(/^Invalid FEN:\s*/, '')}.`,
        kind: 'gameover',
      };
      this.emit();
      return;
    }

    this.editMode = false;
    this.selectedPiece = null;
    this.branches = new BranchState(this.chess.fen());
    this.resetAnalysis();
    this.updateBoard();
    this.emit();
    this.requestEvalOnly();
    this.checkEngineTurn();
  }

  toggleEditMode() {
    if (this.editMode) {
      this.exitEditMode();
    } else {
      this.enterEditMode();
    }
  }

  editorClear() {
    this.ground?.set({ fen: '8/8/8/8/8/8/8/8' });
  }

  editorStart() {
    this.ground?.set({ fen: 'start' });
  }

  newGame() {
    this.cancelEngineMove();
    this.editMode = false;
    this.selectedPiece = null;
    this.isEngineThinking = false;
    this.isMatchPaused = false;

    this.chess.reset();
    this.branches = new BranchState(this.chess.fen());
    this.resetAnalysis();

    // If White is engine and Black is human, orient board for Black
    const whiteConfig = this.getPlayerConfig('white');
    const blackConfig = this.getPlayerConfig('black');
    this.ground?.set({ orientation: whiteConfig.type === 'stockfish' && blackConfig.type === 'human' ? 'black' : 'white' });

    this.ground?.set({
      fen: this.chess.fen(),
      turnColor: 'white',
      check: false,
      lastMove: undefined,
    });

    this.evalText = '0.0';
    this.evalBlackPct = 50;

    this.updateBoard();
    this.emit();
    this.requestEvalOnly();
    this.checkEngineTurn();
  }

  togglePauseResume() {
    this.isMatchPaused = !this.isMatchPaused;
    if (this.isMatchPaused) this.cancelEngineMove();
    this.updateBoard();
    this.emit();
    if (!this.isMatchPaused) this.checkEngineTurn();
  }

  flip() {
    this.ground?.toggleOrientation();
    const currentAnalysis = this.currentAnalyses().get(this.chess.history().length)?.data;
    this.updateEvalBar(currentAnalysis?.eval || { type: 'cp', value: 0 }, currentAnalysis?.turn || this.chess.turn());
    this.emit();
  }

  setWhiteType(value: PlayerType) {
    this.whiteType = value;
    this.cancelEngineMove();
    this.updateBoard();
    this.emit();
    this.checkEngineTurn();
  }

  setBlackType(value: PlayerType) {
    this.blackType = value;
    this.cancelEngineMove();
    this.updateBoard();
    this.emit();
    this.checkEngineTurn();
  }

  setWhiteLevel(value: number) {
    this.whiteLevel = value;
    this.emit();
  }

  setBlackLevel(value: number) {
    this.blackLevel = value;
    this.emit();
  }

  setIoText(value: string) {
    this.ioText = value;
    this.emit();
  }

  setShowAnalysis(value: boolean) {
    this.showAnalysis = value;
    this.emit();
  }

  setShowMoveAnalysis(value: boolean) {
    this.showMoveAnalysis = value;
    this.emit();
  }

  // ----- import / export -----

  openIo() {
    this.ioText = this.activeBranchPgn() || this.chess.fen();
    this.ioFeedback = null;
    this.ioOpen = true;
    this.emit();
  }

  closeIo() {
    this.ioOpen = false;
    this.emit();
  }

  async copyToClipboard(text: string, successMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.ioFeedback = { text: successMsg, error: false };
    } catch {
      this.ioFeedback = { text: successMsg, error: false };
    }
    this.emit();
  }

  copyFen() {
    this.copyToClipboard(this.chess.fen(), 'FEN copied to clipboard!');
  }

  copyPgn() {
    this.copyToClipboard(this.activeBranchPgn() || this.chess.fen(), 'PGN copied to clipboard!');
  }

  downloadPgn() {
    const pgnContent = this.activeBranchPgn();
    const blob = new Blob([pgnContent || this.chess.fen()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockfish-game-${Date.now()}.pgn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.ioFeedback = { text: 'PGN downloaded.', error: false };
    this.emit();
  }

  async quickExportFen() {
    try {
      await navigator.clipboard.writeText(this.chess.fen());
    } catch {}
    this.flashStatus('FEN copied to clipboard!');
  }

  async quickExportPgn() {
    try {
      await navigator.clipboard.writeText(this.activeBranchPgn() || this.chess.fen());
    } catch {}
    this.flashStatus('PGN copied to clipboard!');
  }

  flashStatus(text: string) {
    this.quickFlash = text;
    if (this.quickFlashTimer) clearTimeout(this.quickFlashTimer);
    this.quickFlashTimer = setTimeout(() => {
      this.quickFlashTimer = null;
      this.quickFlash = null;
      this.emit();
    }, 1500);
    this.emit();
  }

  async loadGameString(input: string) {
    const trimmed = input.trim();
    if (!trimmed) {
      this.ioFeedback = { text: 'Input is empty.', error: true };
      this.emit();
      return;
    }

    const candidate = new Chess();
    let success = false;

    // Try FEN format
    try {
      candidate.load(trimmed);
      success = true;
    } catch {}

    // Try PGN format
    if (!success) {
      try {
        candidate.loadPgn(trimmed);
        success = true;
      } catch {}
    }

    if (!success) {
      this.ioFeedback = { text: 'Invalid FEN or PGN string.', error: true };
      this.emit();
      return;
    }

    this.cancelEngineMove();
    this.resetBranchesFromGame(candidate);
    this.editMode = false;
    this.selectedPiece = null;
    this.resetAnalysis();
    this.updateBoard();
    this.emit();
    this.requestEvalOnly();

    this.ioFeedback = { text: 'Game successfully loaded!', error: false };
    setTimeout(() => {
      this.closeIo();
      this.checkEngineTurn();
    }, 600);
  }
}

export { PIECE_SYMBOLS };
