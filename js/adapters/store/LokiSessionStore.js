// Driven adapter: StateStore port backed by LokiJS (in-memory).
// Every peer keeps a mirror of the session. The host is authoritative: it
// applies actions and broadcasts full snapshots; clients import them.
//
// LokiJS is loaded as a global UMD script (lib/loki.min.js), so we read it
// from window rather than importing it.
import { loadSessionState, saveSessionState } from '../../infra/persistence.js';

export class LokiSessionStore {
  constructor() {
    const Loki = window.loki;
    this.db = new Loki('planningpoker.db');
    this.participants = this.db.addCollection('participants', { unique: ['id'] });
    this.session = this.db.addCollection('session');
    // Resume session-level state across a refresh (round/revealed only -
    // participants are never persisted; the mesh re-syncs the live roster).
    const saved = loadSessionState();
    this.session.insert({
      key: 'state',
      revealed: saved ? saved.revealed : false,
      round: saved ? saved.round : 1
    });
  }

  getSession() {
    return this.session.findOne({ key: 'state' });
  }

  listParticipants() {
    return this.participants.chain().simplesort('joinedAt').data();
  }

  // Apply a single action to the authoritative state (host only).
  applyAction(action) {
    switch (action.type) {
      case 'join': this._upsertParticipant(action.id, action.name); break;
      case 'vote': this._setVote(action.id, action.value); break;
      case 'leave': this._removeParticipant(action.id); break;
      case 'reveal': this._reveal(); break;
      case 'reset': this._reset(); break;
    }
  }

  // Full snapshot for syncing peers.
  exportSnapshot() {
    const s = this.getSession();
    return {
      session: { revealed: s.revealed, round: s.round },
      participants: this.listParticipants().map((p) => ({
        id: p.id,
        name: p.name,
        vote: p.vote,
        hasVoted: p.hasVoted,
        joinedAt: p.joinedAt
      }))
    };
  }

  // Replace local state from a snapshot (clients, and host echoing to itself).
  importSnapshot(snap) {
    if (!snap) return;
    this.participants.clear();
    (snap.participants || []).forEach((p) => this.participants.insert(p));
    const s = this.getSession();
    s.revealed = !!(snap.session && snap.session.revealed);
    s.round = (snap.session && snap.session.round) || 1;
    this.session.update(s);
    this._persistSession();
  }

  // ----------------------------- internals -----------------------------
  _persistSession() {
    const s = this.getSession();
    saveSessionState({ round: s.round, revealed: s.revealed });
  }

  _upsertParticipant(id, name) {
    const existing = this.participants.findOne({ id });
    if (existing) {
      if (name) { existing.name = name; this.participants.update(existing); }
      return existing;
    }
    return this.participants.insert({
      id,
      name: name || 'Anonymous',
      vote: null,
      hasVoted: false,
      joinedAt: Date.now()
    });
  }

  _setVote(id, value) {
    const p = this.participants.findOne({ id });
    if (!p) return;
    p.vote = value;
    p.hasVoted = value !== null && value !== undefined;
    this.participants.update(p);
  }

  _removeParticipant(id) {
    const p = this.participants.findOne({ id });
    if (p) this.participants.remove(p);
  }

  _reveal() {
    const s = this.getSession();
    s.revealed = true;
    this.session.update(s);
    this._persistSession();
  }

  _reset() {
    const s = this.getSession();
    s.revealed = false;
    s.round = (s.round || 1) + 1;
    this.session.update(s);
    this.participants.findAndUpdate({}, (p) => {
      p.vote = null;
      p.hasVoted = false;
      return p;
    });
    this._persistSession();
  }
}
