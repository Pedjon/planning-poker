// Developer shortcut config.
//
// Flip `enabled` to true to skip the setup/signaling screens and land straight
// on the room (table) view with mock participants - handy for iterating on the
// table/deck/results UI without doing the full WebRTC handshake.
//
// This is a no-networking local preview: no peer connection is created.
// Leave `enabled: false` for normal use and before deploying.

export const devConfig = {
  enabled: false,

  // 'host' shows the Reveal / New round / Add participant controls.
  // 'join' previews the participant view.
  role: 'host',

  // Your display name in the mock room.
  name: 'Dev',

  // Start with cards already revealed (to preview averages/consensus).
  revealed: false,

  // Fake participants. Use vote: null for someone who hasn't voted yet.
  mockPeers: [
    { name: 'Alice', vote: 5 },
    { name: 'Bob', vote: 8 },
    { name: 'Carol', vote: 5 },
    { name: 'Dave', vote: null }
  ]
};
