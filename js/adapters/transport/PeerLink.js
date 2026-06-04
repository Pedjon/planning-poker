// One direct link to one peer: an RTCPeerConnection plus its data channel, with
// all the WebRTC bookkeeping (offer/answer negotiation, ICE candidate buffering,
// channel wiring, lifecycle) hidden behind a small async API.
//
// Two link styles share this class:
//   - trickle (in-band links): local ICE candidates stream out via the
//     onLocalCandidate hook as they are gathered.
//   - non-trickle (the manual first link): there is no channel yet to stream
//     over, so the caller awaits waitForIceComplete() and ships one bundled SDP.
//
// The owner supplies four hooks, all called with this link's current peerId:
//   onOpen(peerId)              - the data channel opened
//   onClose(peerId)            - the connection failed/closed or the channel closed
//   onFrame(frame, peerId)     - a frame arrived on the channel
//   onLocalCandidate(peerId, candidate) - trickle only: a local candidate is ready
import { ICE_CONFIG } from './iceConfig.js';
import { waitForIce } from './signaling.js';
import { diagnose } from './diagnostics.js';
import { serializeCandidate } from './frames.js';
import { log, warn } from '../../infra/logger.js';

export class PeerLink {
  constructor({ peerId, label, trickle, hooks }) {
    // peerId is mutable: a manual offer is created before we know who answers it,
    // so the owner adopts the real remote id once the response is decoded.
    this.peerId = peerId;
    this.label = label;
    this.hooks = hooks;
    this.open = false;
    this.lastSeen = Date.now();
    this.channel = null;
    this.candidateBuffer = []; // candidates that arrived before remoteDescription

    const pc = new RTCPeerConnection(ICE_CONFIG);
    diagnose(pc, label);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.hooks.onClose(this.peerId);
      }
    };
    if (trickle) {
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) {
          this.hooks.onLocalCandidate(this.peerId, serializeCandidate(e.candidate));
        }
      });
    }
    this.pc = pc;
  }

  // ----------------------------- data channel -----------------------------
  // Offerer side. createOutgoingChannel wires immediately (id already known);
  // createDataChannel defers wiring so the manual offerer only fires onOpen once
  // the answer has been applied and the real peerId is set.
  createDataChannel() {
    this.channel = this.pc.createDataChannel('poker');
  }

  createOutgoingChannel() {
    this.createDataChannel();
    this.wireChannel();
  }

  // Answerer side: the channel is created by the remote peer and surfaced here.
  expectIncomingChannel() {
    this.pc.ondatachannel = (e) => {
      this.channel = e.channel;
      this.wireChannel();
    };
  }

  wireChannel() {
    const channel = this.channel;
    channel.onopen = () => {
      log(this.label, 'channel OPEN <-> ' + this.peerId);
      this.open = true;
      this.touch();
      this.hooks.onOpen(this.peerId);
    };
    channel.onclose = () => {
      log(this.label, 'channel CLOSE <-> ' + this.peerId);
      this.hooks.onClose(this.peerId);
    };
    channel.onerror = (e) => warn(this.label, 'channel ERROR', e && e.error ? e.error : e);
    channel.onmessage = (e) => {
      let frame;
      try { frame = JSON.parse(e.data); } catch (err) { return; }
      this.hooks.onFrame(frame, this.peerId);
    };
  }

  // ----------------------------- negotiation -----------------------------
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return this.pc.localDescription;
  }

  async createAnswer(remoteDesc) {
    await this.pc.setRemoteDescription(remoteDesc);
    await this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription;
  }

  async applyAnswer(remoteDesc) {
    await this.pc.setRemoteDescription(remoteDesc);
    await this.flushCandidates();
  }

  // Buffer candidates that arrive before the remote description is set; once it
  // is, addIceCandidate can be applied directly and the buffer is drained.
  async addRemoteCandidate(candidate) {
    if (this.pc.remoteDescription) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        warn('MESH', 'addIceCandidate failed', err);
      }
    } else {
      this.candidateBuffer.push(candidate);
    }
  }

  async flushCandidates() {
    const buffered = this.candidateBuffer;
    this.candidateBuffer = [];
    for (const candidate of buffered) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        warn('MESH', 'addIceCandidate (buffered) failed', err);
      }
    }
  }

  // Non-trickle only: resolve once ICE gathering completes so the bundled SDP
  // carries every candidate.
  waitForIceComplete() {
    return waitForIce(this.pc);
  }

  // ----------------------------- io & lifecycle -----------------------------
  send(data) {
    if (this.isOpen) {
      try { this.channel.send(data); } catch (e) { /* ignore */ }
    }
  }

  touch() {
    this.lastSeen = Date.now();
  }

  close() {
    try { this.pc.close(); } catch (e) { /* ignore */ }
  }

  get isOpen() {
    return !!this.channel && this.channel.readyState === 'open';
  }

  get signalingState() {
    return this.pc.signalingState;
  }

  get localDescription() {
    return this.pc.localDescription;
  }
}
