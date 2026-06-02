// Composition root: instantiate the adapters, inject them into the
// application core, and wire DOM events to the controller's use-cases.
import { LokiSessionStore } from './adapters/store/LokiSessionStore.js';
import { WebRtcTransport } from './adapters/transport/WebRtcTransport.js';
import { UiAdapter } from './ui/UiAdapter.js';
import { SessionController } from './application/SessionController.js';
import { els } from './ui/elements.js';
import { devConfig } from './devConfig.js';

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
  const code = els.hostReqIn.value.trim();
  if (!code) return;
  els.hostGen.disabled = true;
  els.hostGen.textContent = 'Generating...';
  controller.acceptJoinRequest(code).then((answer) => {
    els.hostAnsOut.value = answer;
    els.hostAnsField.classList.remove('hidden');
    els.hostGen.disabled = false;
    els.hostGen.textContent = 'Generate response code';
  }).catch((err) => {
    els.hostGen.disabled = false;
    els.hostGen.textContent = 'Generate response code';
    alert('Could not read that request code. Ask for a fresh one.\n\n' + err);
  });
}

function joinGenerate() {
  els.joinGen.disabled = true;
  els.joinGen.textContent = 'Generating...';
  controller.createJoinRequest().then((offer) => {
    els.joinReqOut.value = offer;
    els.joinReqField.classList.remove('hidden');
    els.joinAnsField.classList.remove('hidden');
    // Keep disabled: regenerating would invalidate the answer the host returns.
    els.joinGen.textContent = 'Request code ready';
  }).catch((err) => {
    els.joinGen.disabled = false;
    els.joinGen.textContent = 'Generate request code';
    alert('Could not create a request code.\n\n' + err);
  });
}

function joinConnect() {
  if (controller.isConnected()) { ui.goTo('table'); return; }
  const code = els.joinAnsIn.value.trim();
  if (!code) return;
  els.joinConnect.disabled = true;
  els.joinConnect.textContent = 'Connecting...';
  controller.submitAnswer(code).catch((err) => {
    els.joinConnect.disabled = false;
    els.joinConnect.textContent = 'Connect';
    alert('Could not read that response code. Ask the host for a fresh one.\n\n' + err);
  });
}

// ----------------------------- event wiring -----------------------------
els.hostBtn.onclick = () => {
  const name = requireName();
  if (name) controller.host(name);
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
