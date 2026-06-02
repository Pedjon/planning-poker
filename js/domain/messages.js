// Domain: action and wire-protocol factories. Single source of the message
// shapes exchanged over the transport, so no literals are duplicated.
//
// Wire protocol:
//   client -> host: { kind: 'action', action: {...} }
//   host -> all:    { kind: 'sync', snapshot: {...} }

export const Actions = {
  join: (id, name) => ({ type: 'join', id, name }),
  vote: (id, value) => ({ type: 'vote', id, value }),
  leave: (id) => ({ type: 'leave', id }),
  reveal: () => ({ type: 'reveal' }),
  reset: () => ({ type: 'reset' })
};

export const actionMsg = (action) => ({ kind: 'action', action });
export const syncMsg = (snapshot) => ({ kind: 'sync', snapshot });

export const isAction = (msg) => msg && msg.kind === 'action';
export const isSync = (msg) => msg && msg.kind === 'sync';
