// Driven adapter: the Transport port over raw WebRTC data channels.
//
// Topology: full mesh. The very first link between two peers is set up by hand
// with copy-paste offer/answer codes (ManualSignaling) - the only step a human
// performs. After that, every other link is negotiated automatically with in-band
// signaling (AutoDialer): SDP offers/answers travel as flooded 'signal' frames
// across the channels that already exist, so a peer can reach someone it is not
// yet directly connected to. Once a direct link is up, traffic flows point to
// point.
//
// This file is just the composition root. Each responsibility lives in its own
// module and they are wired together here:
//   frames          - the wire envelope, ids, and frame builders (pure)
//   SeenCache       - dedupes flooded frames / stops loops
//   PeerLink        - one RTCPeerConnection + data channel (negotiation, ICE)
//   LinkRegistry    - the set of direct links; single-fire teardown
//   MeshRouter      - flood / relay / consume; app broadcast & sendTo
//   AutoDialer      - automatic in-band (trickle) link negotiation
//   ManualSignaling - the manual copy-paste first link (non-trickle)
//   Keepalive       - periodic pings to keep links and NAT bindings warm
import { SeenCache } from './SeenCache.js';
import { PeerLink } from './PeerLink.js';
import { LinkRegistry } from './LinkRegistry.js';
import { MeshRouter } from './MeshRouter.js';
import { AutoDialer } from './AutoDialer.js';
import { ManualSignaling } from './ManualSignaling.js';
import { Keepalive } from './Keepalive.js';

export class WebRtcTransport {
  // Spin up the mesh for this peer. `handlers`:
  //   onMessage(appMsg, fromId) - an application frame arrived
  //   onPeerOpen(peerId)        - a direct data channel opened
  //   onPeerClose(peerId)       - a direct link failed/closed
  init({ selfId, handlers }) {
    const seen = new SeenCache();
    const registry = new LinkRegistry({ onPeerClose: handlers.onPeerClose });

    // Late-bound so the router can hand signal frames to the dialer and the
    // link factory can stream trickle candidates through it.
    let dialer;

    const router = new MeshRouter({
      selfId,
      registry,
      seen,
      onAppMessage: handlers.onMessage,
      onSignal: (from, body) => dialer.handleSignal(from, body)
    });

    // Build a PeerLink with the shared lifecycle hooks. onClose runs through the
    // registry (idempotent) and clears any dialing state for that peer.
    const createLink = ({ peerId, label, trickle }) => new PeerLink({
      peerId,
      label,
      trickle,
      hooks: {
        onOpen: (id) => { if (handlers.onPeerOpen) handlers.onPeerOpen(id); },
        onClose: (id) => { registry.remove(id); dialer.forget(id); },
        onFrame: (frame, id) => router.route(frame, id),
        onLocalCandidate: (id, candidate) => dialer.relayCandidate(id, candidate)
      }
    });

    dialer = new AutoDialer({ selfId, registry, router, createLink });
    const manual = new ManualSignaling({ selfId, registry, createLink });

    new Keepalive({ selfId, registry }).start();

    return {
      createManualOffer: () => manual.createManualOffer(),
      acceptManualOffer: (code) => manual.acceptManualOffer(code),
      acceptManualAnswer: (code) => manual.acceptManualAnswer(code),
      ensureConnectedTo: (peerId) => dialer.ensureConnectedTo(peerId),
      broadcast: (msg) => router.broadcast(msg),
      sendTo: (peerId, msg) => router.sendTo(peerId, msg),
      peerIds: () => registry.ids()
    };
  }
}
