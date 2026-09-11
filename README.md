# Stockfish 19 chess

A web chess game. It uses Lichess [Chessground](https://github.com/lichess-org/chessground) for the board and a native [Stockfish 19](https://github.com/official-stockfish/Stockfish) engine over the UCI protocol.

<p align="center">
  <img src="assets/screenshot-editor.png" alt="Stockfish 19 chess screenshot" width="80%">
</p>

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the client assets and verify the Stockfish binary:

   ```bash
   npm run build
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in a browser.

See [QUICK_START.md](QUICK_START.md) for all scripts, Docker, and systemd instructions.

## Features

- Lichess Chessground board. Pieces move smoothly and the board highlights legal moves.
- Stockfish 19 runs as a native binary on Linux, macOS, or Windows.
- White and Black are each a human or Stockfish 19. You choose per side.
- Engine vs engine mode. Stockfish plays against itself at different levels.
- An evaluation bar shows the advantage in centipawns or moves to mate.
- Load games as FEN or PGN. The parser keeps PGN variations. You can copy the notation or download a `.pgn` file.
- Move and capture sounds. The Web Audio API makes the audio.

## License

GPL-3.0-or-later. Stockfish and Chessground are also GPL-3.0.
