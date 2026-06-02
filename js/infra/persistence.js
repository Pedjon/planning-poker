// Infrastructure: tiny sessionStorage wrapper for refresh-survival.
//
// sessionStorage (not localStorage) is deliberate: it is per-tab and survives a
// reload, so a refresh keeps identity and round state, but two tabs in the same
// browser still get distinct selfIds (the mesh keys everything by id, and
// same-browser multi-tab is a common testing setup). All access is guarded so
// the module is harmless in a non-browser context (e.g. node syntax checks).

const ID_KEY = 'pp_self_id';
const SESSION_KEY = 'pp_session';

function store() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch (e) {
    return null; // access can throw in some privacy modes
  }
}

// Return a stable per-tab id, creating one with `generate()` on first use.
export function getStableId(generate) {
  const s = store();
  if (!s) return generate();
  try {
    let id = s.getItem(ID_KEY);
    if (!id) {
      id = generate();
      s.setItem(ID_KEY, id);
    }
    return id;
  } catch (e) {
    return generate();
  }
}

// Load persisted session-level state, or null if none/unavailable.
export function loadSessionState() {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      round: parsed.round || 1,
      revealed: !!parsed.revealed
    };
  } catch (e) {
    return null;
  }
}

// Persist only session-level state. Participants are intentionally not stored.
export function saveSessionState(state) {
  const s = store();
  if (!s || !state) return;
  try {
    s.setItem(SESSION_KEY, JSON.stringify({
      round: state.round || 1,
      revealed: !!state.revealed
    }));
  } catch (e) {
    /* ignore quota/privacy errors */
  }
}
