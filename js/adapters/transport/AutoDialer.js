// Builds every link after the manual first one, automatically. SDP travels as
// in-band 'signal' frames flooded across the channels that already exist, so a
// peer can negotiate with someone it is not yet directly connected to. These
// links use trickle ICE: the offer/answer goes out immediately and candidates
// stream as they are gathered.
import { SignalTypes } from '../../domain/messages.js';
import { signalFrame } from './frames.js';
import { warn } from '../../infra/logger.js';

export class AutoDialer {
  constructor({ selfId, registry, router, createLink }) {
    this.selfId = selfId;
    this.registry = registry;
    this.router = router;
    this.createLink = createLink;
    this.dialing = new Set();          // peers we've already started offering to
    this.pendingCandidates = new Map(); // peerId -> [candidate] arrived before the link existed
  }

  forget(peerId) {
    this.dialing.delete(peerId);
  }

  relaySignal(to, body) {
    this.router.emit(signalFrame(this.selfId, to, body));
  }

  // Trickle hook: a local ICE candidate is ready to send to a peer.
  relayCandidate(peerId, candidate) {
    this.relaySignal(peerId, { type: SignalTypes.candidate, candidate });
  }

  // Open a direct link to `peerId` if we don't have one. Deterministic dialer
  // rule avoids offer glare: the peer with the lower id always offers, the other
  // waits for it. The offer goes out immediately (trickle ICE).
  async ensureConnectedTo(peerId) {
    if (peerId === this.selfId || this.registry.has(peerId) || this.dialing.has(peerId)) return;
    if (!(this.selfId < peerId)) return; // higher id waits to be dialed
    this.dialing.add(peerId);
    const link = this.createLink({ peerId, label: 'MESH->' + peerId, trickle: true });
    link.createOutgoingChannel();
    this.registry.add(peerId, link);
    try {
      const offer = await link.createOffer();
      this.relaySignal(peerId, { type: SignalTypes.offer, desc: offer });
    } catch (err) {
      warn('MESH->' + peerId, 'offer failed', err);
    }
  }

  // An in-band signal arrived: an offer to answer, an answer to apply, or a
  // remote ICE candidate to add.
  async handleSignal(from, body) {
    if (body.type === SignalTypes.offer) return this._onOffer(from, body);
    if (body.type === SignalTypes.answer) return this._onAnswer(from, body);
    if (body.type === SignalTypes.candidate) return this._onCandidate(from, body);
  }

  async _onOffer(from, body) {
    let link = this.registry.get(from);
    if (!link) {
      link = this.createLink({ peerId: from, label: 'MESH<-' + from, trickle: true });
      link.expectIncomingChannel();
      this.registry.add(from, link);
    }
    // Hand the link any candidates that arrived ahead of this offer; createAnswer
    // sets the remote description and then flushes them.
    const pending = this.pendingCandidates.get(from);
    if (pending) {
      this.pendingCandidates.delete(from);
      for (const candidate of pending) await link.addRemoteCandidate(candidate);
    }
    try {
      const answer = await link.createAnswer(body.desc);
      this.relaySignal(from, { type: SignalTypes.answer, desc: answer });
    } catch (err) {
      warn('MESH<-' + from, 'answer failed', err);
    }
  }

  async _onAnswer(from, body) {
    const link = this.registry.get(from);
    if (!link || link.signalingState !== 'have-local-offer') return;
    try {
      await link.applyAnswer(body.desc);
    } catch (err) {
      warn('MESH->' + from, 'applying answer failed', err);
    }
  }

  async _onCandidate(from, body) {
    const link = this.registry.get(from);
    if (link) {
      await link.addRemoteCandidate(body.candidate);
    } else {
      // No link yet (the offer hasn't been processed): hold the candidate so
      // _onOffer can apply it once the link is created.
      const buffer = this.pendingCandidates.get(from) || [];
      buffer.push(body.candidate);
      this.pendingCandidates.set(from, buffer);
    }
  }
}
