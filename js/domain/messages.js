// Domain: action and wire-protocol factories. Single source of the message
// shapes exchanged over the transport, so no literals are duplicated.
//
// Wire protocol (mesh, Phase A):
//   peer -> coordinator: { kind: 'action', action: {...} }   (routed via sendTo)
//   coordinator -> all:  { kind: 'sync', snapshot: {...} }    (flooded broadcast)
//   any -> all:          { kind: 'hello', id, name }          (announce identity)
//   any -> all:          { kind: 'roster', roster: [{id,name}] }
//   peer <-> peer:        { kind: 'signal', signal: {...} }    (in-band SDP relay)
//
// 'action'/'sync'/'hello'/'roster' are application messages handled by the
// SessionController. 'signal' is consumed inside the transport (it never
// reaches the controller) to bootstrap direct peer-to-peer links.

export const Actions = {
  join: (id, name) => ({ type: 'join', id, name }),
  vote: (id, value) => ({ type: 'vote', id, value }),
  leave: (id) => ({ type: 'leave', id }),
  reveal: () => ({ type: 'reveal' }),
  reset: () => ({ type: 'reset' })
};

// WebRTC signaling carried in-band over the mesh. Phase A bundles the full SDP
// (post ICE-gathering); the 'candidate' type is reserved for Phase C (trickle).
export const SignalTypes = { offer: 'offer', answer: 'answer', candidate: 'candidate' };

export const actionMsg = (action) => ({ kind: 'action', action });
export const syncMsg = (snapshot) => ({ kind: 'sync', snapshot });
export const helloMsg = (id, name) => ({ kind: 'hello', id, name });
export const rosterMsg = (roster) => ({ kind: 'roster', roster });

export const isAction = (msg) => msg && msg.kind === 'action';
export const isSync = (msg) => msg && msg.kind === 'sync';
export const isHello = (msg) => msg && msg.kind === 'hello';
export const isRoster = (msg) => msg && msg.kind === 'roster';
