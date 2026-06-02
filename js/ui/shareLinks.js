// UI helper: turn signaling codes into shareable URLs and back.
//
// The first manual link can be passed around as a link instead of a raw code.
// A request link (#req=...) opens straight into the host/accept flow; the answer
// travels back as a link or code the joiner pastes into their waiting tab.
// Inputs accept either a link or a bare code via extractCode(), so older raw
// codes keep working.

// Find a req=/ans= value in a URL, hash fragment, or bare "req=..." string.
// Returns { kind, code } or null. A raw base64 code never matches (it has no
// #/&/? separators and '=' only appears as trailing padding).
export function parseShare(input) {
  const s = String(input || '').trim();
  const m = /(?:^|[#&?])(req|ans)=([^&#]+)/.exec(s);
  if (!m) return null;
  try {
    return { kind: m[1], code: decodeURIComponent(m[2]) };
  } catch (e) {
    return { kind: m[1], code: m[2] };
  }
}

// A code if the input is already raw, or the code carried inside a link.
export function extractCode(input) {
  const parsed = parseShare(input);
  return parsed ? parsed.code : String(input || '').trim();
}

// Build a shareable URL carrying `code` under `kind` ('req' | 'ans').
export function buildShareUrl(kind, code, base) {
  const b = base || (typeof location !== 'undefined' ? location.origin + location.pathname : '');
  return b + '#' + kind + '=' + encodeURIComponent(code);
}

// Read an incoming code from the current URL hash, or null.
export function readIncomingHash() {
  if (typeof location === 'undefined') return null;
  return parseShare(location.hash);
}
