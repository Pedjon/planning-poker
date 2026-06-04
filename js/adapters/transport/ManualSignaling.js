// The one link a human sets up by hand: copy-paste offer/answer codes. There is
// no channel yet to trickle over, so this link is non-trickle - it waits for ICE
// gathering and bundles every candidate into a single code.
//
// Each invite carries a nonce and stays in pendingOffers, so the host can hand
// out several invites at once and match each response back to the exact offer
// that produced it (with a fallback to the sole pending offer for nonce-less
// legacy codes).
import { SignalTypes } from '../../domain/messages.js';
import { encode, decode } from './signaling.js';
import { nextNonce } from './frames.js';
import { log } from '../../infra/logger.js';

export class ManualSignaling {
  constructor({ selfId, registry, createLink }) {
    this.selfId = selfId;
    this.registry = registry;
    this.createLink = createLink;
    this.pendingOffers = new Map(); // nonce -> PeerLink (offer awaiting its answer)
  }

  // Host: mint an invite. The channel is created now but wired only once the
  // answer arrives, so onPeerOpen fires against the real remote id.
  async createManualOffer() {
    const nonce = nextNonce();
    const label = 'MANUAL(offer:' + nonce + ')';
    const link = this.createLink({ peerId: 'offer:' + nonce, label, trickle: false });
    link.createDataChannel();
    this.pendingOffers.set(nonce, link);
    log(label, 'creating offer');
    await link.createOffer();
    await link.waitForIceComplete();
    return encode({ id: this.selfId, nonce, desc: link.localDescription });
  }

  // Host: apply a joiner's response to finish that connection. Resolves (never
  // rejects) when the response matches no live invite, so the caller can tell a
  // reused/expired invite apart from a malformed code.
  async acceptManualAnswer(code) {
    const env = decode(code);
    if (!env || !env.desc || env.desc.type !== 'answer') {
      throw new Error('That code is not a response code.');
    }
    // Match by nonce; fall back to the sole outstanding offer so a nonce-less
    // legacy code still connects.
    let key = env.nonce;
    if (key == null && this.pendingOffers.size === 1) {
      key = this.pendingOffers.keys().next().value;
    }
    const link = key != null ? this.pendingOffers.get(key) : null;
    if (!link) return { applied: false, reason: 'no matching pending invite' };
    if (link.signalingState !== 'have-local-offer') {
      return { applied: false, state: link.signalingState };
    }

    const remoteId = env.id;
    this.pendingOffers.delete(key);
    link.peerId = remoteId; // adopt the real id now that we know who answered
    link.label = 'MANUAL<->' + remoteId;
    link.wireChannel();
    this.registry.add(remoteId, link);
    log('MANUAL(offer)', 'applying answer from ' + remoteId);
    await link.applyAnswer(env.desc);
    return { applied: true, id: remoteId };
  }

  // Joiner: accept the host's invite and produce a response code to send back.
  async acceptManualOffer(code) {
    const env = decode(code);
    if (!env || !env.desc || env.desc.type !== 'offer') {
      throw new Error('That code is not a request code.');
    }
    const remoteId = env.id;
    const label = 'MANUAL<-' + remoteId;
    const link = this.createLink({ peerId: remoteId, label, trickle: false });
    link.expectIncomingChannel();
    this.registry.add(remoteId, link);
    log(label, 'remote offer received; creating answer');
    await link.createAnswer(env.desc);
    await link.waitForIceComplete();
    // Echo the invite's nonce back so the host can match this response.
    return encode({ id: this.selfId, nonce: env.nonce, desc: link.localDescription });
  }
}
