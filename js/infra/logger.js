// Infrastructure: a tiny tagged console logger shared across the app.
// Open DevTools (works in incognito too) to follow the connection lifecycle.
// Toggle at runtime from the console with: PP.setDebug(false)

let debug = true;

function ts() {
  const d = new Date();
  return d.toLocaleTimeString() + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function log(tag, msg, data) {
  if (!debug) return;
  const prefix = '%c[' + ts() + '] ' + tag;
  const style = 'color:#6c8cff;font-weight:bold';
  if (data !== undefined) console.log(prefix, style, msg, data);
  else console.log(prefix, style, msg);
}

export function warn(tag, msg, data) {
  const prefix = '[' + ts() + '] ' + tag + ' ' + msg;
  if (data !== undefined) console.warn(prefix, data);
  else console.warn(prefix);
}

export function setDebug(on) {
  debug = !!on;
}

// Expose a minimal console handle for toggling without a rebuild.
if (typeof window !== 'undefined') {
  window.PP = window.PP || {};
  window.PP.setDebug = setDebug;
  window.PP.log = log;
}
