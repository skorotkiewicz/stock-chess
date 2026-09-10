import { Chessground } from 'chessground';
import { Chess } from 'chess.js';

// State
let chess = new Chess();
let ground = null;
let playerColor = 'white';
let isEngineThinking = false;
let pendingPromotion = null;

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
const difficultySelect = document.getElementById('difficultySelect');
const colorSelect = document.getElementById('colorSelect');
const btnNewGame = document.getElementById('btnNewGame');
const btnFlip = document.getElementById('btnFlip');
const btnUndo = document.getElementById('btnUndo');
const btnEval = document.getElementById('btnEval');
const evalBlack = document.getElementById('evalBlack');
const evalScoreTop = document.getElementById('evalScoreTop');
const evalScoreBottom = document.getElementById('evalScoreBottom');
const topPlayerName = document.getElementById('topPlayerName');
const topIndicator = document.getElementById('topIndicator');
const topPlayerStatus = document.getElementById('topPlayerStatus');
const bottomPlayerName = document.getElementById('bottomPlayerName');
const bottomIndicator = document.getElementById('bottomIndicator');
const bottomPlayerStatus = document.getElementById('bottomPlayerStatus');
const promotionOverlay = document.getElementById('promotionOverlay');
const promotionChoices = document.getElementById('promotionChoices');

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

// Convert score object to White's perspective percentage
function scoreToWhitePercent(score, currentTurn) {
  if (!score) return 50;
  // UCI score is relative to side to move
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

  const displayScore = score.type === 'mate'
    ? `M${Math.abs(score.value)}`
    : (score.value / 100).toFixed(1);

  const formattedScore = score.type === 'mate'
    ? (score.value > 0 ? `+M${score.value}` : `-M${Math.abs(score.value)}`)
    : (score.value > 0 ? `+${displayScore}` : displayScore);

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

// Update board state in Chessground
function updateBoard() {
  const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
  const isPlayerTurn = currentTurn === playerColor && !isEngineThinking && !chess.isGameOver();

  ground.set({
    fen: chess.fen(),
    turnColor: currentTurn,
    check: chess.inCheck(),
    movable: {
      color: isPlayerTurn ? playerColor : undefined,
      dests: isPlayerTurn ? getLegalDests(chess) : new Map(),
    },
  });

  updatePlayerLabels();
}

// Update player labels and turn status
function updatePlayerLabels() {
  const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
  const engineColor = playerColor === 'white' ? 'black' : 'white';

  if (playerColor === 'white') {
    topPlayerName.textContent = 'Stockfish 19';
    topIndicator.className = 'player-indicator black';
    bottomPlayerName.textContent = 'You (White)';
    bottomIndicator.className = 'player-indicator white';
  } else {
    topPlayerName.textContent = 'Stockfish 19';
    topIndicator.className = 'player-indicator white';
    bottomPlayerName.textContent = 'You (Black)';
    bottomIndicator.className = 'player-indicator black';
  }

  if (chess.isGameOver()) {
    topPlayerStatus.textContent = 'Game finished';
    bottomPlayerStatus.textContent = 'Game finished';
  } else if (isEngineThinking) {
    topPlayerStatus.textContent = 'Thinking...';
    bottomPlayerStatus.textContent = 'Waiting';
  } else if (currentTurn === playerColor) {
    topPlayerStatus.textContent = 'Waiting';
    bottomPlayerStatus.textContent = 'Your turn';
  } else {
    topPlayerStatus.textContent = 'Thinking...';
    bottomPlayerStatus.textContent = 'Waiting';
  }
}

// Update game status box
function updateGameStatus() {
  statusBox.className = 'status-box';
  if (chess.isCheckmate()) {
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
  } else {
    const side = chess.turn() === 'w' ? 'White' : 'Black';
    if (isEngineThinking) {
      statusBox.textContent = 'Stockfish is calculating...';
    } else {
      statusBox.textContent = `${side} to move`;
    }
  }
}

// Render move history
function updateMoveHistory() {
  const history = chess.history();
  historyBody.innerHTML = '';
  for (let i = 0; i < history.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const whiteMove = history[i] || '';
    const blackMove = history[i + 1] || '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="move-num">${moveNum}.</td>
      <td class="move-ply ${i === history.length - 1 ? 'active' : ''}">${whiteMove}</td>
      <td class="move-ply ${i + 1 === history.length - 1 ? 'active' : ''}">${blackMove}</td>
    `;
    historyBody.appendChild(tr);
  }
  historyContainer.scrollTop = historyContainer.scrollHeight;
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

// Execute a move in the game
function executeMove(orig, dest, promotion) {
  try {
    const move = chess.move({ from: orig, to: dest, promotion });
    if (!move) {
      updateBoard();
      return;
    }

    // Play corresponding sound
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

    // Trigger Stockfish if not game over and it is engine's turn
    const nextTurn = chess.turn() === 'w' ? 'white' : 'black';
    if (!chess.isGameOver() && nextTurn !== playerColor) {
      requestEngineMove();
    }
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

// Request Stockfish move from backend API
async function requestEngineMove() {
  if (isEngineThinking || chess.isGameOver()) return;
  isEngineThinking = true;
  updatePlayerLabels();
  updateGameStatus();

  const level = parseInt(difficultySelect.value, 10) || 3;
  const fen = chess.fen();

  try {
    const res = await fetch('/api/stockfish/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, level }),
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data = await res.json();
    isEngineThinking = false;

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

    if (data.eval) {
      updateEvalBar(data.eval, chess.turn());
    }

    updateBoard();
    updateMoveHistory();
    updateGameStatus();
  } catch (err) {
    console.error('Stockfish request failed:', err);
    isEngineThinking = false;
    updateBoard();
    updateGameStatus();
  }
}

// Request position evaluation only
async function requestEvalOnly() {
  if (isEngineThinking) return;
  try {
    const res = await fetch('/api/stockfish/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: chess.fen() }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.eval) {
        updateEvalBar(data.eval, chess.turn());
      }
    }
  } catch (err) {
    console.error('Eval request failed:', err);
  }
}

// Undo move (takes back 2 plies when playing against engine)
function undoMove() {
  if (isEngineThinking) return;
  const history = chess.history();
  if (history.length === 0) return;

  const currentTurn = chess.turn() === 'w' ? 'white' : 'black';
  if (currentTurn === playerColor && history.length >= 2) {
    chess.undo();
    chess.undo();
  } else {
    chess.undo();
  }

  ground.set({
    lastMove: undefined,
  });

  updateBoard();
  updateMoveHistory();
  updateGameStatus();
  requestEvalOnly();
}

// Start a new game
function startNewGame() {
  if (isEngineThinking) return;
  chess.reset();

  const selectedColor = colorSelect.value;
  if (selectedColor === 'random') {
    playerColor = Math.random() < 0.5 ? 'white' : 'black';
  } else {
    playerColor = selectedColor;
  }

  ground.set({
    fen: chess.fen(),
    orientation: playerColor,
    turnColor: 'white',
    check: false,
    lastMove: undefined,
    movable: {
      color: playerColor === 'white' ? 'white' : undefined,
      dests: playerColor === 'white' ? getLegalDests(chess) : new Map(),
    },
  });

  evalBlack.style.height = '50%';
  evalScoreTop.textContent = '0.0';
  evalScoreBottom.textContent = '0.0';

  updatePlayerLabels();
  updateMoveHistory();
  updateGameStatus();

  // If player chose black, Stockfish makes the first move
  if (playerColor === 'black') {
    requestEngineMove();
  }
}

// Initialize Chessground board
function init() {
  ground = Chessground(boardEl, {
    fen: chess.fen(),
    orientation: playerColor,
    turnColor: 'white',
    coordinates: true,
    animation: {
      enabled: true,
      duration: 200,
    },
    movable: {
      color: playerColor,
      free: false,
      dests: getLegalDests(chess),
      events: {
        after: onUserMove,
      },
    },
    premovable: { enabled: false },
    drawable: { enabled: true },
  });

  btnNewGame.addEventListener('click', startNewGame);
  btnFlip.addEventListener('click', () => {
    ground.toggleOrientation();
    updateEvalBar({ type: 'cp', value: 0 }, chess.turn());
  });
  btnUndo.addEventListener('click', undoMove);
  btnEval.addEventListener('click', requestEvalOnly);

  // Initial UI state
  updatePlayerLabels();
  updateGameStatus();
  requestEvalOnly();
}

// Start application
init();
