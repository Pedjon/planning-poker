// Transport diagnostics: wires every lifecycle event on a peer connection to
// the logger so we can see where a connection stalls or fails.
import { log, warn } from '../../infra/logger.js';

function candType(candidateStr) {
  const m = /typ (\w+)/.exec(candidateStr || '');
  return m ? m[1] : 'unknown';
}

export function diagnose(pc, label) {
  const cand = { host: 0, srflx: 0, relay: 0, prflx: 0, unknown: 0 };

  pc.addEventListener('signalingstatechange', () => {
    log(label, 'signalingState ->', pc.signalingState);
  });
  pc.addEventListener('icegatheringstatechange', () => {
    log(label, 'iceGatheringState ->', pc.iceGatheringState);
    if (pc.iceGatheringState === 'complete') {
      log(label, 'candidates gathered', cand);
      if (cand.srflx === 0 && cand.relay === 0) {
        warn(label, 'No STUN/relay candidates - only local host candidates. ' +
          'Cross-network peers will fail without TURN.');
      }
    }
  });
  pc.addEventListener('iceconnectionstatechange', () => {
    log(label, 'iceConnectionState ->', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      warn(label, 'ICE FAILED - no working candidate pair was found (NAT/firewall). ' +
        'A TURN relay would likely fix this.');
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    log(label, 'connectionState ->', pc.connectionState);
  });
  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) {
      const t = candType(e.candidate.candidate);
      cand[t] = (cand[t] || 0) + 1;
      log(label, 'local ICE candidate (' + t + ')', e.candidate.candidate);
    } else {
      log(label, 'local ICE gathering done (null candidate)');
    }
  });
  pc.addEventListener('icecandidateerror', (e) => {
    warn(label, 'ICE candidate error', {
      url: e.url, errorCode: e.errorCode, errorText: e.errorText
    });
  });
  pc.addEventListener('negotiationneeded', () => {
    log(label, 'negotiationneeded');
  });
}
