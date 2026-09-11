# systemd user service

The service expects the project at `~/stock-chess` and exposes port 3000 to the network.

## Prepare the application

```bash
cd ~/stock-chess
npm install
npm run build
```

Confirm that `node` is available:

```bash
/usr/bin/env node --version
```

## Install and start

```bash
mkdir -p ~/.config/systemd/user
cp ~/stock-chess/assets/stock-chess.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now stock-chess.service
```

## Check status and logs

```bash
systemctl --user status stock-chess.service
journalctl --user -u stock-chess.service -f
```

Open `http://<computer-ip>:3000` from another computer on the network.

## Apply service-file changes

```bash
cp ~/stock-chess/assets/stock-chess.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart stock-chess.service
```

## Stop and disable

```bash
systemctl --user disable --now stock-chess.service
```
