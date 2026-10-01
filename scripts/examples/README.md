# Dashboard watch examples

Keep the scdl HTML dashboard (`sdlc dashboard --out …`) fresh while you edit
specs under `openspec/`. These files are **examples** — copy or adapt them; they
are not part of the published `scdl` CLI package surface.

## Files

| File | Purpose |
| --- | --- |
| `dashboard-watch.mjs` | Node watcher / one-shot builder / tiny static server |
| `register-dashboard-task.ps1` | Windows Task Scheduler helper (logon, current user, no window, no time limit); keep it next to `dashboard-watch.mjs` |
| `README.md` | This document |

## Hand-run (`dashboard-watch.mjs`)

From a project that already has `openspec/sdlc.yaml` (after `sdlc init`):

```bash
# Build once
node path/to/scdl/scripts/examples/dashboard-watch.mjs --once

# Watch openspec/ and rebuild on changes
node path/to/scdl/scripts/examples/dashboard-watch.mjs

# Watch + serve with auto-refresh meta tag (response only; disk file unchanged)
node path/to/scdl/scripts/examples/dashboard-watch.mjs --serve 127.0.0.1:0
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--out <file>` | `reports/dashboard.html` | Output path relative to project root |
| `--cli <command>` | `sdlc` | Command used as `<cli> dashboard --out <file>`. May be a quoted multi-token string such as `"C:\\…\\node.exe" "C:\\…\\bin\\sdlc.js"`. |
| `--debounce <ms>` | `1000` | Wait this long after the last `openspec/` event before rebuilding |
| `--min-interval <ms>` | `5000` | Minimum time between two rebuilds |
| `--once` | off | Build once and exit |
| `--serve <host:port>` | off | HTTP-serve the page; `port` `0` picks a free port and prints `http://<host>:<port>/`. Injects `<meta http-equiv="refresh" content="5">` into the **HTTP response only**. |
| `--help` | | Print usage |

Unknown options print usage to stderr and exit `2`. If `openspec/sdlc.yaml` is
not found walking upward from the current working directory, the script exits
`1` with a clear project / `openspec` message.

Rebuild log line example:

```text
12:58:31 rebuilt reports/dashboard.html in 812 ms
```

Stop watch/serve mode with Ctrl+C (SIGINT) or SIGTERM; the script closes
watchers/server, prints `stopped`, and exits `0`.

### Watch details

- Watches `openspec/` recursively (`fs.watch` with `{ recursive: true }` on
  Windows/macOS; on Linux falls back to mtime polling every 1s).
- Ignores noise under `openspec/.sdlc/*.tmp`.
- Debounces events, never runs two builds at once, and queues at most one
  extra rebuild if events arrive during a build.
- Honors `--min-interval` between rebuilds.
- Starts with an initial rebuild; with `--serve` the server opens after it, so the first request
  always gets a page.
- Keep `--out` outside `openspec/`, or every rebuild would trigger the next one.

## Windows Task Scheduler

Register a **hidden** logon task for the current user (review paths first;
do not run blindly in automation):

```powershell
powershell -NoProfile -File scripts\examples\register-dashboard-task.ps1 `
  -ProjectRoot C:\path\to\your\project `
  -Out reports/dashboard.html `
  -Cli sdlc `
  -TaskName scdl-dashboard-watch
```

Unregister:

```powershell
powershell -NoProfile -File scripts\examples\register-dashboard-task.ps1 `
  -TaskName scdl-dashboard-watch `
  -Unregister
```

Parameters: `-ProjectRoot`, `-Out`, `-Cli`, `-TaskName`, `-Unregister`.

## systemd --user (Linux example)

Create `~/.config/systemd/user/scdl-dashboard-watch.service`:

```ini
[Unit]
Description=scdl dashboard HTML watcher

[Service]
Type=simple
WorkingDirectory=%h/projects/my-app
ExecStart=/usr/bin/node /path/to/scdl/scripts/examples/dashboard-watch.mjs --out reports/dashboard.html --cli sdlc
Restart=on-failure

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now scdl-dashboard-watch.service
```

## launchd (macOS example)

Create `~/Library/LaunchAgents/com.example.scdl-dashboard-watch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.scdl-dashboard-watch</string>
  <key>WorkingDirectory</key>
  <string>/Users/you/projects/my-app</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/scdl/scripts/examples/dashboard-watch.mjs</string>
    <string>--out</string>
    <string>reports/dashboard.html</string>
    <string>--cli</string>
    <string>sdlc</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

Load with `launchctl load ~/Library/LaunchAgents/com.example.scdl-dashboard-watch.plist`.

## CI: build dashboard as an artifact (example only)

```yaml
# GitHub Actions sketch — adjust install/compile to your repo
jobs:
  dashboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci && npm run compile
      - run: node bin/sdlc.js dashboard --out reports/dashboard.html
        # Or the example one-shot:
        # node scripts/examples/dashboard-watch.mjs --once --cli "node bin/sdlc.js"
      - uses: actions/upload-artifact@v4
        with:
          name: scdl-dashboard
          path: reports/dashboard.html
```

This is documentation only; wire it into your own pipeline as needed.
