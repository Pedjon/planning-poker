# Planning Poker

A serverless, peer-to-peer [planning poker](https://en.wikipedia.org/wiki/Planning_poker) app. Teams estimate work by voting with cards; everyone reveals at once. There is **no backend and no database** - peers connect directly to each other over **WebRTC** data channels, and session state is kept in-memory with [LokiJS](https://github.com/techfort/LokiJS) and synced peer-to-peer.

Built with plain ES modules and a small, light-hexagonal architecture. No framework, no build step.

## Features

- Peer-to-peer over WebRTC data channels (no signaling/app server you run)
- In-memory session state via LokiJS, synced to all peers
- Fibonacci deck: `0, 1, 2, 3, 5, 8, 13, 21, ?`
- Hidden votes until the host reveals; average and consensus on reveal
- Dark, framework-free UI
- Built-in connection diagnostics in the browser console

## Quick start (local)

WebRTC needs a secure context, so serve over `http://localhost` (not `file://`).

Using Docker:

```bash
docker compose up -d --build
# open http://localhost:8000
```

Or any static server, e.g. Python:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Then, in two browser tabs/windows:

1. Tab A: enter a name, click **Host a session**.
2. Tab B: enter a name, click **Join a session** -> **Generate request code**, and send that code to the host.
3. Tab A: paste the request -> **Generate response code**, send it back.
4. Tab B: paste the response -> **Connect**. You're in.

See [docs/usage and deployment](docs/deployment.md) for hosting it publicly (GitHub Pages, etc.).

## How it works (in one paragraph)

Peers form a **full mesh**. Only the **first** link into a session needs a manual copy-paste exchange of WebRTC codes (offer/answer); after that, peers gossip a roster and negotiate every remaining link automatically with in-band signaling. A deterministically-elected **coordinator** (the most senior connected peer) owns the authoritative session state in LokiJS: peers send actions (vote, reveal) to it, and it broadcasts a full state **snapshot** that everyone mirrors and re-renders. Because all links already exist, losing the coordinator is a silent role swap rather than a reconnect. Full details and diagrams in [docs/webrtc.md](docs/webrtc.md).

```mermaid
flowchart TB
  A(("A (coordinator)"))
  B["Peer B"]
  C["Peer C"]
  A <-->|"manual first link"| B
  A <-->|"auto, in-band"| C
  B <-->|"auto, in-band"| C
```

## Project structure

```
index.html                  markup + view containers
styles.css                  dark theme
lib/loki.min.js             vendored LokiJS (global script)
js/
  main.js                   composition root + DOM event wiring
  domain/                   pure rules (deck, results, messages)
  application/              SessionController (use-cases, routing, state)
  adapters/
    store/                  LokiSessionStore (StateStore port)
    transport/              WebRTC: iceConfig, signaling, diagnostics, WebRtcTransport
  ui/                       elements registry + UiAdapter (rendering)
  infra/                    logger
Dockerfile, docker-compose.yml
docs/                       architecture, webrtc, deployment
```

## Documentation

- [docs/architecture.md](docs/architecture.md) - the hexagonal layering, ports, and module responsibilities
- [docs/webrtc.md](docs/webrtc.md) - how WebRTC is used: signaling, ICE/STUN/TURN, data channels, sync, troubleshooting
- [docs/deployment.md](docs/deployment.md) - running locally, Docker, and GitHub Pages
- [docs/reconnection-analysis.md](docs/reconnection-analysis.md) - exploratory notes on serverless reconnection / surviving host loss

## Limitations

- **NAT traversal**: serverless WebRTC can't connect every network pair. Same easy/cone NATs connect via STUN; symmetric NAT / strict firewalls / corporate VPNs need a reachable **TURN** relay (see [docs/webrtc.md](docs/webrtc.md#nat-stun-and-turn)).
- **Coordinator handoff, not persistence**: if the coordinator's tab closes, the mesh elects the next-most-senior peer and the session continues - but if *everyone* leaves, in-memory state is gone (persistence is a planned follow-up).
- **Manual signaling for the first link**: the first person to join still does one copy-paste exchange; every link after that is automatic.
- **Mesh cost**: `O(n^2)` connections - fine for a planning-poker team, not for large groups.

## License

MIT (or your preference).
