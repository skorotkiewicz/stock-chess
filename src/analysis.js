import { Chess } from 'chess.js';

export function formatAnalysisScore(score, turn) {
  if (!score) return '...';
  const value = score.value * (turn === 'w' ? 1 : -1);
  if (score.type === 'mate') return `${value > 0 ? '+' : '-'}M${Math.abs(value)}`;
  return `${value > 0 ? '+' : ''}${(value / 100).toFixed(2)}`;
}

export function uciLineToSan(fen, moves = []) {
  const position = new Chess(fen);
  const san = [];
  for (const uci of moves) {
    try {
      const move = position.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
      if (!move) break;
      san.push(move.san);
    } catch {
      break;
    }
  }
  return san;
}

function whiteExpectation(result) {
  const wdl = result?.analysis?.wdl;
  if (!wdl) return null;
  const rootExpectation = (wdl.win + wdl.draw / 2) / 1000;
  return result.turn === 'w' ? rootExpectation : 1 - rootExpectation;
}

export function classifyMove(before, after, playedMove) {
  if (before?.bestmove === playedMove) return 'Best';
  const beforeWhite = whiteExpectation(before);
  const afterWhite = whiteExpectation(after);
  if (beforeWhite === null || afterWhite === null) return '';

  const loss = Math.max(0, before.turn === 'w'
    ? beforeWhite - afterWhite
    : afterWhite - beforeWhite);

  // ponytail: simple WDL-loss bands; tune against reviewed games if labels feel wrong.
  if (loss <= 0.02) return 'Excellent';
  if (loss <= 0.05) return 'Good';
  if (loss <= 0.10) return 'Inaccuracy';
  if (loss <= 0.20) return 'Mistake';
  return 'Blunder';
}
