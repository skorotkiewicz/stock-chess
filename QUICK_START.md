# Quick start and deployment

## Local setup

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

## Scripts

- `npm start` starts the web server on port 3000. It builds the bundle first if the bundle is missing.
- `npm run build` bundles the client assets with esbuild. It also downloads the pinned Stockfish 19 binary if the binary is missing.
- `npm test` runs the integration tests for the app, the server, and the engine.
- `npm run stockfish` downloads Stockfish 19 if the binary is missing.
- `npm run download:stockfish` downloads and verifies a fresh Stockfish 19 binary for the current platform.

The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` to allow access from the network.
Set `STOCKFISH_PATH` to use another Stockfish binary, or a binary for an unsupported platform.

## Docker

Run with Docker Compose:

```bash
docker compose -f assets/docker/compose.yml up -d --build
```

Or build and run the image directly:

```bash
docker build -f assets/docker/Dockerfile -t stock-chess .
docker run -d -p 3000:3000 --name stock-chess stock-chess
```

## systemd user service

Put the project at `~/stock-chess`. Then install and start the user service:

```bash
mkdir -p ~/.config/systemd/user
cp ~/stock-chess/assets/stock-chess.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now stock-chess.service
```

Check the status and the logs:

```bash
systemctl --user status stock-chess.service
journalctl --user -u stock-chess.service -f
```

Stop and disable the service:

```bash
systemctl --user disable --now stock-chess.service
```
