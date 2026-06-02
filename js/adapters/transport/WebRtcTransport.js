// Driven adapter: Transport port over raw WebRTC data channels.
//
// Topology: full mesh. The very first link between two peers is still set up
// with a manual copy-paste offer/answer (the only step a human performs).
// After that, every other link is negotiated automatically with in-band
// signaling: SDP offers/answers travel as 'signal' frames flooded across the
// channels that already exist, so a peer can reach someone it is not yet
// directly connected to. Once the direct link is up, traffic flows point to
// point.
//
// Frame envelope (every byte on a channel is one of these):
//   { mid, from, to, kind, body }
//     mid  - unique id, used to dedupe floods and stop loops
//     from - id of the original sender (survives relays)
//     to   - target peer id, or null for "everyone" (broadcast)
//     kind - 'signal' (consumed here) or 'app' (handed to the controller)
//     body - the signal payload or the application message
import { ICE_CONFIG } from './iceConfig.js';
import { encode, decode, waitForIce } from './signaling.js';
import { diagnose } from './diagnostics.js';
import { SignalTypes } from '../../domain/messages.js';
import { log, warn } from '../../infra/logger.js';

let MID_SEQ = 0;
function nextMid(selfId) {
  return selfId + ':' + (++MID_SEQ) + ':' + Date.now().toString(36);
}

export class WebRtcTransport {
  // Spin up the mesh for this peer. `handlers`:
  //   onMessage(appMsg, fromId) - an application frame arrived
  //   onPeerOpen(peerId)        - a direct data channel opened
  //   onPeerClose(peerId)       - a direct link failed/closed
  init({ selfId, handlers }) {
    const links = new Map();   // peerId -> { pc, channel }
    const dialing = new Set(); // peerIds we've already started offering to
    const seenOrder = [];      // ring buffer of recent mids
    const seen = new Set();
    let pending = null;        // { pc, channel } for a manual offer awaiting its answer

    function markSeen(mid) {
      if (seen.has(mid)) return false;
      seen.add(mid);
      seenOrder.push(mid);
      if (seenOrder.length > 500) seen.delete(seenOrder.shift());
      return true;
    }

    function flood(frame, exceptId) {
      const data = JSON.stringify(frame);
      links.forEach((lk, id) => {
        if (id === exceptId) return;
        if (lk.channel && lk.channel.readyState === 'open') {
          try { lk.channel.send(data); } catch (e) { /* ignore */ }
        }
      });
    }

    // Originate a frame from this peer: remember it (so loopbacks dedupe) and
    // push it out to every open channel.
    function emit(frame) {
      markSeen(frame.mid);
      flood(frame, null);
    }

    function removeLink(peerId) {
      const lk = links.get(peerId);
      if (!lk) return;
      links.delete(peerId);
      dialing.delete(peerId);
      try { lk.pc.close(); } catch (e) { /* ignore */ }
      if (handlers.onPeerClose) handlers.onPeerClose(peerId);
    }

    function newPc(peerId, label) {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      diagnose(pc, label);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          removeLink(peerId);
        }
      };
      return pc;
    }

    function wireChannel(channel, getPeerId, label) {
      channel.onopen = () => {
        log(label, 'channel OPEN <-> ' + getPeerId());
        if (handlers.onPeerOpen) handlers.onPeerOpen(getPeerId());
      };
      channel.onclose = () => {
        log(label, 'channel CLOSE <-> ' + getPeerId());
        removeLink(getPeerId());
      };
      channel.onerror = (e) => warn(label, 'channel ERROR', e && e.error ? e.error : e);
      channel.onmessage = (e) => {
        let frame;
        try { frame = JSON.parse(e.data); } catch (err) { return; }
        onFrame(frame, getPeerId());
      };
    }

    function onFrame(frame, sourceId) {
      if (!frame || !frame.mid) return;
      if (!markSeen(frame.mid)) return; // already handled this one
      const broadcast = frame.to == null;
      const toMe = frame.to === selfId;
      if (!broadcast && !toMe) {
        flood(frame, sourceId); // not for me: relay onward
        return;
      }
      if (broadcast) flood(frame, sourceId); // keep the flood going, then also consume
      consume(frame);
    }

    function consume(frame) {
      if (frame.kind === 'signal') return onSignal(frame.from, frame.body);
      if (frame.kind === 'app' && handlers.onMessage) handlers.onMessage(frame.body, frame.from);
    }

    // ----------------------------- in-band signaling -----------------------------
    function relaySignal(to, body) {
      emit({ mid: nextMid(selfId), from: selfId, to, kind: 'signal', body });
    }

    function onSignal(from, body) {
      if (body.type === SignalTypes.offer) {
        let lk = links.get(from);
        let pc;
        if (lk) {
          pc = lk.pc;
        } else {
          const label = 'MESH<-' + from;
          pc = newPc(from, label);
          lk = { pc, channel: null };
          links.set(from, lk);
          pc.ondatachannel = (e) => {
            lk.channel = e.channel;
            wireChannel(e.channel, () => from, label);
          };
        }
        pc.setRemoteDescription(body.desc)
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => waitForIce(pc))
          .then(() => relaySignal(from, { type: SignalTypes.answer, desc: pc.localDescription }))
          .catch((err) => warn('MESH<-' + from, 'answer failed', err));
      } else if (body.type === SignalTypes.answer) {
        const lk = links.get(from);
        if (!lk || lk.pc.signalingState !== 'have-local-offer') return;
        lk.pc.setRemoteDescription(body.desc)
          .catch((err) => warn('MESH->' + from, 'applying answer failed', err));
      }
    }

    // Open a direct link to `peerId` if we don't have one. Deterministic dialer
    // rule avoids offer glare: the peer with the lower id always offers, the
    // other waits for it.
    function ensureConnectedTo(peerId) {
      if (peerId === selfId || links.has(peerId) || dialing.has(peerId)) return;
      if (!(selfId < peerId)) return; // higher id waits to be dialed
      dialing.add(peerId);
      const label = 'MESH->' + peerId;
      const pc = newPc(peerId, label);
      const channel = pc.createDataChannel('poker');
      links.set(peerId, { pc, channel });
      wireChannel(channel, () => peerId, label);
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => waitForIce(pc))
        .then(() => relaySignal(peerId, { type: SignalTypes.offer, desc: pc.localDescription }))
        .catch((err) => warn(label, 'offer failed', err));
    }

    // ----------------------------- manual first link -----------------------------
    function createManualOffer() {
      const label = 'MANUAL(offer)';
      const pc = newPc('pending', label);
      const channel = pc.createDataChannel('poker');
      pending = { pc, channel };
      log(label, 'creating offer');
      return pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => waitForIce(pc))
        .then(() => encode({ id: selfId, desc: pc.localDescription }));
    }

    function acceptManualAnswer(code) {
      if (!pending) return Promise.resolve({ applied: false });
      const pc = pending.pc;
      if (pc.signalingState !== 'have-local-offer') {
        return Promise.resolve({ applied: false, state: pc.signalingState });
      }
      const env = decode(code);
      if (!env || !env.desc || env.desc.type !== 'answer') {
        return Promise.reject(new Error('That code is not a response code.'));
      }
      const remoteId = env.id;
      const channel = pending.channel;
      links.set(remoteId, { pc, channel });
      pending = null;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removeLink(remoteId);
      };
      wireChannel(channel, () => remoteId, 'MANUAL<->' + remoteId);
      log('MANUAL(offer)', 'applying answer from ' + remoteId);
      return pc.setRemoteDescription(env.desc).then(() => ({ applied: true, id: remoteId }));
    }

    function acceptManualOffer(code) {
      const env = decode(code);
      if (!env || !env.desc || env.desc.type !== 'offer') {
        return Promise.reject(new Error('That code is not a request code.'));
      }
      const remoteId = env.id;
      const label = 'MANUAL<-' + remoteId;
      const pc = newPc(remoteId, label);
      const lk = { pc, channel: null };
      links.set(remoteId, lk);
      pc.ondatachannel = (e) => {
        lk.channel = e.channel;
        wireChannel(e.channel, () => remoteId, label);
      };
      log(label, 'remote offer received; creating answer');
      return pc.setRemoteDescription(env.desc)
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => waitForIce(pc))
        .then(() => encode({ id: selfId, desc: pc.localDescription }));
    }

    // ----------------------------- app messaging -----------------------------
    function broadcast(msg) {
      emit({ mid: nextMid(selfId), from: selfId, to: null, kind: 'app', body: msg });
    }

    function sendTo(peerId, msg) {
      emit({ mid: nextMid(selfId), from: selfId, to: peerId, kind: 'app', body: msg });
    }

    function peerIds() {
      return Array.from(links.keys());
    }

    return {
      createManualOffer, acceptManualOffer, acceptManualAnswer,
      ensureConnectedTo, broadcast, sendTo, peerIds
    };
  }
}
