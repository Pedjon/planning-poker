// Moves frames across the mesh. Every frame is flooded to all neighbors; the
// SeenCache stops loops and duplicates. A frame addressed to someone else is
// relayed onward; a broadcast is relayed AND consumed; a frame for me is just
// consumed. Consuming dispatches signal frames to the signaler and app frames to
// the application handler (ping frames only prove liveness).
import { FrameKind, appFrame } from './frames.js';

export class MeshRouter {
  constructor({ selfId, registry, seen, onAppMessage, onSignal }) {
    this.selfId = selfId;
    this.registry = registry;
    this.seen = seen;
    this.onAppMessage = onAppMessage;
    this.onSignal = onSignal;
  }

  // Send a frame to every open channel except the one it came from.
  flood(frame, exceptId) {
    const data = JSON.stringify(frame);
    this.registry.forEach((link, id) => {
      if (id === exceptId) return;
      link.send(data);
    });
  }

  // Originate a frame from this peer: remember it (so loopbacks dedupe) and push
  // it out to every open channel.
  emit(frame) {
    this.seen.markSeen(frame.mid);
    this.flood(frame, null);
  }

  // Handle a frame that arrived from a neighbor.
  route(frame, sourceId) {
    if (!frame || !frame.mid) return;
    // Any inbound traffic proves the neighbor is alive - record it before the
    // dedupe check, since even a duplicate is a sign of life.
    const source = this.registry.get(sourceId);
    if (source) source.touch();
    if (!this.seen.markSeen(frame.mid)) return; // already handled this one

    const broadcast = frame.to == null;
    const toMe = frame.to === this.selfId;
    if (!broadcast && !toMe) {
      this.flood(frame, sourceId); // not for me: relay onward
      return;
    }
    if (broadcast) this.flood(frame, sourceId); // keep the flood going, then consume
    this.consume(frame);
  }

  consume(frame) {
    if (frame.kind === FrameKind.ping) return; // liveness only; lastSeen bumped
    if (frame.kind === FrameKind.signal) return this.onSignal(frame.from, frame.body);
    if (frame.kind === FrameKind.app && this.onAppMessage) {
      this.onAppMessage(frame.body, frame.from);
    }
  }

  // ----------------------------- app messaging -----------------------------
  broadcast(msg) {
    this.emit(appFrame(this.selfId, null, msg));
  }

  sendTo(peerId, msg) {
    this.emit(appFrame(this.selfId, peerId, msg));
  }
}
