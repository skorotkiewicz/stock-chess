import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import { buildEditorFen } from './editor-position.js';
import { classifyMove, formatAnalysisScore, formatWhiteWdl, uciLineToSan } from './analysis.js';
import { BranchState } from './branches.js';

// Game state
let chess = new Chess();
let branches = new BranchState(chess.fen());
let ground = null;
let isEngineThinking = false;
let isMatchPaused = false;
let pendingPromotion = null;
let engineTimer = null;
let engineAbortController = null;
let editMode = false;
let selectedPiece = null;
let analysisGeneration = 0;

const PIECE_SYMBOLS = {
  'w king': '♔', 'w queen': '♕', 'w rook': '♖', 'w bishop': '♗', 'w knight': '♘', 'w pawn': '♙',
  'b king': '♚', 'b queen': '♛', 'b rook': '♜', 'b bishop': '♝', 'b knight': '♞', 'b pawn': '♟',
};

// Sound synthesizer using Web Audio API
class ChessAudio {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  play(type) {
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

const audio = new ChessAudio();

// DOM elements
const boardEl = document.getElementById('board');
const statusBox = document.getElementById('statusBox');
const historyBody = document.getElementById('historyBody');
const historyContainer = document.getElementById('historyContainer');
const branchSelect = document.getElementById('branchSelect');
const branchStatus = document.getElementById('branchStatus');
const btnBranchStart = document.getElementById('btnBranchStart');
const toggleHistoryAnalysis = document.getElementById('toggleHistoryAnalysis');
const analysisPanel = document.getElementById('analysisPanel');
const toggleAnalysis = document.getElementById('toggleAnalysis');
const analysisEmpty = document.getElementById('analysisEmpty');
const analysisContent = document.getElementById('analysisContent');
const analysisEval = document.getElementById('analysisEval');
const analysisWdl = document.getElementById('analysisWdl');
const analysisStats = document.getElementById('analysisStats');
const analysisBest = document.getElementById('analysisBest');
const analysisPonder = document.getElementById('analysisPonder');
const analysisLines = document.getElementById('analysisLines');
const evalBlack = document.getElementById('evalBlack');
const evalScoreTop = document.getElementById('evalScoreTop');
const evalScoreBottom = document.getElementById('evalScoreBottom');
const topPlayerName = document.getElementById('topPlayerName');
const topIndicator = document.getElementById('topIndicator');
const topPlayerStatus = document.getElementById('topPlayerStatus');
const bottomPlayerName = document.getElementById('bottomPlayerName');
const bottomIndicator = document.getElementById('bottomIndicator');
const bottomPlayerStatus = document.getElementById('bottomPlayerStatus');

// Player setup controls
const whiteTypeSelect = document.getElementById('whiteTypeSelect');
const whiteLevelGroup = document.getElementById('whiteLevelGroup');
const whiteLevelSelect = document.getElementById('whiteLevelSelect');
const blackTypeSelect = document.getElementById('blackTypeSelect');
const blackLevelGroup = document.getElementById('blackLevelGroup');
const blackLevelSelect = document.getElementById('blackLevelSelect');

// Buttons
const btnNewGame = document.getElementById('btnNewGame');
const btnPauseResume = document.getElementById('btnPauseResume');
const btnFlip = document.getElementById('btnFlip');
const btnUndo = document.getElementById('btnUndo');
const btnEval = document.getElementById('btnEval');
const btnEditBoard = document.getElementById('btnEditBoard');
const editorPanel = document.getElementById('editorPanel');
const editorPalette = document.getElementById('editorPalette');
const btnEditorDone = document.getElementById('btnEditorDone');
const btnEditorClear = document.getElementById('btnEditorClear');
const btnEditorStart = document.getElementById('btnEditorStart');

// Promotion
const promotionOverlay = document.getElementById('promotionOverlay');
const promotionChoices = document.getElementById('promotionChoices');

// Import / Export modal
const ioModalOverlay = document.getElementById('ioModalOverlay');
const ioTextarea = document.getElementById('ioTextarea');
const ioFeedback = document.getElementById('ioFeedback');
const btnOpenIoModal = document.getElementById('btnOpenIoModal');
const btnIoClose = document.getElementById('btnIoClose');
const btnDoImport = document.getElementById('btnDoImport');
const btnCopyFen = document.getElementById('btnCopyFen');
const btnCopyPgn = document.getElementById('btnCopyPgn');
const btnDownloadPgn = document.getElementById('btnDownloadPgn');
const btnQuickExportPgn = document.getElementById('btnQuickExportPgn');
const btnQuickExportFen = document.getElementById('btnQuickExportFen');

// Helper to get configuration for a given color
function getPlayerConfig(color) {
  if (color === 'white' || color === 'w') {
    return {
      type: whiteTypeSelect.value,
      level: parseInt(whiteLevelSelect.value, 10) || 3,
    };
  }
  return {
    type: blackTypeSelect.value,
    level: parseInt(blackLevelSelect.value, 10) || 3,
  };
}

// Compute legal destination squares for Chessground
function getLegalDests(chessInstance) {
  const dests = new Map();
  const moves = chessInstance.moves({ verbose: true });
  for (const move of moves) {
    if (!dests.has(move.from)) {
      dests.set(move.from, []);
    }
    const currentList = dests.get(move.from);
    if (!currentList.includes(move.to)) {
      currentList.push(move.to);
    }
  }
  return dests;
}

function moveToUci(move) {
  return `${move.from}${move.to}${move.promotion || ''}`;
}

function buildBranchChess(ply = branches.viewedPly) {
  const game = new Chess(branches.rootFen);
  for (const [key, value] of Object.entries(branches.headers)) game.setHeader(key, value);
  for (const uci of branches.active.moves.slice(0, ply)) {
    game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    });
  }
  return game;
}

function rebuildChess() {
  chess = buildBranchChess();
}

function activeBranchPgn() {
  return buildBranchChess(branches.active.moves.length).pgn();
}

function resetBranchesFromGame(game) {
  const headers = game.getHeaders();
  const moves = game.history({ verbose: true }).map(moveToUci);
  while (game.undo()) {}
  branches = new BranchState(game.fen(), moves, headers);
  rebuildChess();
  updateBranchControls();
}

function currentAnalyses() {
  return branches.active.analysis;
}

function updateBranchControls() {
  branchSelect.innerHTML = '';
  for (const branch of branches.items) {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = branch.name;
    branchSelect.appendChild(option);
  }
  branchSelect.value = branches.activeId;
  branchStatus.textContent = branches.isReviewing
    ? `Reviewing ${branches.active.name} at ply ${branches.viewedPly}. Play a move to create a variation.`
    : '';
  branchStatus.classList.toggle('hidden', !branches.isReviewing);
}

// Convert score object to White's perspective percentage
function scoreToWhitePercent(score, currentTurn) {
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

// Update the evaluation bar
function updateEvalBar(score, currentTurn) {
  if (!score) return;
  const whitePercent = scoreToWhitePercent(score, currentTurn);
  const isFlipped = ground ? ground.state.orientation === 'black' : false;

  const formattedScore = formatAnalysisScore(score, currentTurn);

  if (!isFlipped) {
    evalBlack.style.height = `${100 - whitePercent}%`;
    evalScoreTop.textContent = formattedScore;
    evalScoreBottom.textContent = formattedScore;
  } else {
    evalBlack.style.height = `${whitePercent}%`;
    evalScoreTop.textContent = formattedScore;
    evalScoreBottom.textContent = formattedScore;
  }
}

function setAnalysisMessage(message) {
  analysisEmpty.textContent = message;
  analysisEmpty.classList.remove('hidden');
  analysisContent.classList.add('hidden');
}

function resetAnalysis(message = 'Analyzing position...') {
  analysisGeneration += 1;
  currentAnalyses().clear();
  setAnalysisMessage(message);
}

function renderAnalysis(data, fen) {
  const analysis = data.analysis;
  if (!analysis) {
    setAnalysisMessage('No analysis available.');
    return;
  }

  const bestLine = uciLineToSan(fen, [data.bestmove, data.ponder].filter(Boolean));

  analysisEval.textContent = formatAnalysisScore(analysis.score, data.turn);
  analysisWdl.textContent = formatWhiteWdl(analysis.wdl, data.turn);
  analysisStats.textContent = `Depth ${analysis.depth}/${analysis.seldepth} · ${analysis.nodes.toLocaleString()} nodes · ${analysis.nps.toLocaleString()} NPS · Hash ${(analysis.hashfull / 10).toFixed(1)}% · ${analysis.time} ms · TB ${analysis.tbhits}`;
  analysisBest.textContent = bestLine[0] || data.bestmove || 'None';
  analysisPonder.textContent = bestLine[1] || data.ponder || 'None';
  analysisLines.innerHTML = '';

  for (const line of data.lines) {
    const row = document.createElement('div');
    const number = document.createElement('span');
    const score = document.createElement('span');
    const moves = document.createElement('span');
    row.className = 'analysis-line';
    number.className = 'analysis-line-number';
    score.className = 'analysis-line-score';
    number.textContent = `${line.multipv}.`;
    score.textContent = formatAnalysisScore(line.score, data.turn);
    moves.textContent = uciLineToSan(fen, line.pv).join(' ') || 'No continuation';
    row.append(number, score, moves);
    analysisLines.appendChild(row);
  }

  analysisEmpty.classList.add('hidden');
  analysisContent.classList.remove('hidden');
}

function storePositionAnalysis(ply, data, fen, showCurrent = false) {
  currentAnalyses().set(ply, { data, fen });
  if (showCurrent) renderAnalysis(data, fen);
  updateMoveHistory();
}

// Update board state in Chessground
function updateBoard() {
  if (editMode) {
    updatePlayerLabels();
    return;
  }
  const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
  const config = getPlayerConfig(currentTurn);
  const isHumanTurn = (branches.isReviewing || config.type === 'human') &&
    !isEngineThinking && !isMatchPaused && !chess.isGameOver();

  ground.set({
    fen: chess.fen(),
    turnColor: currentTurn,
    check: chess.inCheck(),
    autoCastle: true,
    animation: { enabled: true },
    draggable: { enabled: true, deleteOnDropOff: false },
    movable: {
      free: false,
      color: isHumanTurn ? currentTurn : undefined,
      dests: isHumanTurn ? getLegalDests(chess) : new Map(),
    },
  });

  updatePlayerLabels();
}

// Update player labels and turn status
function updatePlayerLabels() {
  const orientation = ground ? ground.state.orientation : 'white';
  const currentTurn = chess.turn() === 'w' ? 'white' : 'black';

  const whiteConfig = getPlayerConfig('white');
  const blackConfig = getPlayerConfig('black');

  const whiteLabel = whiteConfig.type === 'stockfish'
    ? `White (Stockfish Lv ${whiteConfig.level})`
    : 'White (Human)';

  const blackLabel = blackConfig.type === 'stockfish'
    ? `Black (Stockfish Lv ${blackConfig.level})`
    : 'Black (Human)';

  const topColor = orientation === 'white' ? 'black' : 'white';
  const bottomColor = orientation === 'white' ? 'white' : 'black';

  topPlayerName.textContent = topColor === 'black' ? blackLabel : whiteLabel;
  topIndicator.className = `player-indicator ${topColor}`;

  bottomPlayerName.textContent = bottomColor === 'white' ? whiteLabel : blackLabel;
  bottomIndicator.className = `player-indicator ${bottomColor}`;

  function getStatusText(color) {
    if (branches.isReviewing) return currentTurn === color ? 'Choose move' : 'Reviewing';
    if (chess.isGameOver()) return 'Finished';
    if (isMatchPaused) return 'Paused';
    if (currentTurn !== color) return 'Waiting';
    const cfg = getPlayerConfig(color);
    if (cfg.type === 'stockfish') {
      return isEngineThinking ? 'Thinking...' : 'Ready';
    }
    return 'Your turn';
  }

  topPlayerStatus.textContent = getStatusText(topColor);
  bottomPlayerStatus.textContent = getStatusText(bottomColor);
}

// Update game status box
function updateGameStatus() {
  statusBox.className = 'status-box';
  if (branches.isReviewing) {
    statusBox.textContent = `Reviewing ${branches.active.name}. Play a move to create a variation.`;
  } else if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'Black' : 'White';
    statusBox.textContent = `Checkmate! ${winner} wins.`;
    statusBox.classList.add('gameover');
  } else if (chess.isStalemate()) {
    statusBox.textContent = 'Game drawn by stalemate.';
    statusBox.classList.add('gameover');
  } else if (chess.isThreefoldRepetition()) {
    statusBox.textContent = 'Game drawn by threefold repetition.';
    statusBox.classList.add('gameover');
  } else if (chess.isInsufficientMaterial()) {
    statusBox.textContent = 'Game drawn by insufficient material.';
    statusBox.classList.add('gameover');
  } else if (chess.isDraw()) {
    statusBox.textContent = 'Game drawn by 50-move rule.';
    statusBox.classList.add('gameover');
  } else if (chess.inCheck()) {
    const side = chess.turn() === 'w' ? 'White' : 'Black';
    statusBox.textContent = `${side} is in check!`;
    statusBox.classList.add('check');
  } else if (isMatchPaused) {
    statusBox.textContent = 'Match paused';
  } else {
    const side = chess.turn() === 'w' ? 'White' : 'Black';
    const config = getPlayerConfig(side.toLowerCase());
    if (config.type === 'stockfish') {
      statusBox.textContent = `Stockfish (${side}) is calculating...`;
    } else {
      statusBox.textContent = `${side} to move`;
    }
  }
}

// Render move history
function updateMoveHistory() {
  const history = buildBranchChess(branches.active.moves.length).history({ verbose: true });
  historyBody.innerHTML = '';

  function moveCell(move, ply) {
    const td = document.createElement('td');
    td.className = 'move-ply';
    if (!move) return td;
    td.classList.toggle('active', ply === branches.viewedPly - 1);
    td.classList.toggle('future', ply >= branches.viewedPly);

    const entry = document.createElement('button');
    const san = document.createElement('span');
    const meta = document.createElement('span');
    const after = currentAnalyses().get(ply + 1)?.data;
    const before = currentAnalyses().get(ply)?.data;
    const playedMove = `${move.from}${move.to}${move.promotion || ''}`;
    const quality = classifyMove(before, after, playedMove);
    entry.type = 'button';
    entry.className = 'move-entry history-move';
    entry.title = `View position after ${move.san}`;
    entry.addEventListener('click', () => navigateToPly(ply + 1));
    meta.className = 'move-meta';
    san.textContent = move.san;

    if (after) {
      const evaluation = document.createElement('span');
      evaluation.textContent = formatAnalysisScore(after.eval, after.turn);
      meta.appendChild(evaluation);
    }
    if (quality) {
      const label = document.createElement('span');
      label.className = `move-quality ${quality.toLowerCase()}`;
      label.textContent = quality;
      meta.appendChild(label);
    }

    entry.appendChild(san);
    if (meta.childNodes.length) entry.appendChild(meta);
    td.appendChild(entry);
    return td;
  }

  for (let i = 0; i < history.length; i += 2) {
    const tr = document.createElement('tr');
    const moveNum = document.createElement('td');
    moveNum.className = 'move-num';
    moveNum.textContent = `${Math.floor(i / 2) + 1}.`;
    tr.append(moveNum, moveCell(history[i], i), moveCell(history[i + 1], i + 1));
    historyBody.appendChild(tr);
  }
  historyBody.querySelector('.move-ply.active')?.scrollIntoView({ block: 'nearest' });
}

function showBranchPosition() {
  analysisGeneration += 1;
  rebuildChess();
  pendingPromotion = null;
  promotionOverlay.classList.add('hidden');
  updateBranchControls();

  const moves = chess.history({ verbose: true });
  const lastMove = moves.at(-1);
  ground.set({ lastMove: lastMove ? [lastMove.from, lastMove.to] : undefined });

  const cached = currentAnalyses().get(branches.viewedPly);
  if (cached) {
    updateEvalBar(cached.data.eval, cached.data.turn);
    renderAnalysis(cached.data, cached.fen);
  } else {
    setAnalysisMessage('Analyzing position...');
  }

  updateBoard();
  updateMoveHistory();
  updateGameStatus();
  if (!cached) requestEvalOnly();
  checkEngineTurn();
}

function navigateToPly(ply) {
  cancelEngineMove();
  branches.view(ply);
  showBranchPosition();
}

function selectBranch(id) {
  cancelEngineMove();
  branches.select(id);
  showBranchPosition();
}

// Check if engine should move and trigger if appropriate
function cancelEngineMove() {
  if (engineTimer) clearTimeout(engineTimer);
  engineTimer = null;
  if (engineAbortController) engineAbortController.abort();
  engineAbortController = null;
  isEngineThinking = false;
}

function checkEngineTurn() {
  if (editMode || branches.isReviewing || isEngineThinking || isMatchPaused || chess.isGameOver()) return;
  const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
  const config = getPlayerConfig(currentTurn);

  if (config.type === 'stockfish') {
    const whiteConfig = getPlayerConfig('white');
    const blackConfig = getPlayerConfig('black');
    const isEngineVsEngine = whiteConfig.type === 'stockfish' && blackConfig.type === 'stockfish';

    if (engineTimer) clearTimeout(engineTimer);

    // Engine vs Engine has a comfortable pacing delay to watch moves
    const delay = isEngineVsEngine ? 650 : 150;
    engineTimer = setTimeout(() => {
      engineTimer = null;
      requestEngineMove(config.level);
    }, delay);
  }
}

// Handle promotion piece selection
function handlePromotion(orig, dest) {
  pendingPromotion = { orig, dest };
  promotionOverlay.classList.remove('hidden');
}

promotionChoices.addEventListener('click', (e) => {
  const btn = e.target.closest('.promotion-choice');
  if (!btn || !pendingPromotion) return;
  const choice = btn.dataset.piece;
  const { orig, dest } = pendingPromotion;
  pendingPromotion = null;
  promotionOverlay.classList.add('hidden');
  executeMove(orig, dest, choice);
});

function recordBranchMove(move) {
  const result = branches.append(moveToUci(move));
  if (result.created) analysisGeneration += 1;
  updateBranchControls();
}

// Execute a move in the game
function executeMove(orig, dest, promotion) {
  try {
    const move = chess.move({ from: orig, to: dest, promotion });
    if (!move) {
      updateBoard();
      return;
    }

    recordBranchMove(move);

    if (chess.inCheck()) {
      audio.play('check');
    } else if (move.captured) {
      audio.play('capture');
    } else {
      audio.play('move');
    }

    ground.set({
      lastMove: [orig, dest],
    });

    updateBoard();
    updateMoveHistory();
    updateGameStatus();
    const nextPlayer = getPlayerConfig(chess.turn());
    if (nextPlayer.type === 'human' || chess.isGameOver()) requestEvalOnly();
    checkEngineTurn();
  } catch (err) {
    console.error('Invalid move attempted:', err);
    updateBoard();
  }
}

// User move handler called by Chessground
function onUserMove(orig, dest) {
  const piece = chess.get(orig);
  const isPawnPromotion = piece && piece.type === 'p' && (
    (piece.color === 'w' && orig[1] === '7' && dest[1] === '8') ||
    (piece.color === 'b' && orig[1] === '2' && dest[1] === '1')
  );

  if (isPawnPromotion) {
    handlePromotion(orig, dest);
  } else {
    executeMove(orig, dest);
  }
}

async function parseEngineResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server returned HTTP ${res.status}`);
  return data;
}

function showEngineError(err) {
  const message = `Stockfish error: ${err.message}`;
  statusBox.className = 'status-box error';
  statusBox.textContent = message;
  setAnalysisMessage(message);
}

// Request Stockfish move from backend API
async function requestEngineMove(level) {
  if (isEngineThinking || isMatchPaused || chess.isGameOver()) return;
  const controller = new AbortController();
  engineAbortController = controller;
  isEngineThinking = true;
  updatePlayerLabels();
  updateGameStatus();

  const fen = chess.fen();

  try {
    const res = await fetch('/api/stockfish/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, level }),
      signal: controller.signal,
    });

    const data = await parseEngineResponse(res);
    if (controller !== engineAbortController) return;
    engineAbortController = null;
    isEngineThinking = false;

    if (editMode || fen !== chess.fen()) return;

    storePositionAnalysis(chess.history().length, data, fen);

    if (!data.bestmove || data.bestmove === '(none)') {
      updateBoard();
      updateGameStatus();
      return;
    }

    const orig = data.bestmove.slice(0, 2);
    const dest = data.bestmove.slice(2, 4);
    const promotion = data.bestmove.slice(4, 5) || undefined;

    const move = chess.move({ from: orig, to: dest, promotion });
    if (move) {
      recordBranchMove(move);
      if (chess.inCheck()) {
        audio.play('check');
      } else if (move.captured) {
        audio.play('capture');
      } else {
        audio.play('move');
      }

      ground.set({
        lastMove: [orig, dest],
      });
    }

    if (data.eval) updateEvalBar(data.eval, data.turn);

    updateBoard();
    updateMoveHistory();
    updateGameStatus();
    requestEvalOnly();
    checkEngineTurn();
  } catch (err) {
    if (controller !== engineAbortController) return;
    engineAbortController = null;
    isEngineThinking = false;
    if (err.name !== 'AbortError') console.error('Stockfish request failed:', err);
    updateBoard();
    showEngineError(err);
  }
}

// Request position evaluation only
async function requestEvalOnly() {
  if (isEngineThinking || editMode) return;
  const fen = chess.fen();
  const ply = chess.history().length;
  const generation = analysisGeneration;
  try {
    const res = await fetch('/api/stockfish/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen }),
    });
    const data = await parseEngineResponse(res);
    if (editMode || generation !== analysisGeneration || fen !== chess.fen() || ply !== chess.history().length) return;
    if (data.eval) updateEvalBar(data.eval, data.turn);
    storePositionAnalysis(ply, data, fen, true);
  } catch (err) {
    console.error('Eval request failed:', err);
    if (!editMode && generation === analysisGeneration && fen === chess.fen()) showEngineError(err);
  }
}

// Undo move (takes back 2 plies when human vs engine, 1 ply otherwise)
function undoMove() {
  if (isEngineThinking || editMode || branches.viewedPly === 0) return;
  cancelEngineMove();

  if (branches.isReviewing) {
    branches.view(branches.viewedPly - 1);
  } else {
    const whiteConfig = getPlayerConfig('white');
    const blackConfig = getPlayerConfig('black');
    const isHumanVsEngine = (whiteConfig.type === 'human' && blackConfig.type === 'stockfish') ||
                            (whiteConfig.type === 'stockfish' && blackConfig.type === 'human');
    branches.takeback(isHumanVsEngine && branches.viewedPly >= 2 ? 2 : 1);
  }

  showBranchPosition();
}

// Board Editor
function buildEditorPalette() {
  editorPalette.innerHTML = '';
  const roles = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
  for (const color of ['white', 'black']) {
    for (const role of roles) {
      const btn = document.createElement('button');
      btn.className = 'editor-piece-btn';
      btn.textContent = PIECE_SYMBOLS[`${color === 'white' ? 'w' : 'b'} ${role}`];
      btn.title = `${color} ${role}`;
      btn.dataset.color = color;
      btn.dataset.role = role;
      btn.addEventListener('click', () => {
        selectedPiece = selectedPiece && selectedPiece.role === role && selectedPiece.color === color
          ? null
          : { color, role };
        editorPalette.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        if (selectedPiece) btn.classList.add('active');
      });
      editorPalette.appendChild(btn);
    }
  }
}

function onBoardPlace(e) {
  if (!editMode || !selectedPiece) return;
  const isTouch = e.type === 'touchstart';
  if (!isTouch && e.button !== 0) return;
  const pos = isTouch
    ? (e.touches && e.touches[0] ? [e.touches[0].clientX, e.touches[0].clientY] : null)
    : [e.clientX, e.clientY];
  if (!pos) return;
  const key = ground.getKeyAtDomPos(pos);
  if (!key) return;
  e.preventDefault();
  e.stopPropagation();
  ground.setPieces(new Map([[key, { color: selectedPiece.color, role: selectedPiece.role }]]));
}

function enterEditMode() {
  cancelEngineMove();
  resetAnalysis('Finish editing to analyze this position.');
  editMode = true;
  selectedPiece = null;
  pendingPromotion = null;
  promotionOverlay.classList.add('hidden');
  editorPalette.querySelectorAll('button').forEach((btn) => btn.classList.remove('active'));
  editorPanel.classList.remove('hidden');
  btnEditBoard.textContent = 'Done Editing';
  ground.set({
    lastMove: undefined,
    check: false,
    autoCastle: false,
    movable: { free: true, color: 'both' },
    draggable: { enabled: true, deleteOnDropOff: true },
    animation: { enabled: false },
  });
  updatePlayerLabels();
  statusBox.className = 'status-box';
  statusBox.textContent = 'Board editor active';
}

function exitEditMode() {
  const existingCastling = chess.fen().split(' ')[2];

  try {
    chess.load(buildEditorFen(ground.getFen(), chess.turn(), existingCastling, ground.state.pieces));
  } catch (err) {
    statusBox.className = 'status-box gameover';
    statusBox.textContent = `Invalid position: ${err.message.replace(/^Invalid FEN:\s*/, '')}.`;
    return;
  }

  editMode = false;
  selectedPiece = null;
  editorPanel.classList.add('hidden');
  btnEditBoard.textContent = 'Edit Board';
  branches = new BranchState(chess.fen());
  updateBranchControls();
  resetAnalysis();
  updateBoard();
  updateMoveHistory();
  updateGameStatus();
  requestEvalOnly();
  checkEngineTurn();
}

function toggleEditMode() {
  if (editMode) {
    exitEditMode();
  } else {
    enterEditMode();
  }
}

// Start a new game
function startNewGame() {
  cancelEngineMove();
  editMode = false;
  selectedPiece = null;
  editorPanel.classList.add('hidden');
  btnEditBoard.textContent = 'Edit Board';
  isEngineThinking = false;
  isMatchPaused = false;
  btnPauseResume.textContent = 'Pause Match';

  chess.reset();
  branches = new BranchState(chess.fen());
  updateBranchControls();
  resetAnalysis();

  // If White is engine and Black is human, orient board for Black
  const whiteConfig = getPlayerConfig('white');
  const blackConfig = getPlayerConfig('black');
  if (whiteConfig.type === 'stockfish' && blackConfig.type === 'human') {
    ground.set({ orientation: 'black' });
  } else {
    ground.set({ orientation: 'white' });
  }

  ground.set({
    fen: chess.fen(),
    turnColor: 'white',
    check: false,
    lastMove: undefined,
  });

  evalBlack.style.height = '50%';
  evalScoreTop.textContent = '0.0';
  evalScoreBottom.textContent = '0.0';

  updateBoard();
  updateMoveHistory();
  updateGameStatus();
  requestEvalOnly();

  checkEngineTurn();
}

// Toggle Pause / Resume
function togglePauseResume() {
  isMatchPaused = !isMatchPaused;
  if (isMatchPaused) cancelEngineMove();
  btnPauseResume.textContent = isMatchPaused ? 'Resume Match' : 'Pause Match';
  updateBoard();
  updateGameStatus();

  if (!isMatchPaused) checkEngineTurn();
}

// Import / Export Functions
function showFeedback(text, isError = false) {
  ioFeedback.textContent = text;
  ioFeedback.className = `modal-feedback ${isError ? 'error' : 'success'}`;
}

function openIoModal() {
  ioTextarea.value = activeBranchPgn() || chess.fen();
  ioFeedback.textContent = '';
  ioModalOverlay.classList.remove('hidden');
}

function closeIoModal() {
  ioModalOverlay.classList.add('hidden');
}

function copyToClipboard(text, successMsg) {
  navigator.clipboard.writeText(text).then(() => {
    showFeedback(successMsg);
  }).catch(() => {
    // Fallback using textarea select
    ioTextarea.value = text;
    ioTextarea.select();
    document.execCommand('copy');
    showFeedback(successMsg);
  });
}

function downloadPgnFile() {
  const pgnContent = activeBranchPgn();
  const blob = new Blob([pgnContent || chess.fen()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stockfish-game-${Date.now()}.pgn`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showFeedback('PGN downloaded.');
}

function loadGameString(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    showFeedback('Input is empty.', true);
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
    showFeedback('Invalid FEN or PGN string.', true);
    return;
  }

  cancelEngineMove();
  resetBranchesFromGame(candidate);
  editMode = false;
  selectedPiece = null;
  resetAnalysis();
  editorPanel.classList.add('hidden');
  btnEditBoard.textContent = 'Edit Board';

  updateBoard();
  updateMoveHistory();
  updateGameStatus();
  requestEvalOnly();

  showFeedback('Game successfully loaded!');
  setTimeout(() => {
    closeIoModal();
    checkEngineTurn();
  }, 600);
}

// Initialize Chessground board and UI bindings
function init() {
  ground = Chessground(boardEl, {
    fen: chess.fen(),
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
      dests: getLegalDests(chess),
      events: {
        after: onUserMove,
      },
    },
    premovable: { enabled: false },
    drawable: { enabled: true },
  });

  // Palette piece placement: intercept mousedown/touchstart in capture phase
  boardEl.addEventListener('mousedown', onBoardPlace, true);
  boardEl.addEventListener('touchstart', onBoardPlace, true);

  // Player type switches
  whiteTypeSelect.addEventListener('change', () => {
    const isEngine = whiteTypeSelect.value === 'stockfish';
    whiteLevelGroup.classList.toggle('hidden', !isEngine);
    cancelEngineMove();
    updateBoard();
    checkEngineTurn();
  });

  blackTypeSelect.addEventListener('change', () => {
    const isEngine = blackTypeSelect.value === 'stockfish';
    blackLevelGroup.classList.toggle('hidden', !isEngine);
    cancelEngineMove();
    updateBoard();
    checkEngineTurn();
  });

  whiteLevelSelect.addEventListener('change', updatePlayerLabels);
  blackLevelSelect.addEventListener('change', updatePlayerLabels);

  // Match buttons
  btnNewGame.addEventListener('click', startNewGame);
  btnPauseResume.addEventListener('click', togglePauseResume);
  btnFlip.addEventListener('click', () => {
    ground.toggleOrientation();
    updatePlayerLabels();
    const currentAnalysis = currentAnalyses().get(chess.history().length)?.data;
    updateEvalBar(currentAnalysis?.eval || { type: 'cp', value: 0 }, currentAnalysis?.turn || chess.turn());
  });
  btnUndo.addEventListener('click', undoMove);
  btnEval.addEventListener('click', requestEvalOnly);
  branchSelect.addEventListener('change', () => selectBranch(branchSelect.value));
  btnBranchStart.addEventListener('click', () => navigateToPly(0));
  toggleAnalysis.addEventListener('change', () => {
    analysisPanel.classList.toggle('hidden', !toggleAnalysis.checked);
  });
  toggleHistoryAnalysis.addEventListener('change', () => {
    historyContainer.classList.toggle('hide-move-analysis', !toggleHistoryAnalysis.checked);
  });
  btnEditBoard.addEventListener('click', toggleEditMode);
  btnEditorDone.addEventListener('click', toggleEditMode);
  btnEditorClear.addEventListener('click', () => ground.set({ fen: '8/8/8/8/8/8/8/8' }));
  btnEditorStart.addEventListener('click', () => ground.set({ fen: 'start' }));
  buildEditorPalette();

  // Modal & I/O
  btnOpenIoModal.addEventListener('click', openIoModal);
  btnIoClose.addEventListener('click', closeIoModal);
  ioModalOverlay.addEventListener('click', (e) => {
    if (e.target === ioModalOverlay) closeIoModal();
  });

  btnDoImport.addEventListener('click', () => loadGameString(ioTextarea.value));
  btnCopyFen.addEventListener('click', () => copyToClipboard(chess.fen(), 'FEN copied to clipboard!'));
  btnCopyPgn.addEventListener('click', () => copyToClipboard(activeBranchPgn() || chess.fen(), 'PGN copied to clipboard!'));
  btnDownloadPgn.addEventListener('click', downloadPgnFile);

  // Quick export buttons in sidebar
  btnQuickExportFen.addEventListener('click', () => {
    navigator.clipboard.writeText(chess.fen());
    statusBox.textContent = 'FEN copied to clipboard!';
    setTimeout(updateGameStatus, 1500);
  });

  btnQuickExportPgn.addEventListener('click', () => {
    navigator.clipboard.writeText(activeBranchPgn() || chess.fen());
    statusBox.textContent = 'PGN copied to clipboard!';
    setTimeout(updateGameStatus, 1500);
  });

  // Initial state
  updateBranchControls();
  updatePlayerLabels();
  updateGameStatus();
  requestEvalOnly();
}

// Start application
init();
