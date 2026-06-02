// Application core: orchestrates the session use-cases. Depends only on the
// injected ports (store, transport, ui) and the pure domain - never on the
// DOM, WebRTC, or LokiJS directly.
import { Actions, actionMsg, syncMsg, isAction, isSync } from '../domain/messages.js';
import { computeResults } from '../domain/results.js';
import { log } from '../infra/logger.js';

function genId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

export class SessionController {
  constructor({ store, transport, ui }) {
    this.store = store;
    this.transport = transport;
    this.ui = ui;

    this.selfId = genId();
    this.name = '';
    this.role = null;
    this.net = null;
    this.myVote = undefined;
    this.lastRound = 1;
    this.connected = false;
  }

  // ----------------------------- Host use-cases -----------------------------
  host(name) {
    this.name = name;
    this.role = 'host';
    log('APP', 'starting as HOST, selfId=' + this.selfId);
    this.net = this.transport.initHost({
      onMessage: (msg, meta) => {
        if (!isAction(msg)) return;
        if (msg.action.type === 'join') meta.participantId = msg.action.id;
        this.store.applyAction(msg.action);
        this._syncAll();
        this.render();
      },
      onOpen: (meta) => { log('APP', 'host: peer channel open #' + meta.id); this._syncAll(); },
      onClose: (meta) => {
        log('APP', 'host: peer channel closed #' + meta.id + ' participant=' + meta.participantId);
        if (meta.participantId) {
          this.store.applyAction(Actions.leave(meta.participantId));
          this._syncAll();
          this.render();
        }
      }
    });
    this.store.applyAction(Actions.join(this.selfId, this.name));
    this.ui.setStatus('Hosting', 'connected');
    this.ui.goTo('hostSignal');
  }

  acceptJoinRequest(code) {
    return this.net.acceptJoinRequest(code);
  }

  // ----------------------------- Join use-cases -----------------------------
  join(name) {
    this.name = name;
    this.role = 'join';
    log('APP', 'starting as JOIN, selfId=' + this.selfId);
    this.net = this.transport.initJoin({
      onMessage: (msg) => {
        if (!isSync(msg)) return;
        this.store.importSnapshot(msg.snapshot);
        this.render();
      },
      onOpen: () => {
        this.connected = true;
        log('APP', 'join: connected, sending join action');
        this.ui.setStatus('Connected', 'connected');
        this.net.send(actionMsg(Actions.join(this.selfId, this.name)));
        this.render();
        this.ui.goTo('table');
      },
      onClose: () => {
        this.connected = false;
        log('APP', 'join: connection closed/failed');
        this.ui.setStatus('Disconnected', 'error');
      }
    });
    this.ui.setStatus('Connecting', 'connecting');
    this.ui.goTo('joinSignal');
  }

  createJoinRequest() {
    return this.net.createRequest();
  }

  submitAnswer(code) {
    return Promise.resolve(this.net.acceptAnswer(code));
  }

  // ----------------------------- Round actions -----------------------------
  castVote(value) {
    this.myVote = value;
    // Host (or local dev room with no transport) mutates state directly;
    // a connected client sends the action to the host.
    if (this.role === 'host' || !this.net) {
      this.store.applyAction(Actions.vote(this.selfId, value));
      this._syncAll();
    } else {
      this.net.send(actionMsg(Actions.vote(this.selfId, value)));
    }
    this.render();
  }

  revealRound() {
    this.store.applyAction(Actions.reveal());
    this._syncAll();
    this.render();
  }

  resetRound() {
    this.store.applyAction(Actions.reset());
    this.myVote = undefined;
    this._syncAll();
    this.render();
  }

  // ----------------------------- Dev shortcut -----------------------------
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

  // ----------------------------- Rendering -----------------------------
  buildViewModel() {
    const session = this.store.getSession();
    if (session.round !== this.lastRound) {
      this.myVote = undefined;
      this.lastRound = session.round;
    }
    const participants = this.store.listParticipants();
    return {
      role: this.role,
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
  _syncAll() {
    if (this.net && this.role === 'host') {
      this.net.broadcast(syncMsg(this.store.exportSnapshot()));
    }
  }
}
