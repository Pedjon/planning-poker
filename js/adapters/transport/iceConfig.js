// Transport config: STUN/TURN servers and ICE gathering timeout.
//
// STUN finds your public address; TURN relays data when a direct/hairpin path
// can't be established (same-NAT testing, symmetric NAT, strict firewalls).
// The TURN entries use the free, public "Open Relay" project. If they ever
// stop working, grab your own free credentials at https://metered.ca and
// replace the username/credential.

export const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// TURN relay can take longer to allocate; give gathering some headroom.
export const ICE_WAIT_MS = 6000;
