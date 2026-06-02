# Running and deploying

The app is 100% static (HTML, CSS, vendored LokiJS, ES modules). It needs no build step. The only hard requirement is a **secure context**: WebRTC runs on `https://` or `http://localhost`, but **not** from a `file://` double-click (and ES modules also require http(s)).

## Run locally

### Docker (recommended)

```bash
docker compose up -d --build   # start at http://localhost:8000
docker compose stop            # stop
docker compose start           # start again
docker compose down            # remove the container
docker compose logs -f         # follow logs
```

The compose file bind-mounts the source read-only, so editing files just needs a browser refresh (no rebuild). See [Dockerfile](../Dockerfile) and [docker-compose.yml](../docker-compose.yml).

### Any static server

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```

(Anything that serves static files works: `npx serve`, nginx, etc.)

## Deploy to GitHub Pages

This repo is set up for branch-based Pages (no workflow needed). A `.nojekyll` file at the root makes Pages serve the `js/`, `lib/`, and nested folders as-is.

1. Push:
   ```bash
   git push -u origin master
   ```
2. In the repo: **Settings -> Pages -> Build and deployment -> Source: Deploy from a branch**, choose **master** and **/ (root)**, then **Save**.
3. After ~1-2 minutes the site is live at `https://<user>.github.io/<repo>/` (for this repo: `https://pedjon.github.io/planning-poker/`).

All asset paths are relative, so the project subpath works without changes. Pages serves over HTTPS, satisfying WebRTC's secure-context requirement.

## Other free static hosts

Any of these work with zero config (drag-and-drop or connect the repo) and provide HTTPS:

- Netlify (incl. drag-and-drop "Drop")
- Cloudflare Pages
- Vercel
- Surge.sh (`npx surge`)

## Making peer connections reliable (TURN)

Hosting only delivers the files over HTTPS - it does not solve NAT traversal. On easy/cone networks, STUN is enough. On symmetric NAT, strict firewalls, or corporate VPNs you need a reachable **TURN** relay.

The bundled free Open Relay endpoint in [js/adapters/transport/iceConfig.js](../js/adapters/transport/iceConfig.js) may be blocked on some networks. For dependable cross-network use:

1. Get free TURN credentials (e.g. [metered.ca](https://metered.ca)).
2. Replace the `username`/`credential` on the `turn:` entries in `iceConfig.js`.

To validate the app end-to-end, test from two ordinary networks (for example a phone on cellular and a laptop on home Wi-Fi), not a restrictive VPN. See [webrtc.md](webrtc.md#troubleshooting) for reading the connection logs.
