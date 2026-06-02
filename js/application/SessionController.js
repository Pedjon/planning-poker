// Application core: orchestrates the session use-cases. Depends only on the
// injected ports (store, transport, ui) and the pure domain - never on the
// DOM, WebRTC, or LokiJS directly.
//
// Topology: full mesh with a deterministically-elected coordinator.
//   - The coordinator is the authoritative writer: it applies actions and
//     broadcasts snapshots. Every other peer mirrors those snapshots and routes
//     its own actions to the coordinator.
//   - Election is by seniority: the participant with the earliest joinedAt
//     (tie-broken by id) among the peers currently connected. Because joinedAt
//     rides along in the shared snapshot, every peer computes the same winner.
//     When the coordinator drops, the next-most-senior peer silently takes over
//     with the state it has already been mirroring - no reconnection scramble.
import {
  Actions, actionMsg, syncMsg, helloMsg, rosterMsg,
  isAction, isSync, isHello, isRoster
} from '../domain/messages.js';
import { computeResults } from '../domain/results.js';
import { log } from '../infra/logger.js';
import { getStableId } from '../infra/persistence.js';

function genId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

export class SessionController {
  constructor({ store, transport, ui }) {
    this.store = store;
    this.transport = transport;
    this.ui = ui;

    this.selfId = getStableId(genId); // stable per-tab across refresh
    this.name = '';
    this.role = null;       // 'host' (created the room) or 'join'
    this.net = null;
    this.myVote = undefined;
    this.lastRound = 1;
    this.connected = false;
    this.synced = false;    // a fresh joiner is not authoritative until first sync
    this.peers = new Set(); // ids we hold an open link to
    this.roster = new Map();// id -> name (everyone we know about)
    this._enteredTable = false;
  }

  // ----------------------------- entry points -----------------------------
  // "Host" creates the room: it is the first (and, until someone leaves, the
  // most senior) member, so it starts out as the coordinator.
  host(name) {
    this.name = name;
    this.role = 'host';
    this.synced = true;
    this.roster.set(this.selfId, name);
    log('APP', 'starting as HOST, selfId=' + this.selfId);
    this._initNet();
    this.store.applyAction(Actions.join(this.selfId, this.name));
    this.ui.setStatus('Hosting', 'connected');
    this.ui.goTo('hostSignal');
  }

  // "Join" performs the one manual exchange to reach an existing member; the
  // mesh and the rest of the roster fill in automatically afterwards.
  join(name) {
    this.name = name;
    this.role = 'join';
    this.synced = false;
    this.roster.set(this.selfId, name);
    log('APP', 'starting as JOIN, selfId=' + this.selfId);
    this._initNet();
    this.ui.setStatus('Connecting', 'connecting');
    this.ui.goTo('joinSignal');
  }

  _initNet() {
    this.net = this.transport.init({
      selfId: this.selfId,
      handlers: {
        onMessage: (msg, fromId) => this._onMessage(msg, fromId),
        onPeerOpen: (peerId) => this._onPeerOpen(peerId),
        onPeerClose: (peerId) => this._onPeerClose(peerId)
      }
    });
  }

  // Manual-signaling facade used by the setup UI (first link only).
  acceptJoinRequest(code) { return this.net.acceptManualOffer(code); }
  createJoinRequest() { return this.net.createManualOffer(); }
  submitAnswer(code) { return Promise.resolve(this.net.acceptManualAnswer(code)); }

  // ----------------------------- mesh events -----------------------------
  _onPeerOpen(peerId) {
    log('APP', 'peer link open: ' + peerId);
    this.peers.add(peerId);
    this.connected = true;
    this.ui.setStatus('Connected', 'connected');
    // Announce who I am and what I know, then weave the rest of the mesh.
    this.net.broadcast(helloMsg(this.selfId, this.name));
    this.net.broadcast(rosterMsg(this._rosterArray()));
    this._connectKnownPeers();
    // Coordinator pushes current state so the newcomer renders immediately.
    if (this.amCoordinator()) this._syncAll();
    if (this.role === 'join' && !this._enteredTable) {
      this._enteredTable = true;
      this.ui.goTo('table');
    }
    this.render();
  }

  _onPeerClose(peerId) {
    log('APP', 'peer link closed: ' + peerId);
    this.peers.delete(peerId);
    this.roster.delete(peerId);
    if (this.peers.size === 0) this.connected = false;
    // Whoever is now the most senior survivor removes the departed peer and
    // re-syncs. If the coordinator itself left, this is the silent role swap.
    if (this.amCoordinator()) {
      this.store.applyAction(Actions.leave(peerId));
      this._syncAll();
    }
    this.render();
  }

  _onMessage(msg, fromId) {
    if (isHello(msg)) {
      this.roster.set(msg.id, msg.name);
      this._connectKnownPeers();
      if (this.amCoordinator()) {
        this.store.applyAction(Actions.join(msg.id, msg.name));
        this._syncAll();
        this.render();
      }
      return;
    }
    if (isRoster(msg)) {
      (msg.roster || []).forEach((p) => {
        if (!this.roster.has(p.id)) this.roster.set(p.id, p.name);
      });
      this._connectKnownPeers();
      return;
    }
    if (isAction(msg)) {
      if (this.amCoordinator()) {
        this.store.applyAction(msg.action);
        this._syncAll();
        this.render();
      }
      return;
    }
    if (isSync(msg)) {
      // The coordinator is the source of truth and ignores echoes.
      if (this.amCoordinator()) return;
      this.synced = true;
      this.store.importSnapshot(msg.snapshot);
      this.render();
    }
  }

  // ----------------------------- round actions -----------------------------
  castVote(value) {
    this.myVote = value;
    this._dispatch(Actions.vote(this.selfId, value));
    this.render();
  }

  revealRound() {
    this._dispatch(Actions.reveal());
    this.render();
  }

  resetRound() {
    this.myVote = undefined;
    this._dispatch(Actions.reset());
    this.render();
  }

  // Apply locally when I am authoritative (coordinator, or offline dev/host);
  // otherwise hand the action to the coordinator.
  _dispatch(action) {
    if (!this.net || this.amCoordinator()) {
      this.store.applyAction(action);
      this._syncAll();
    } else {
      this.net.sendTo(this.coordinatorId(), actionMsg(action));
    }
  }

  // ----------------------------- election -----------------------------
  _aliveIds() {
    const alive = new Set(this.peers);
    alive.add(this.selfId);
    return alive;
  }

  // Most senior connected participant: earliest joinedAt, id as tie-breaker.
  coordinatorId() {
    const alive = this._aliveIds();
    const candidates = this.store.listParticipants().filter((p) => alive.has(p.id));
    if (candidates.length) {
      let best = candidates[0];
      for (const p of candidates) {
        if (p.joinedAt < best.joinedAt || (p.joinedAt === best.joinedAt && p.id < best.id)) {
          best = p;
        }
      }
      return best.id;
    }
    // Before any snapshot exists, fall back to the lowest live id.
    return Array.from(alive).sort()[0];
  }

  amCoordinator() {
    if (!this.net) return this.role !== 'join';   // offline dev/host
    if (!this.synced) return false;               // fresh joiner: defer to host
    return this.coordinatorId() === this.selfId;
  }

  // ----------------------------- dev shortcut -----------------------------
  // Jump straight to the room with mock participants and no networking.
  // Driven by js/devConfig.js; intended only for local feature development.
  enterDevRoom(config = {}) {
    this.role = config.role === 'join' ? 'join' : 'host';
    this.name = config.name || 'Dev';
    log('APP', 'entering DEV room (no networking), role=' + this.role);

    this.store.applyAction(Actions.join(this.selfId, this.name));
    (config.mockPeers || []).forEach((peer, i) => {
      const id = 'dev_' + i + '_' + Math.random().toString(36).slice(2, 6);
      this.store.applyAction(Actions.join(id, peer.name || ('Peer ' + (i + 1))));
      if (peer.vote !== null && peer.vote !== undefined) {
        this.store.applyAction(Actions.vote(id, peer.vote));
      }
    });
    if (config.revealed) this.store.applyAction(Actions.reveal());

    this.ui.setStatus('Dev mode', 'connected');
    this.render();
    this.ui.goTo('table');
  }

  // ----------------------------- rendering -----------------------------
  buildViewModel() {
    const session = this.store.getSession();
    if (session.round !== this.lastRound) {
      this.myVote = undefined;
      this.lastRound = session.round;
    }
    const participants = this.store.listParticipants();
    return {
      role: this.amCoordinator() ? 'host' : 'join',
      selfId: this.selfId,
      myVote: this.myVote,
      session,
      participants,
      results: computeResults(participants)
    };
  }

  render() {
    this.ui.render(this.buildViewModel());
  }

  isConnected() {
    return this.connected;
  }

  // ----------------------------- internals -----------------------------
  _rosterArray() {
    return Array.from(this.roster, ([id, name]) => ({ id, name }));
  }

  _connectKnownPeers() {
    this.roster.forEach((_name, id) => {
      if (id !== this.selfId && !this.peers.has(id)) this.net.ensureConnectedTo(id);
    });
  }

  _syncAll() {
    if (this.net && this.amCoordinator()) {
      this.net.broadcast(syncMsg(this.store.exportSnapshot()));
    }
  }
}
