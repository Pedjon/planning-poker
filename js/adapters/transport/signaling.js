// Transport helpers for manual copy-paste signaling.
import { ICE_WAIT_MS } from './iceConfig.js';

export function encode(desc) {
  return btoa(JSON.stringify(desc));
}

export function decode(code) {
  return JSON.parse(atob(code.trim()));
}

// Resolve once all ICE candidates are gathered (or after a safety timeout), so
// a single copy-paste code carries every candidate (no trickle ICE).
export function waitForIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, ICE_WAIT_MS);
  });
}
