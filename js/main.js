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

// Host: create an invite (offer) and show it as a shareable link. This tab now
// holds the pending offer, so an incoming response link can be applied live here.
function hostGenerateInvite() {
  els.hostInviteBtn.disabled = true;
  els.hostInviteBtn.textContent = 'Generating...';
  controller.createInvite().then((offer) => {
    els.hostInviteOut.value = buildShareUrl('inv', offer);
    els.hostInviteField.classList.remove('hidden');
    awaitingResponse = true;
    // Keep disabled: regenerating would invalidate the response the joiner returns.
    els.hostInviteBtn.textContent = 'Invite link ready';
  }).catch((err) => {
    els.hostInviteBtn.disabled = false;
    els.hostInviteBtn.textContent = 'Generate invite link';
    alert('Could not create an invite link.\n\n' + err);
  });
}

// Host: apply the joiner's response (answer) to finish the connection.
function hostConnect() {
  if (controller.isConnected()) { ui.goTo('table'); return; }
  const code = extractCode(els.hostRespIn.value);
  if (!code) return;
  els.hostConnect.disabled = true;
  els.hostConnect.textContent = 'Connecting...';
  controller.applyResponse(code).then(() => {
    els.hostConnect.textContent = 'Connected';
  }).catch((err) => {
    els.hostConnect.disabled = false;
    els.hostConnect.textContent = 'Connect';
    alert('Could not read that response link. Ask the participant for a fresh one.\n\n' + err);
  });
}

// Joiner: accept the host's invite (offer) and produce a response link to send back.
function joinRespond() {
  const code = extractCode(els.joinInviteIn.value);
  if (!code) return;
  els.joinRespond.disabled = true;
  els.joinRespond.textContent = 'Generating...';
  controller.acceptInvite(code).then((answer) => {
    els.joinRespOut.value = buildShareUrl('res', answer);
    els.joinRespField.classList.remove('hidden');
    // Keep disabled: regenerating against a new invite would orphan this one.
    els.joinRespond.textContent = 'Response link ready';
  }).catch((err) => {
    els.joinRespond.disabled = false;
    els.joinRespond.textContent = 'Generate response link';
    alert('Could not read that invite link. Ask the host for a fresh one.\n\n' + err);
  });
}

// ----------------------------- link routing -----------------------------
// An invite link (the host's offer) opened in a fresh tab means "the host wants
// you to join": the opener becomes a joiner. A response link (the joiner's
// answer) only makes sense in the tab that generated the invite (awaitingResponse),
// since the pending RTCPeerConnection lives there; opening it fresh shows guidance.
let pendingInvite = null;
let awaitingResponse = false;

function clearHash() {
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Repurpose the setup screen as a "join this session" prompt: the opener still
// enters a name, then a single click joins and auto-generates the response link.
function enterAcceptMode() {
  els.setupTitle.textContent = 'Join a session';
  els.hostBtn.classList.add('hidden');
  els.joinBtn.textContent = 'Join & generate response';
  els.setupHint.textContent =
    'You were invited to a session. Enter your name to join and generate a response link to send back to the host.';
  ui.goTo('setup');
  els.name.focus();
}

function routeFromHash(parsed) {
  if (!parsed) return;
  const { kind, code } = parsed;

  if (kind === 'inv') {
    // If already in a session, an invite means "connect to this person too":
    // jump to the join screen and produce a response link right away.
    if (controller.net) {
      ui.goTo('joinSignal');
      els.joinInviteIn.value = code;
      joinRespond();
    } else {
      pendingInvite = code;
      enterAcceptMode();
    }
    clearHash();
    return;
  }

  if (kind === 'res') {
    if (awaitingResponse) {
      // Same tab that generated the invite: apply the response and connect.
      els.hostRespIn.value = code;
      hostConnect();
    } else {
      // Fresh tab (the pending offer was lost on reload): can't connect here.
      ui.goTo('hostSignal');
      els.hostRespIn.value = code;
      els.hostHint.textContent =
        'This response belongs to the tab where you generated the invite. Open it there, ' +
        'or paste this response into that tab\u2019s response field.';
      els.hostHint.classList.remove('hidden');
    }
    clearHash();
  }
}

routeFromHash(readIncomingHash());
window.addEventListener('hashchange', () => routeFromHash(readIncomingHash()));

// ----------------------------- event wiring -----------------------------
els.hostBtn.onclick = () => {
  const name = requireName();
  if (name) controller.host(name);
};

els.joinBtn.onclick = () => {
  const name = requireName();
  if (!name) return;
  controller.join(name);
  if (pendingInvite) {
    els.joinInviteIn.value = pendingInvite;
    pendingInvite = null;
    joinRespond();
  }
};

els.hostInviteBtn.onclick = hostGenerateInvite;
els.hostInviteCopy.onclick = () => ui.copy(els.hostInviteOut);
els.hostConnect.onclick = hostConnect;
els.hostEnter.onclick = () => { controller.render(); ui.goTo('table'); };

els.joinRespond.onclick = joinRespond;
els.joinRespCopy.onclick = () => ui.copy(els.joinRespOut);

els.addPeer.onclick = () => {
  // Reset for the next serialized invite.
  els.hostInviteOut.value = '';
  els.hostInviteField.classList.add('hidden');
  els.hostHint.classList.add('hidden');
  els.hostRespIn.value = '';
  els.hostInviteBtn.disabled = false;
  els.hostInviteBtn.textContent = 'Generate invite link';
  els.hostConnect.disabled = false;
  els.hostConnect.textContent = 'Connect';
  awaitingResponse = false;
  ui.goTo('hostSignal');
};
els.reveal.onclick = () => controller.revealRound();
els.reset.onclick = () => controller.resetRound();

// Dev shortcut: skip setup/signaling and open the room with mock data.
if (devConfig.enabled) {
  controller.enterDevRoom(devConfig);
}
