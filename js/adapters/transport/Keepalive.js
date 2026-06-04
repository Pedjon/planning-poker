// Pings every direct neighbor on a fixed cadence to exercise the link and keep
// NAT bindings warm. It deliberately never tears a peer down for missed pings:
// browsers throttle timers in backgrounded/idle tabs, so silence is not a
// reliable death signal. Real departures come from the data channel's onclose
// and connectionState 'failed'/'closed' (see PeerLink), which drive onPeerClose.
import { HEARTBEAT_INTERVAL_MS } from './iceConfig.js';
import { pingFrame } from './frames.js';

export class Keepalive {
  constructor({ selfId, registry }) {
    this.selfId = selfId;
    this.registry = registry;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  tick() {
    this.registry.forEach((link, peerId) => {
      if (link.isOpen) link.send(JSON.stringify(pingFrame(this.selfId, peerId)));
    });
  }
}
