import { useEffect, useMemo, useRef } from 'octane';
import { useSignal$ } from 'octane/signals/client';
import type { HistoryCell } from './lib/store';
import { ChessStore, PIECE_SYMBOLS, initialSnapshot } from './lib/store';

const PROMOTIONS = [
  { piece: 'q', symbol: '♕', title: 'Queen' },
  { piece: 'r', symbol: '♖', title: 'Rook' },
  { piece: 'b', symbol: '♗', title: 'Bishop' },
  { piece: 'n', symbol: '♘', title: 'Knight' },
];

const PALETTE = ['white', 'black'].flatMap((color) =>
  ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'].map((role) => ({
    color: color as 'white' | 'black',
    role,
    key: `${color}-${role}`,
    symbol: PIECE_SYMBOLS[`${color === 'white' ? 'w' : 'b'} ${role}`],
    title: `${color} ${role}`,
  })),
);

const LEVELS = [
  { value: 1, label: 'Lv 1 (1320)' },
  { value: 2, label: 'Lv 2 (1600)' },
  { value: 3, label: 'Lv 3 (1900)' },
  { value: 4, label: 'Lv 4 (2300)' },
  { value: 5, label: 'Lv 5 (Max)' },
];

function MoveCell({ cell, onSelect }: { cell: HistoryCell | null; onSelect: (ply: number) => void }) @{
  @if (!cell) {
    <td class="move-ply" />
  } @else {
    <td class={['move-ply', cell.active ? 'active' : null, cell.future ? 'future' : null]}>
      <button
        class="move-entry history-move"
        title={`View position after ${cell.san}`}
        onClick={() => onSelect(cell.ply + 1)}
      >
        <span>{cell.san}</span>
        {(cell.evalText || cell.quality) && (
          <span class="move-meta">
            {cell.evalText && <span>{cell.evalText}</span>}
            {cell.quality && (
              <span class={['move-quality', cell.quality.toLowerCase()]}>{cell.quality}</span>
            )}
          </span>
        )}
      </button>
    </td>
  }
}

export function App() @{
  const ui$ = useSignal$(initialSnapshot());
  const store = useMemo(() => new ChessStore((snapshot) => ui$.set(snapshot)), []);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = boardRef.current as HTMLDivElement | null;
    if (el) store.attachBoard(el);
  }, []);

  useEffect(() => {
    const container = historyRef.current as HTMLDivElement | null;
    container?.querySelector('.move-ply.active')?.scrollIntoView({ block: 'nearest' });
  }, [ui$.get().rows]);

  const ui = ui$.get();

  <div class="app">
    <header>
      <div class="brand">
        <h1>Stockfish 19 Chess</h1>
        <span class="badge">Stockfish 19 UCI Ready</span>
      </div>
    </header>

    <main class="main-container">
      <div class="game-area">
        <div class="eval-container" title="Position Evaluation">
          <div class="eval-score top">{ui.evalText}</div>
          <div class="eval-black" style={`height: ${ui.evalBlackPct}%`} />
          <div class="eval-white" />
          <div class="eval-score bottom">{ui.evalText}</div>
        </div>

        <div class="board-container">
          <div class="player-info">
            <div class="player-name">
              <span class={['player-indicator', ui.topColor]} />
              <span>{ui.topName}</span>
            </div>
            <div class="engine-status">{ui.topStatus}</div>
          </div>

          <div class="board-wrapper">
            <div id="board" ref={boardRef} />

            {ui.promotion && (
              <div class="promotion-overlay">
                <div class="promotion-dialog">
                  <h3>Choose promotion piece</h3>
                  <div class="promotion-choices">
                    @for (const p of PROMOTIONS; key p.piece) {
                      <button class="promotion-choice" title={p.title} onClick={() => store.choosePromotion(p.piece)}>
                        {p.symbol}
                      </button>
                    }
                  </div>
                </div>
              </div>
            )}

            {ui.ioOpen && (
              <div
                class="modal-overlay"
                onClick={(e) => {
                  if (e.target === e.currentTarget) store.closeIo();
                }}
              >
                <div class="modal-dialog">
                  <div class="modal-header">
                    <h3>Import / Export Game</h3>
                    <button class="btn-close" onClick={() => store.closeIo()}>
                      ×
                    </button>
                  </div>
                  <p class="modal-help">
                    Paste a FEN position or PGN notation to import, or copy current game notation.
                  </p>
                  <textarea
                    rows={6}
                    value={ui.ioText}
                    onInput={(e) => store.setIoText(e.currentTarget.value)}
                    placeholder="Paste FEN or PGN here..."
                  />
                  {ui.ioFeedback && (
                    <div class={['modal-feedback', ui.ioFeedback.error ? 'error' : 'success']}>
                      {ui.ioFeedback.text}
                    </div>
                  )}
                  <div class="modal-actions">
                    <button class="primary" onClick={() => store.loadGameString(ui.ioText)}>
                      Load Game
                    </button>
                    <button onClick={() => store.copyFen()}>Copy FEN</button>
                    <button onClick={() => store.copyPgn()}>Copy PGN</button>
                    <button onClick={() => store.downloadPgn()}>Download PGN</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div class="player-info">
            <div class="player-name">
              <span class={['player-indicator', ui.bottomColor]} />
              <span>{ui.bottomName}</span>
            </div>
            <div class="engine-status">{ui.bottomStatus}</div>
          </div>
        </div>
      </div>

      <aside class="sidebar">
        <div class="panel">
          <div class="panel-title">Players Setup</div>

          <div class="player-setup-row">
            <div class="form-group flex-1">
              <label for="whiteTypeSelect">White</label>
              <select
                id="whiteTypeSelect"
                value={ui.whiteType}
                onChange={(e) => store.setWhiteType(e.currentTarget.value as 'human' | 'stockfish')}
              >
                <option value="human">Human</option>
                <option value="stockfish">Stockfish 19</option>
              </select>
            </div>
            {ui.whiteType === 'stockfish' && (
              <div class="form-group flex-1">
                <label for="whiteLevelSelect">White Level</label>
                <select
                  id="whiteLevelSelect"
                  value={ui.whiteLevel}
                  onChange={(e) => store.setWhiteLevel(Number(e.currentTarget.value))}
                >
                  @for (const level of LEVELS; key level.value) {
                    <option value={level.value}>{level.label}</option>
                  }
                </select>
              </div>
            )}
          </div>

          <div class="player-setup-row">
            <div class="form-group flex-1">
              <label for="blackTypeSelect">Black</label>
              <select
                id="blackTypeSelect"
                value={ui.blackType}
                onChange={(e) => store.setBlackType(e.currentTarget.value as 'human' | 'stockfish')}
              >
                <option value="human">Human</option>
                <option value="stockfish">Stockfish 19</option>
              </select>
            </div>
            {ui.blackType === 'stockfish' && (
              <div class="form-group flex-1">
                <label for="blackLevelSelect">Black Level</label>
                <select
                  id="blackLevelSelect"
                  value={ui.blackLevel}
                  onChange={(e) => store.setBlackLevel(Number(e.currentTarget.value))}
                >
                  @for (const level of LEVELS; key level.value) {
                    <option value={level.value}>{level.label}</option>
                  }
                </select>
              </div>
            )}
          </div>

          <div class={['status-box', ui.statusKind !== 'normal' ? ui.statusKind : null]}>
            {ui.statusText}
          </div>

          <div class="btn-group">
            <button class="primary" onClick={() => store.newGame()}>
              New Game
            </button>
            <button onClick={() => store.togglePauseResume()}>{ui.paused ? 'Resume Match' : 'Pause Match'}</button>
            <button onClick={() => store.flip()}>Flip Board</button>
            <button onClick={() => store.undoMove()}>Takeback</button>
            <button onClick={() => store.toggleEditMode()}>{ui.editMode ? 'Done Editing' : 'Edit Board'}</button>
          </div>
        </div>

        {ui.editMode && (
          <div class="panel">
            <div class="panel-title">Board Editor</div>
            <div class="editor-palette">
              @for (const piece of PALETTE; key piece.key) {
                <button
                  class={[
                    'editor-piece-btn',
                    ui.editorSelected?.color === piece.color && ui.editorSelected?.role === piece.role ? 'active' : null,
                  ]}
                  data-color={piece.color}
                  title={piece.title}
                  onClick={() => store.selectEditorPiece(piece.color, piece.role)}
                >
                  {piece.symbol}
                </button>
              }
            </div>
            <p class="modal-help">
              Pick a piece, then click a square to place it. Drag pieces off the board to remove them.
            </p>
            <div class="btn-group">
              <button class="primary" onClick={() => store.toggleEditMode()}>
                Done
              </button>
              <button onClick={() => store.editorClear()}>Clear Board</button>
              <button onClick={() => store.editorStart()}>Start Position</button>
            </div>
          </div>
        )}

        <div class="panel">
          <div class="panel-title">Game Tools</div>
          <div class="btn-group">
            <button onClick={() => store.openIo()}>Import / Export</button>
            <button onClick={() => store.quickExportPgn()}>Export PGN</button>
            <button onClick={() => store.quickExportFen()}>Export FEN</button>
            <button onClick={() => store.requestEvalOnly()}>Update Eval</button>
          </div>
          <label class="analysis-toggle" for="toggleAnalysis">
            <input
              type="checkbox"
              id="toggleAnalysis"
              checked={ui.showAnalysis}
              onChange={(e) => store.setShowAnalysis(e.currentTarget.checked)}
            />
            Show engine analysis
          </label>
          <label class="analysis-toggle" for="toggleHistoryAnalysis">
            <input
              type="checkbox"
              id="toggleHistoryAnalysis"
              checked={ui.showMoveAnalysis}
              onChange={(e) => store.setShowMoveAnalysis(e.currentTarget.checked)}
            />
            Show move analysis
          </label>
        </div>

        {ui.showAnalysis && (
          <div class="panel">
            <div class="panel-title">Engine Analysis</div>
            {ui.analysis.message ? (
              <div class="analysis-empty" aria-live="polite">
                {ui.analysis.message}
              </div>
            ) : (
              <div>
                <div class="analysis-primary">
                  <span class="analysis-eval">{ui.analysis.evalText}</span>
                  <span class="analysis-wdl">{ui.analysis.wdlText}</span>
                </div>
                <div class="analysis-stats">{ui.analysis.statsText}</div>
                <div class="analysis-moves">
                  <div>
                    <span>Best</span>
                    <strong>{ui.analysis.best}</strong>
                  </div>
                  <div>
                    <span>Ponder</span>
                    <strong>{ui.analysis.ponder}</strong>
                  </div>
                </div>
                <div class="analysis-lines">
                  @for (const line of ui.analysis.lines ?? []; key line.n) {
                    <div class="analysis-line">
                      <span class="analysis-line-number">{`${line.n}.`}</span>
                      <span class="analysis-line-score">{line.score}</span>
                      <span>{line.moves}</span>
                    </div>
                  }
                </div>
              </div>
            )}
          </div>
        )}

        <div class="panel">
          <div class="panel-title">Move History</div>
          {!ui.branchHidden && (
            <div class="branch-controls">
              <label for="branchSelect">Branch</label>
              <select
                id="branchSelect"
                value={ui.branchActiveId}
                onChange={(e) => store.selectBranch(e.currentTarget.value)}
              >
                @for (const branch of ui.branchItems; key branch.id) {
                  <option value={branch.id}>{branch.name}</option>
                }
              </select>
              <button onClick={() => store.navigateToPly(0)}>Start</button>
            </div>
          )}
          {ui.branchStatus && <div class="branch-status">{ui.branchStatus}</div>}
          <div
            class={['history-container', ui.showMoveAnalysis ? null : 'hide-move-analysis']}
            ref={historyRef}
          >
            <table class="history-table">
              <tbody>
                @for (const row of ui.rows; key `${row.num}-${row.white?.ply ?? 'empty'}`) {
                  <tr>
                    <td class="move-num">{row.num}</td>
                    <MoveCell cell={row.white} onSelect={(ply) => store.navigateToPly(ply)} />
                    <MoveCell cell={row.black} onSelect={(ply) => store.navigateToPly(ply)} />
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </main>
  </div>
}
