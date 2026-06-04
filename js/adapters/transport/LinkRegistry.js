// The set of direct links this peer holds, keyed by peer id. Owns the single
// place a link is torn down: remove() is idempotent, so the two independent death
// signals (connectionState failed/closed and channel.onclose) collapse into
// exactly one onPeerClose per peer.

export class LinkRegistry {
  constructor({ onPeerClose }) {
    this.onPeerClose = onPeerClose;
    this.links = new Map(); // peerId -> PeerLink
  }

  add(peerId, link) {
    this.links.set(peerId, link);
  }

  get(peerId) {
    return this.links.get(peerId);
  }

  has(peerId) {
    return this.links.has(peerId);
  }

  forEach(fn) {
    this.links.forEach(fn);
  }

  ids() {
    return Array.from(this.links.keys());
  }

  remove(peerId) {
    const link = this.links.get(peerId);
    if (!link) return; // already gone: don't fire onPeerClose twice
    this.links.delete(peerId);
    link.close();
    if (this.onPeerClose) this.onPeerClose(peerId);
  }
}
