// Composition root: instantiate the adapters, inject them into the
// application core, and wire DOM events to the controller's use-cases.
import { LokiSessionStore } from './adapters/store/LokiSessionStore.js';
import { WebRtcTransport } from './adapters/transport/WebRtcTransport.js';
import { UiAdapter } from './ui/UiAdapter.js';
import { SessionController } from './application/SessionController.js';
import { els } from './ui/elements.js';
import { devConfig } from './devConfig.js';
import { buildShareUrl, extractCode, readIncomingHash } from './ui/shareLinks.js';

const store = new LokiSessionStore();
const transport = new WebRtcTransport();
const ui = new UiAdapter({ onVote: (value) => controller.castVote(value) });
const controller = new SessionController({ store, transport, ui });

// ----------------------------- helpers -----------------------------
function requireName() {
  const name = els.name.value.trim();
  if (!name) {
    els.name.focus();
    els.name.style.borderColor = 'var(--danger)';
    return null;
  }
  return name;
}

function hostGenerate() {
  const code = extractCode(els.hostReqIn.value);
  if (!code) return;
  els.hostGen.disabled = true;
  els.hostGen.textContent = 'Generating...';
  controller.acceptJoinRequest(code).then((answer) => {
    els.hostAnsOut.value = buildShareUrl('ans', answer);
    els.hostAnsField.classList.remove('hidden');
    els.hostGen.disabled = false;
    els.hostGen.textContent = 'Generate response link';
  }).catch((err) => {
    els.hostGen.disabled = false;
    els.hostGen.textContent = 'Generate response link';
    alert('Could not read that request link. Ask for a fresh one.\n\n' + err);
  });
}

function joinGenerate() {
  els.joinGen.disabled = true;
  els.joinGen.textContent = 'Generating...';
  controller.createJoinRequest().then((offer) => {
    els.joinReqOut.value = buildShareUrl('req', offer);
    els.joinReqField.classList.remove('hidden');
    els.joinAnsField.classList.remove('hidden');
    // This tab now holds the pending offer, so an incoming answer link can be
    // applied live here (see routeFromHash).
    awaitingAnswer = true;
    // Keep disabled: regenerating would invalidate the answer the host returns.
    els.joinGen.textContent = 'Request link ready';
  }).catch((err) => {
    els.joinGen.disabled = false;
    els.joinGen.textContent = 'Generate request link';
    alert('Could not create a request link.\n\n' + err);
  });
}

function joinConnect() {
  if (controller.isConnected()) { ui.goTo('table'); return; }
  const code = extractCode(els.joinAnsIn.value);
  if (!code) return;
  els.joinConnect.disabled = true;
  els.joinConnect.textContent = 'Connecting...';
  controller.submitAnswer(code).catch((err) => {
    els.joinConnect.disabled = false;
    els.joinConnect.textContent = 'Connect';
    alert('Could not read that response link. Ask the host for a fresh one.\n\n' + err);
  });
}

// ----------------------------- link routing -----------------------------
// A request link opened in a fresh tab means "someone wants to join you": the
// opener becomes the host. An answer link only makes sense in the tab that
// already created a request (awaitingAnswer), since the pending RTCPeerConnection
// lives there; opening it fresh just shows guidance.
let pendingReq = null;
let awaitingAnswer = false;

function clearHash() {
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Repurpose the setup screen as an "accept a join request" prompt: the opener
// still enters a name, then a single click hosts and auto-generates the response.
function enterAcceptMode() {
  els.setupTitle.textContent = 'Accept a join request';
  els.joinBtn.classList.add('hidden');
  els.hostBtn.textContent = 'Accept & generate link';
  els.setupHint.textContent =
    'Someone wants to join. Enter your name to accept and generate a response link to send back to them.';
  ui.goTo('setup');
  els.name.focus();
}

function routeFromHash(parsed, { live } = {}) {
  if (!parsed) return;
  const { kind, code } = parsed;

  if (kind === 'req') {
    // If already hosting, a request link means "add this participant": jump to
    // the host signaling screen and produce a response link right away.
    if (controller.role === 'host' && controller.net) {
      ui.goTo('hostSignal');
      els.hostReqIn.value = code;
      hostGenerate();
    } else {
      pendingReq = code;
      enterAcceptMode();
    }
    clearHash();
    return;
  }

  if (kind === 'ans') {
    if (awaitingAnswer) {
      // Same tab that created the request: apply the answer and connect.
      els.joinAnsIn.value = code;
      joinConnect();
    } else {
      // Fresh tab (the pending offer was lost on reload): can't connect here.
      ui.goTo('joinSignal');
      els.joinAnsIn.value = code;
      els.joinHint.textContent =
        'This response belongs to the tab where you created your request. Open it there, ' +
        'or paste this response into that tab\u2019s response field.';
      els.joinHint.classList.remove('hidden');
    }
    clearHash();
  }
}

routeFromHash(readIncomingHash(), { live: false });
window.addEventListener('hashchange', () => routeFromHash(readIncomingHash(), { live: true }));

// ----------------------------- event wiring -----------------------------
els.hostBtn.onclick = () => {
  const name = requireName();
  if (!name) return;
  controller.host(name);
  if (pendingReq) {
    els.hostReqIn.value = pendingReq;
    pendingReq = null;
    hostGenerate();
  }
};

els.joinBtn.onclick = () => {
  const name = requireName();
  if (name) controller.join(name);
};

els.hostGen.onclick = hostGenerate;
els.hostCopy.onclick = () => ui.copy(els.hostAnsOut);
els.hostEnter.onclick = () => { controller.render(); ui.goTo('table'); };

els.joinGen.onclick = joinGenerate;
els.joinCopy.onclick = () => ui.copy(els.joinReqOut);
els.joinConnect.onclick = joinConnect;

els.addPeer.onclick = () => {
  els.hostReqIn.value = '';
  els.hostAnsOut.value = '';
  els.hostAnsField.classList.add('hidden');
  ui.goTo('hostSignal');
};
els.reveal.onclick = () => controller.revealRound();
els.reset.onclick = () => controller.resetRound();

// Dev shortcut: skip setup/signaling and open the room with mock data.
if (devConfig.enabled) {
  controller.enterDevRoom(devConfig);
}
