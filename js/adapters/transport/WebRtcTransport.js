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
// In-band links use trickle ICE: the offer/answer is sent immediately and ICE
// candidates stream as they are discovered (much faster than waiting for full
// gathering). The manual first link can't trickle - there is no channel yet -
// so it still bundles all candidates via waitForIce.
//
// A keepalive pings every direct neighbor periodically to exercise the link and
// keep NAT bindings warm. It deliberately does NOT tear a peer down for missed
// pings: browsers throttle timers in backgrounded/idle tabs, so silence is not a
// reliable death signal and dropping on it falsely evicts inactive participants.
// Real departures are detected by WebRTC itself - the data channel's onclose
// (close/refresh) and connectionState 'failed'/'closed' (genuine failure) - both
// of which call removeLink and fire onPeerClose.
//
// Frame envelope (every byte on a channel is one of these):
//   { mid, from, to, kind, body }
//     mid  - unique id, used to dedupe floods and stop loops
//     from - id of the original sender (survives relays)
//     to   - target peer id, or null for "everyone" (broadcast)
//     kind - 'signal'/'app' (signal consumed here, app -> controller) or 'ping'
//     body - the signal payload or the application message ('ping' has none)
import { ICE_CONFIG, HEARTBEAT_INTERVAL_MS } from './iceConfig.js';
import { encode, decode, waitForIce } from './signaling.js';
import { diagnose } from './diagnostics.js';
import { SignalTypes } from '../../domain/messages.js';
import { log, warn } from '../../infra/logger.js';

let MID_SEQ = 0;
function nextMid(selfId) {
  return selfId + ':' + (++MID_SEQ) + ':' + Date.now().toString(36);
}

// Short opaque id carried by an invite and echoed back by its response, so the
// host can match a response to the exact pending offer that produced it.
function nextNonce() {
  return 'n_' + Math.random().toString(36).slice(2, 10);
}

// RTCIceCandidate is not plain JSON; keep only the fields addIceCandidate needs.
function serializeCandidate(c) {
  return {
    candidate: c.candidate,
    sdpMid: c.sdpMid,
    sdpMLineIndex: c.sdpMLineIndex,
    usernameFragment: c.usernameFragment
  };
}

export class WebRtcTransport {
  // Spin up the mesh for this peer. `handlers`:
  //   onMessage(appMsg, fromId) - an application frame arrived
  //   onPeerOpen(peerId)        - a direct data channel opened
  //   onPeerClose(peerId)       - a direct link failed/closed
  init({ selfId, handlers }) {
    const links = new Map();   // peerId -> { pc, channel, open, lastSeen }
    const dialing = new Set(); // peerIds we've already started offering to
    const candBuf = new Map(); // peerId -> [candidate] arrived before remoteDescription
    const seenOrder = [];      // ring buffer of recent mids
    const seen = new Set();
    // Each manual offer awaits its answer under a nonce, so the host can hand
    // out several invites at once and apply the responses in any order.
    const pendingOffers = new Map(); // nonce -> { pc, channel }

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
      candBuf.delete(peerId);
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

    // Stream local ICE candidates to a peer as they are gathered (in-band links
    // only). addEventListener keeps the diagnose() icecandidate logger intact.
    function enableTrickle(pc, peerId) {
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) {
          relaySignal(peerId, { type: SignalTypes.candidate, candidate: serializeCandidate(e.candidate) });
        }
      });
    }

    // Apply any candidates that arrived before the remote description was ready.
    function flushCandidates(peerId) {
      const lk = links.get(peerId);
      const buf = candBuf.get(peerId);
      if (!lk || !buf) return;
      candBuf.delete(peerId);
      buf.forEach((c) => {
        lk.pc.addIceCandidate(c).catch((err) => warn('MESH', 'addIceCandidate (buffered) failed', err));
      });
    }

    function wireChannel(channel, getPeerId, label) {
      channel.onopen = () => {
        const peerId = getPeerId();
        log(label, 'channel OPEN <-> ' + peerId);
        const lk = links.get(peerId);
        if (lk) { lk.open = true; lk.lastSeen = Date.now(); }
        if (handlers.onPeerOpen) handlers.onPeerOpen(peerId);
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
      // Any inbound traffic from a neighbor proves the link is alive - record it
      // before the dedupe check, since even a duplicate is a sign of life.
      const src = links.get(sourceId);
      if (src) src.lastSeen = Date.now();
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
      if (frame.kind === 'ping') return; // liveness only; lastSeen already bumped
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
          enableTrickle(pc, from);
          lk = { pc, channel: null, open: false, lastSeen: Date.now() };
          links.set(from, lk);
          pc.ondatachannel = (e) => {
            lk.channel = e.channel;
            wireChannel(e.channel, () => from, label);
          };
        }
        pc.setRemoteDescription(body.desc)
          .then(() => { flushCandidates(from); return pc.createAnswer(); })
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => relaySignal(from, { type: SignalTypes.answer, desc: pc.localDescription }))
          .catch((err) => warn('MESH<-' + from, 'answer failed', err));
      } else if (body.type === SignalTypes.answer) {
        const lk = links.get(from);
        if (!lk || lk.pc.signalingState !== 'have-local-offer') return;
        lk.pc.setRemoteDescription(body.desc)
          .then(() => flushCandidates(from))
          .catch((err) => warn('MESH->' + from, 'applying answer failed', err));
      } else if (body.type === SignalTypes.candidate) {
        const lk = links.get(from);
        if (lk && lk.pc.remoteDescription) {
          lk.pc.addIceCandidate(body.candidate).catch((err) => warn('MESH', 'addIceCandidate failed', err));
        } else {
          const buf = candBuf.get(from) || [];
          buf.push(body.candidate);
          candBuf.set(from, buf);
        }
      }
    }

    // Open a direct link to `peerId` if we don't have one. Deterministic dialer
    // rule avoids offer glare: the peer with the lower id always offers, the
    // other waits for it. Uses trickle ICE: the offer goes out immediately.
    function ensureConnectedTo(peerId) {
      if (peerId === selfId || links.has(peerId) || dialing.has(peerId)) return;
      if (!(selfId < peerId)) return; // higher id waits to be dialed
      dialing.add(peerId);
      const label = 'MESH->' + peerId;
      const pc = newPc(peerId, label);
      enableTrickle(pc, peerId);
      const channel = pc.createDataChannel('poker');
      links.set(peerId, { pc, channel, open: false, lastSeen: Date.now() });
      wireChannel(channel, () => peerId, label);
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => relaySignal(peerId, { type: SignalTypes.offer, desc: pc.localDescription }))
        .catch((err) => warn(label, 'offer failed', err));
    }

    // ----------------------------- manual first link -----------------------------
    // Bundled (non-trickle): there is no channel yet to stream candidates over,
    // so we wait for ICE gathering and embed every candidate in the one code.
    function createManualOffer() {
      const nonce = nextNonce();
      const label = 'MANUAL(offer:' + nonce + ')';
      const pc = newPc('offer:' + nonce, label);
      const channel = pc.createDataChannel('poker');
      pendingOffers.set(nonce, { pc, channel });
      log(label, 'creating offer');
      return pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => waitForIce(pc))
        .then(() => encode({ id: selfId, nonce, desc: pc.localDescription }));
    }

    function acceptManualAnswer(code) {
      const env = decode(code);
      if (!env || !env.desc || env.desc.type !== 'answer') {
        return Promise.reject(new Error('That code is not a response code.'));
      }
      // Match the response to its invite by nonce; fall back to the sole
      // outstanding offer so a nonce-less legacy code still connects.
      let key = env.nonce;
      if (key == null && pendingOffers.size === 1) key = pendingOffers.keys().next().value;
      const slot = key != null ? pendingOffers.get(key) : null;
      if (!slot) return Promise.resolve({ applied: false, reason: 'no matching pending invite' });
      const pc = slot.pc;
      if (pc.signalingState !== 'have-local-offer') {
        return Promise.resolve({ applied: false, state: pc.signalingState });
      }
      const remoteId = env.id;
      const channel = slot.channel;
      pendingOffers.delete(key);
      links.set(remoteId, { pc, channel, open: false, lastSeen: Date.now() });
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
      const lk = { pc, channel: null, open: false, lastSeen: Date.now() };
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
        // Echo the invite's nonce back so the host can match this response.
        .then(() => encode({ id: selfId, nonce: env.nonce, desc: pc.localDescription }));
    }

    // ----------------------------- keepalive -----------------------------
    // Ping every open neighbor to keep the link exercised and NAT bindings warm.
    // We never drop a peer for missed pings: idle/background tabs throttle timers,
    // so silence is not death. Departures come from channel.onclose and
    // connectionState 'failed'/'closed' (see wireChannel / newPc).
    function keepaliveTick() {
      links.forEach((lk, peerId) => {
        if (lk.channel && lk.channel.readyState === 'open') {
          const frame = { mid: nextMid(selfId), from: selfId, to: peerId, kind: 'ping' };
          try { lk.channel.send(JSON.stringify(frame)); } catch (e) { /* ignore */ }
        }
      });
    }
    setInterval(keepaliveTick, HEARTBEAT_INTERVAL_MS);

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
