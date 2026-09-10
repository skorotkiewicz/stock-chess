# Stockfish 19 Chess

A web chess game built with Lichess [Chessground](https://github.com/lichess-org/chessground) and native [Stockfish 19](https://github.com/official-stockfish/Stockfish) UCI engine.

<p align="center">
  <img src="screenshot-editor.png" alt="Stockfish 19 Chess Screenshot" width="80%">
</p>

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build client assets and verify Stockfish binary:
   ```bash
   npm run build
   ```

3. Start server:
   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser.

## Features

- **Lichess Chessground Board**: Smooth piece movement, legal destination highlights, and SVG piece set.
- **Stockfish 19 Integration**: Runs local Linux x86-64 binary over the standard UCI protocol.
- **Flexible Player Setup**: Configure White and Black independently as Human or Stockfish 19.
- **Engine vs Engine**: Watch Stockfish play against itself at different difficulty levels.
- **Live Evaluation Bar**: Displays position advantage in centipawns or mate distance.
- **Import and Export**: Load games from FEN or PGN, copy notation to clipboard, or download `.pgn` files.
- **Sound Effects**: Move and capture audio synthesized with the Web Audio API.

## Available Scripts

- `npm start`: Starts the web server at port 3000 (auto-builds if bundle is missing).
- `npm run build`: Bundles client assets with esbuild and downloads Stockfish 19 if missing.
- `npm test`: Runs end-to-end integration tests for build, server, and engine.
- `npm run download:stockfish`: Forces re-downloading the latest Stockfish 19 binary from GitHub.
