# Quick Start & Deployment

## Local Setup

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

## Available Scripts

- `npm run start`: Starts the web server at port 3000 (auto-builds if bundle is missing).
- `npm run build`: Bundles client assets with esbuild and downloads the pinned Stockfish 19 binary if missing.
- `npm run test`: Runs integration tests for the app, server, and engine.
- `npm run stockfish`: Downloads Stockfish 19 if it is missing.
- `npm run download:stockfish`: Downloads and verifies a fresh Stockfish 19 binary for the current platform.

The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` to allow network access.
Set `STOCKFISH_PATH` to use another Stockfish binary or an unsupported platform.

## Docker

Run with Docker Compose:

```bash
docker compose -f assets/docker/compose.yml up -d --build
```

Or build and run directly:

```bash
docker build -f assets/docker/Dockerfile -t stock-chess .
docker run -d -p 3000:3000 --name stock-chess stock-chess
```

## systemd user service

Place the project at `~/stock-chess`, then install and start the user service:

```bash
mkdir -p ~/.config/systemd/user
cp ~/stock-chess/assets/stock-chess.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now stock-chess.service
```
