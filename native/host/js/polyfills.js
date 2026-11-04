// What QuickJS lacks and the page's scripts use: text encoding, URLs, abort signals, base64, and a few more.
const G = globalThis;
if (!G.TextEncoder) {
  G.TextEncoder = class { get encoding() { return 'utf-8'; } encode(s = '') { const out = []; for (const ch of String(s)) { let c = ch.codePointAt(0); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return new Uint8Array(out); } };
  G.TextDecoder = class { constructor(enc = 'utf-8') { this.encoding = enc; } decode(b) { if (!b) return ''; const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength); let s = ''; for (let i = 0; i < u.length;) { const c = u[i++]; if (c < 0x80) s += String.fromCharCode(c); else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (u[i++] & 63)); else if (c < 0xf0) s += String.fromCharCode(((c & 15) << 12) | ((u[i++] & 63) << 6) | (u[i++] & 63)); else { const cp = ((c & 7) << 18) | ((u[i++] & 63) << 12) | ((u[i++] & 63) << 6) | (u[i++] & 63); s += String.fromCodePoint(cp); } } return s; } };
}
const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const dec = (s) => decodeURIComponent(String(s).replace(/\+/g, ' '));
G.URLSearchParams = class URLSearchParams {
  constructor(init = '') { this._p = []; if (typeof init === 'string') { init = init.replace(/^\?/, ''); if (init) for (const kv of init.split('&')) { if (!kv) continue; const i = kv.indexOf('='); this._p.push(i < 0 ? [dec(kv), ''] : [dec(kv.slice(0, i)), dec(kv.slice(i + 1))]); } } else if (init) for (const [k, v] of (init instanceof URLSearchParams ? init._p : Array.isArray(init) ? init : Object.entries(init))) this._p.push([String(k), String(v)]); }
  get(k) { const x = this._p.find((p) => p[0] === k); return x ? x[1] : null; } getAll(k) { return this._p.filter((p) => p[0] === k).map((p) => p[1]); } has(k) { return this._p.some((p) => p[0] === k); }
  set(k, v) { const i = this._p.findIndex((p) => p[0] === k); if (i < 0) this._p.push([k, String(v)]); else { this._p[i][1] = String(v); this._p = this._p.filter((p, j) => p[0] !== k || j === i); } } append(k, v) { this._p.push([k, String(v)]); } delete(k) { this._p = this._p.filter((p) => p[0] !== k); }
  toString() { return this._p.map(([k, v]) => enc(k) + '=' + enc(v)).join('&'); } forEach(f) { this._p.forEach(([k, v]) => f(v, k, this)); } keys() { return this._p.map((p) => p[0])[Symbol.iterator](); } values() { return this._p.map((p) => p[1])[Symbol.iterator](); } entries() { return this._p.map((p) => [...p])[Symbol.iterator](); } [Symbol.iterator]() { return this.entries(); }
};
G.URL = class URL {
  constructor(u, base) {
    u = String(u); let m = /^([a-z][a-z0-9+.-]*:)(\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(u);
    if (!m) { if (base === undefined) throw new TypeError('Invalid URL: ' + u); const b = new URL(base); const mm = /^(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(u); let path = mm[2];
      if (mm[1]) { m = [0, b.protocol, mm[1], mm[1].slice(2), path, mm[3], mm[4]]; } else { if (!path) path = b.pathname; else if (path[0] !== '/') path = b.pathname.replace(/[^/]*$/, '') + path; m = [0, b.protocol, '//' + b.host, b.host, path, mm[3] === undefined && !mm[2] ? b.search : mm[3], mm[4]]; } }
    this.protocol = m[1].toLowerCase(); this.host = m[3] || ''; this.hostname = this.host.replace(/:\d+$/, ''); this.port = (/:(\d+)$/.exec(this.host) || [])[1] || '';
    const segs = []; for (const s of (m[4] || '/').split('/')) { if (s === '..') { if (segs.length > 1) segs.pop(); } else if (s !== '.') segs.push(s); } this.pathname = segs.join('/') || '/'; if (this.pathname[0] !== '/') this.pathname = '/' + this.pathname;
    this.search = m[5] && m[5] !== '?' ? m[5] : ''; this.hash = m[6] && m[6] !== '#' ? m[6] : ''; this.searchParams = new URLSearchParams(this.search); this.origin = this.host ? this.protocol + '//' + this.host : 'null';
  }
  get href() { const q = this.searchParams.toString(); return this.protocol + (this.host || this.protocol === 'file:' ? '//' + this.host : '') + this.pathname + (q ? '?' + q : this.search) + this.hash; } toString() { return this.href; } toJSON() { return this.href; }
};
G.AbortSignal = class AbortSignal { constructor() { this.aborted = false; this.reason = undefined; this._l = []; } addEventListener(t, f) { if (t === 'abort') this._l.push(f); } removeEventListener(t, f) { this._l = this._l.filter((x) => x !== f); } throwIfAborted() { if (this.aborted) throw this.reason; } };
G.AbortController = class AbortController { constructor() { this.signal = new AbortSignal(); } abort(reason) { const s = this.signal; if (s.aborted) return; s.aborted = true; s.reason = reason || Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }); (s.onabort || (() => {}))({ type: 'abort' }); s._l.forEach((f) => f({ type: 'abort' })); } };
G.AbortSignal.timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms); return c.signal; };
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
G.btoa = G.btoa || ((s) => { s = String(s); let o = ''; for (let i = 0; i < s.length; i += 3) { const a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2); o += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4 || 0)] + (i + 1 < s.length ? B64[((b & 15) << 2) | (c >> 6 || 0)] : '=') + (i + 2 < s.length ? B64[c & 63] : '='); } return o; });
G.atob = G.atob || ((s) => { s = String(s).replace(/=+$/, ''); let o = '', bits = 0, n = 0; for (const ch of s) { bits = (bits << 6) | B64.indexOf(ch); n += 6; if (n >= 8) { n -= 8; o += String.fromCharCode((bits >> n) & 255); } } return o; });
G.structuredClone = G.structuredClone || ((v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))));
G.queueMicrotask = G.queueMicrotask || ((f) => Promise.resolve().then(f));
G.requestIdleCallback = (f) => setTimeout(() => f({ didTimeout: false, timeRemaining: () => 10 }), 1);
G.cancelIdleCallback = (id) => clearTimeout(id);
class Obs { constructor(f) { this.f = f; } observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
G.MutationObserver = Obs; G.ResizeObserver = Obs; G.IntersectionObserver = Obs; G.PerformanceObserver = Obs;
G.BroadcastChannel = class { constructor(n) { this.name = n; } postMessage() {} close() {} addEventListener() {} };
// ---- Intl: the parts the page uses (time zones, 12/24-hour) ----
const pad = (n, w = 2) => String(n).padStart(w, '0');
function zoneParts(date, zone) {
  const ms = +date; let off;
  if (zone) { off = __tzoffset(zone, ms); if (Number.isNaN(off)) throw new RangeError('Invalid time zone specified: ' + zone); } else off = -new Date(ms).getTimezoneOffset();
  const d = new Date(ms + off * 60000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), weekday: d.getUTCDay(), off };
}
const sysZone = () => (G.__args && G.__args.tz) || 'UTC';
class DateTimeFormat {
  constructor(locale, o = {}) { this.o = { ...o }; if (this.o.timeZone && Number.isNaN(__tzoffset(this.o.timeZone, 0))) throw new RangeError('Invalid time zone specified: ' + this.o.timeZone); }
  resolvedOptions() { const h12 = this.o.hour12 !== undefined ? this.o.hour12 : this.o.hourCycle ? this.o.hourCycle === 'h12' || this.o.hourCycle === 'h11' : (G.__args && G.__args.hour12 !== undefined ? !!G.__args.hour12 : true); return { locale: 'en-US', calendar: 'gregory', numberingSystem: 'latn', timeZone: this.o.timeZone || sysZone(), hourCycle: h12 ? 'h12' : 'h23', hour12: h12 }; }
  formatToParts(date = new Date()) {
    const p = zoneParts(date, this.o.timeZone), r = this.resolvedOptions(), out = [];
    const want = (k) => this.o[k];
    if (want('hour') !== undefined || want('minute') !== undefined || want('second') !== undefined || (!want('year') && !want('month') && !want('day') && !want('weekday'))) {
      const h = r.hour12 ? (p.hour % 12 || 12) : p.hour;
      if (want('hour') !== undefined || !(want('minute') || want('second'))) out.push({ type: 'hour', value: want('hour') === '2-digit' || (!r.hour12 && want('minute') !== undefined) ? pad(h) : String(h) });
      if (want('minute') !== undefined || want('second') !== undefined) { if (out.length) out.push({ type: 'literal', value: ':' }); out.push({ type: 'minute', value: pad(p.minute) }); }
      if (want('second') !== undefined) { out.push({ type: 'literal', value: ':' }); out.push({ type: 'second', value: pad(p.second) }); }
      if (r.hour12 && want('hour') !== undefined) { out.push({ type: 'literal', value: ' ' }); out.push({ type: 'dayPeriod', value: p.hour < 12 ? 'AM' : 'PM' }); }
    }
    if (want('year') !== undefined || want('month') !== undefined || want('day') !== undefined) { const d = [{ type: 'year', value: String(p.year) }, { type: 'month', value: pad(p.month) }, { type: 'day', value: pad(p.day) }]; out.unshift(...d); }
    return out;
  }
  format(date) { return this.formatToParts(date).map((x) => x.value).join(''); }
}
G.Intl = G.Intl || {};
G.Intl.DateTimeFormat = function (l, o) { return new DateTimeFormat(l, o); };
G.Intl.DateTimeFormat.prototype = DateTimeFormat.prototype;
G.Intl.supportedValuesOf = (k) => (k === 'timeZone' ? __tzlist() : []);
G.Intl.NumberFormat = G.Intl.NumberFormat || class { constructor(l, o = {}) { this.o = o; } format(n) { const d = this.o.maximumFractionDigits ?? 3; return String(Math.round(n * 10 ** d) / 10 ** d); } };
Date.prototype.toLocaleTimeString = function (loc, o = {}) { const f = new DateTimeFormat(loc, { hour: 'numeric', minute: 'numeric', ...o }); const s = f.format(this); return o.second === undefined && !o.minute && o.hour ? s : s; };
Date.prototype.toLocaleDateString = function (loc, o = {}) { const p = zoneParts(this, o.timeZone); return `${p.month}/${p.day}/${p.year}`; };
Date.prototype.toLocaleString = function (loc, o = {}) { return this.toLocaleDateString(loc, o) + ', ' + this.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', second: '2-digit', ...o }); };
