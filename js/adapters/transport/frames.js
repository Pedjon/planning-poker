// Pure helpers for the mesh wire format. No state beyond a monotonic counter,
// no side effects - just id generation, candidate cleanup, and frame builders.
//
// Frame envelope (every byte on a channel is one of these):
//   { mid, from, to, kind, body }
//     mid  - unique id, used to dedupe floods and stop loops
//     from - id of the original sender (survives relays)
//     to   - target peer id, or null for "everyone" (broadcast)
//     kind - 'signal'/'app' (signal consumed in transport, app -> controller) or 'ping'
//     body - the signal payload or the application message ('ping' has none)

export const FrameKind = { signal: 'signal', app: 'app', ping: 'ping' };

let MID_SEQ = 0;

// Unique-per-peer frame id: sender id + sequence + timestamp.
export function nextMid(selfId) {
  return selfId + ':' + (++MID_SEQ) + ':' + Date.now().toString(36);
}

// Short opaque id carried by a manual invite and echoed back by its response, so
// the host can match a response to the exact pending offer that produced it.
export function nextNonce() {
  return 'n_' + Math.random().toString(36).slice(2, 10);
}

// RTCIceCandidate is not plain JSON; keep only the fields addIceCandidate needs.
export function serializeCandidate(candidate) {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment
  };
}

export function signalFrame(selfId, to, body) {
  return { mid: nextMid(selfId), from: selfId, to, kind: FrameKind.signal, body };
}

export function appFrame(selfId, to, body) {
  return { mid: nextMid(selfId), from: selfId, to, kind: FrameKind.app, body };
}

export function pingFrame(selfId, to) {
  return { mid: nextMid(selfId), from: selfId, to, kind: FrameKind.ping };
}
