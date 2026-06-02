// Driven adapter: Transport port over raw WebRTC data channels.
// Topology: star. The host accepts one offer per joiner and relays messages.
import { ICE_CONFIG } from './iceConfig.js';
import { encode, decode, waitForIce } from './signaling.js';
import { diagnose } from './diagnostics.js';
import { log, warn } from '../../infra/logger.js';

function wireChannel(channel, meta, handlers, label) {
  log(label, 'data channel created, readyState=' + channel.readyState);
  channel.onopen = () => {
    log(label, 'data channel OPEN');
    if (handlers.onOpen) handlers.onOpen(meta);
  };
  channel.onclose = () => {
    log(label, 'data channel CLOSE');
    if (handlers.onClose) handlers.onClose(meta);
  };
  channel.onerror = (e) => {
    warn(label, 'data channel ERROR', e && e.error ? e.error : e);
  };
  channel.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    log(label, 'recv', msg);
    if (handlers.onMessage) handlers.onMessage(msg, meta);
  };
}

export class WebRtcTransport {
  // Host: accepts one offer per joiner, relays to all open channels.
  initHost(handlers) {
    const peers = [];
    let seq = 0;

    function acceptJoinRequest(code) {
      const offer = decode(code);
      const pc = new RTCPeerConnection(ICE_CONFIG);
      const label = 'HOST<-peer#' + (seq + 1);
      const meta = { id: ++seq, channel: null, pc };
      log(label, 'created peer connection; remote offer type=' + offer.type);
      diagnose(pc, label);

      pc.ondatachannel = (e) => {
        log(label, 'ondatachannel');
        meta.channel = e.channel;
        wireChannel(e.channel, meta, handlers, label);
      };
      pc.onconnectionstatechange = () => {
        if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && handlers.onClose) {
          handlers.onClose(meta);
        }
      };

      peers.push(meta);

      return pc.setRemoteDescription(offer)
        .then(() => { log(label, 'remote offer set; creating answer'); return pc.createAnswer(); })
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => { log(label, 'local answer set; gathering ICE...'); return waitForIce(pc); })
        .then(() => { log(label, 'answer code ready'); return encode(pc.localDescription); });
    }

    function broadcast(msg) {
      const data = JSON.stringify(msg);
      peers.forEach((m) => {
        if (m.channel && m.channel.readyState === 'open') {
          try { m.channel.send(data); } catch (e) { /* ignore */ }
        }
      });
    }

    return { role: 'host', acceptJoinRequest, broadcast };
  }

  // Joiner: creates the offer, applies the host's answer, sends over one channel.
  initJoin(handlers) {
    const label = 'JOIN->host';
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const meta = { id: 'host', channel: null, pc };
    log(label, 'created peer connection');
    diagnose(pc, label);
    const channel = pc.createDataChannel('poker');
    meta.channel = channel;
    wireChannel(channel, meta, handlers, label);

    pc.onconnectionstatechange = () => {
      if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && handlers.onClose) {
        handlers.onClose(meta);
      }
    };

    function createRequest() {
      log(label, 'creating offer');
      return pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => { log(label, 'local offer set; gathering ICE...'); return waitForIce(pc); })
        .then(() => { log(label, 'request code ready'); return encode(pc.localDescription); });
    }

    function acceptAnswer(code) {
      // Only valid right after a local offer was created. If we're already in
      // 'stable' the answer was applied before (e.g. a double click) - no-op.
      if (pc.signalingState !== 'have-local-offer') {
        log(label, 'acceptAnswer skipped (state=' + pc.signalingState + ')');
        return Promise.resolve({ applied: false, state: pc.signalingState });
      }
      const answer = decode(code);
      if (!answer || answer.type !== 'answer') {
        return Promise.reject(new Error('That code is not a response code.'));
      }
      log(label, 'applying remote answer');
      return pc.setRemoteDescription(answer).then(() => {
        log(label, 'remote answer set; signalingState=' + pc.signalingState);
        return { applied: true, state: pc.signalingState };
      });
    }

    function send(msg) {
      if (channel.readyState === 'open') {
        try { channel.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
      } else {
        warn(label, 'send dropped, channel not open (state=' + channel.readyState + ')');
      }
    }

    return { role: 'join', createRequest, acceptAnswer, send };
  }
}
