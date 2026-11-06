// A very small DOM for running the page's own scripts without a browser: elements, attributes, classes, styles, events, a selector engine,
// and the page's markup (index.html) parsed into it. There is no CSS engine and no painting; the only layout is the clock digits' boxes
// (js/clocklayout.js), which is all the sky engine's glass needs. Everything here is a plain model of the data the scripts read and write.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const dash = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

// A number that goes up whenever the page's structure, attributes or styles change (not for the digits' path data, which changes every frame and moves nothing).
// Boxes and computed styles are worked out once per number: the glass asks for them on every frame, and each answer is a walk over the tree.
let VER = 1;
export const bump = () => { VER++; };
Object.defineProperty(globalThis, '__domVersion', { get: () => VER, configurable: true });

// ---------------------------------------------------------------- events ----
export class Evt {
  constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; this.cancelable = !!init.cancelable; this.detail = init.detail; Object.assign(this, init); this.defaultPrevented = false; this.target = null; this.currentTarget = null; this._stop = false; this.timeStamp = performance.now(); }
  preventDefault() { this.defaultPrevented = true; } stopPropagation() { this._stop = true; } stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}
export class EventTarget_ {
  addEventListener(type, fn, opts) { if (!fn) return; const l = (this._l ||= {})[type] ||= []; const once = opts && typeof opts === 'object' && opts.once; if (!l.some((x) => x.fn === fn)) l.push({ fn, once }); }
  removeEventListener(type, fn) { const l = this._l && this._l[type]; if (l) this._l[type] = l.filter((x) => x.fn !== fn); }
  _fire(e) { const l = this._l && this._l[e.type]; if (!l) return; e.currentTarget = this; for (const x of [...l]) { if (x.once) this.removeEventListener(e.type, x.fn); try { typeof x.fn === 'function' ? x.fn.call(this, e) : x.fn.handleEvent(e); } catch (err) { console.error('event ' + e.type + ': ' + (err && err.stack || err)); } if (e._stopNow) return; } }
  dispatchEvent(e) {
    e.target = this; const path = []; let n = this;
    while (n) { path.push(n); n = n.parentNode; }
    if (path[path.length - 1] instanceof Doc) path.push(window);
    for (let i = 0; i < path.length; i++) { if (i > 0 && !e.bubbles) break; path[i]._fire(e); if (e._stop) break; }
    return !e.defaultPrevented;
  }
}

// ----------------------------------------------------------------- style ----
export class Style {
  constructor(el) { Object.defineProperty(this, '_el', { value: el, enumerable: false }); Object.defineProperty(this, '_m', { value: new Map(), enumerable: false }); }
  get cssText() { return [...this._m].map(([k, v]) => `${k}: ${v};`).join(' '); }
  set cssText(t) { this._m.clear(); String(t).split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) this._m.set(d.slice(0, i).trim().toLowerCase().startsWith('--') ? d.slice(0, i).trim() : d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim().replace(/\s*!important$/, '')); }); this._sync(); }
  _sync() { const t = this.cssText; if (this._el && this._el._attrs.get('style') === t) return; VER++; if (globalThis.__bumpLog) globalThis.__bumpLog('style', this._el); if (this._el) this._el._attrs.set('style', t); }          // (a write that changes nothing is no change: the page's layout and boxes stay as they were)
  getPropertyValue(k) { return this._m.get(k.startsWith('--') ? k : k.toLowerCase()) || ''; }
  setProperty(k, v) { v = v == null ? '' : String(v); if (!v) return this.removeProperty(k); if (this._m.get(k.startsWith('--') ? k : k.toLowerCase()) === v.replace(/\s*!important$/, '')) return; this._m.set(k.startsWith('--') ? k : k.toLowerCase(), v.replace(/\s*!important$/, '')); this._sync(); }
  removeProperty(k) { const o = this.getPropertyValue(k); this._m.delete(k.startsWith('--') ? k : k.toLowerCase()); this._sync(); return o; }
  get length() { return this._m.size; }
}
const STYLE_PROPS = ['display', 'width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'padding', 'opacity', 'transform', 'transition', 'visibility', 'color', 'background', 'backgroundColor', 'stroke', 'fill', 'filter', 'position', 'zIndex', 'overflow', 'pointerEvents', 'cursor', 'font', 'fontSize', 'flex', 'order', 'minWidth', 'maxWidth', 'strokeWidth', 'strokeLinecap', 'borderRadius', 'boxShadow', 'textContent', 'inset', 'touchAction', 'willChange', 'animation', 'webkitTransform', 'clipPath', 'maxHeight', 'minHeight', 'whiteSpace', 'textAlign', 'lineHeight'];
for (const p of STYLE_PROPS) Object.defineProperty(Style.prototype, p, { get() { return this.getPropertyValue(dash(p)); }, set(v) { this.setProperty(dash(p), v); }, enumerable: false });

// ----------------------------------------------------------------- nodes ----
let UID = 1;
export class Node_ extends EventTarget_ {
  constructor() { super(); this.parentNode = null; this.childNodes = []; this._uid = UID++; }
  get firstChild() { return this.childNodes[0] || null; } get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null; }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  get isConnected() { let n = this; while (n) { if (n instanceof Doc) return true; n = n.parentNode; } return false; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c instanceof Fragment) { [...c.childNodes].forEach((x) => this.insertBefore(x, ref)); return c; }
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); c.parentNode = this; VER++; return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; VER++; } return c; }
  replaceChild(n, o) { this.insertBefore(n, o); return this.removeChild(o); }
  remove(i) { if (typeof i === 'number' && this.localName === 'select') { const o = this.querySelectorAll('option')[i]; if (o) o.remove(); return; } if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(t) { this.childNodes.forEach((c) => (c.parentNode = null)); this.childNodes = []; if (t !== '' && t != null) this.appendChild(new Text(String(t))); }
}
export class Text extends Node_ { constructor(t) { super(); this.data = t; this.nodeType = 3; } get textContent() { return this.data; } set textContent(t) { this.data = String(t); } get nodeValue() { return this.data; } }
export class Fragment extends Node_ { constructor() { super(); this.nodeType = 11; } }

class ClassList {
  constructor(el) { this.el = el; }
  _a() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _s(a) { this.el.setAttribute('class', a.join(' ')); }
  contains(c) { return this._a().includes(c); }
  add(...cs) { const a = this._a(); cs.forEach((c) => { if (!a.includes(c)) a.push(c); }); this._s(a); }
  remove(...cs) { this._s(this._a().filter((c) => !cs.includes(c))); }
  toggle(c, force) { const has = this.contains(c), want = force === undefined ? !has : !!force; if (want && !has) this.add(c); else if (!want && has) this.remove(c); return want; }
  replace(a, b) { if (!this.contains(a)) return false; this._s(this._a().map((c) => (c === a ? b : c))); return true; }
  get length() { return this._a().length; } item(i) { return this._a()[i] || null; } toString() { return this._a().join(' '); }
  [Symbol.iterator]() { return this._a()[Symbol.iterator](); } forEach(f) { this._a().forEach(f); }
}

export class Element extends Node_ {
  constructor(tag, ns) {
    super(); this.nodeType = 1; this.tagName = ns ? tag : tag.toUpperCase(); this.localName = tag.toLowerCase(); this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this._attrs = new Map(); this.style = new Style(this); this.classList = new ClassList(this);
    const el = this;
    this.dataset = new Proxy({}, { get: (_, k) => (typeof k === 'string' && el._attrs.has('data-' + dash(k)) ? el._attrs.get('data-' + dash(k)) : undefined), set: (_, k, v) => { el.setAttribute('data-' + dash(k), String(v)); return true; }, deleteProperty: (_, k) => { el.removeAttribute('data-' + dash(k)); return true; }, has: (_, k) => el._attrs.has('data-' + dash(k)), ownKeys: () => [...el._attrs.keys()].filter((k) => k.startsWith('data-')).map((k) => camel(k.slice(5))), getOwnPropertyDescriptor: (_, k) => (el._attrs.has('data-' + dash(String(k))) ? { enumerable: true, configurable: true, value: el._attrs.get('data-' + dash(String(k))) } : undefined) });
  }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  setAttribute(k, v) { v = String(v); const was = this._attrs.get(k); this._attrs.set(k, v); if (k !== 'd' && was !== v && !k.startsWith('aria-')) { VER++; if (globalThis.__bumpLog) globalThis.__bumpLog(k, this); } if (k === 'style' && this.style.cssText !== v) { this.style._m.clear(); String(v).split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) this.style._m.set(d.slice(0, i).trim(), d.slice(i + 1).trim()); }); } }
  removeAttribute(k) { if (this._attrs.has(k) && !k.startsWith('aria-')) VER++; this._attrs.delete(k); if (k === 'style') this.style._m.clear(); }
  hasAttribute(k) { return this._attrs.has(k); }
  toggleAttribute(k, force) { const want = force === undefined ? !this.hasAttribute(k) : !!force; if (want) this.setAttribute(k, ''); else this.removeAttribute(k); return want; }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  get firstElementChild() { return this.children[0] || null; } get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const c = p.children; return c[c.indexOf(this) + 1] || null; }
  get previousElementSibling() { const p = this.parentNode; if (!p) return null; const c = p.children; return c[c.indexOf(this) - 1] || null; }
  get childElementCount() { return this.children.length; }
  append(...n) { n.forEach((x) => this.appendChild(typeof x === 'string' ? new Text(x) : x)); } prepend(...n) { n.reverse().forEach((x) => this.insertBefore(typeof x === 'string' ? new Text(x) : x, this.firstChild)); }
  after(...n) { const p = this.parentNode; if (!p) return; const ref = this.nextSibling; n.forEach((x) => p.insertBefore(typeof x === 'string' ? new Text(x) : x, ref)); }
  before(...n) { const p = this.parentNode; if (!p) return; n.forEach((x) => p.insertBefore(typeof x === 'string' ? new Text(x) : x, this)); }
  replaceChildren(...n) { this.textContent = ''; this.append(...n); }
  get innerText() { return this.textContent; } set innerText(t) { this.textContent = t; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(h) { this.textContent = ''; parseInto(this, String(h)); }
  get outerHTML() { return serialize(this); }
  cloneNode(deep) { const c = new Element(this.localName, this.namespaceURI === 'http://www.w3.org/1999/xhtml' ? undefined : this.namespaceURI); this._attrs.forEach((v, k) => c.setAttribute(k, v)); if (deep) this.childNodes.forEach((n) => c.appendChild(n instanceof Element ? n.cloneNode(true) : new Text(n.data))); return c; }
  matches(sel) { return matchesSel(this, sel); }
  closest(sel) { let n = this; while (n instanceof Element) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel, false); }
  getElementsByTagName(t) { return queryAll(this, t, false); } getElementsByClassName(c) { return queryAll(this, '.' + c.split(/\s+/).join('.'), false); }
  focus() { document.activeElement = this; } blur() { if (document.activeElement === this) document.activeElement = document.body; }
  click() { this.dispatchEvent(new Evt('click', { bubbles: true })); }
  scrollIntoView() {} scrollTo() {} scrollBy() {} setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; } showModal() { this.setAttribute('open', ''); } close() { this.removeAttribute('open'); }
  animate() { return { cancel() {}, finished: Promise.resolve(), addEventListener() {} }; } getAnimations() { return []; }
  get isContentEditable() { return false; }
  getBoundingClientRect() { if (this._rv !== VER) { this._rc = layoutHook(this); this._rv = VER; } return this._rc; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  get offsetWidth() { return this.getBoundingClientRect().width; } get offsetHeight() { return this.getBoundingClientRect().height; }
  get clientWidth() { return this.getBoundingClientRect().width; } get clientHeight() { return this.getBoundingClientRect().height; }
  get offsetLeft() { return this.getBoundingClientRect().left; } get offsetTop() { return this.getBoundingClientRect().top; }
  get scrollWidth() { return this.clientWidth; } get scrollHeight() { return this.clientHeight; }
  closestShadow() { return null; }
  // form controls
  get value() { return this._value !== undefined ? this._value : this.localName === 'select' ? ((this.querySelector('option[selected]') || this.querySelector('option') || {}).value || '') : (this.getAttribute('value') || (this.localName === 'textarea' ? this.textContent : '')); }
  set value(v) { this._value = String(v); }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute('checked'); } set checked(v) { this._checked = !!v; }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { this.toggleAttribute('disabled', !!v); }
  get selected() { return this.hasAttribute('selected'); } set selected(v) { this.toggleAttribute('selected', !!v); }
  get type() { return this.getAttribute('type') || ''; } set type(v) { this.setAttribute('type', v); }
  get name() { return this.getAttribute('name') || ''; } set name(v) { this.setAttribute('name', v); }
  get href() { return this.getAttribute('href') || ''; } set href(v) { this.setAttribute('href', v); }
  get src() { return this.getAttribute('src') || ''; } set src(v) { this.setAttribute('src', v); }
  get rel() { return this.getAttribute('rel') || ''; } set rel(v) { this.setAttribute('rel', v); }
  get title() { return this.getAttribute('title') || ''; } set title(v) { this.setAttribute('title', v); }
  get min() { return this.getAttribute('min') || ''; } set min(v) { this.setAttribute('min', v); }
  get max() { return this.getAttribute('max') || ''; } set max(v) { this.setAttribute('max', v); }
  get step() { return this.getAttribute('step') || ''; } set step(v) { this.setAttribute('step', v); }
  get placeholder() { return this.getAttribute('placeholder') || ''; } set placeholder(v) { this.setAttribute('placeholder', v); }
  get text() { return this.textContent; } set text(v) { this.textContent = v; }
  add(o, before) { this.insertBefore(o, before || null); }
  get label() { return this.getAttribute('label') || this.textContent; } set label(v) { this.setAttribute('label', v); }
  get options() { return this.querySelectorAll('option'); } get selectedIndex() { const o = this.options; const i = o.findIndex((x) => x.value === this.value); return i; } set selectedIndex(i) { const o = this.options[i]; if (o) this._value = o.value; }
  get valueAsNumber() { return parseFloat(this.value); } get files() { return []; } get form() { return this.closest('form'); }
  get width() { return +this.getAttribute('width') || 0; } set width(v) { this.setAttribute('width', v); } get height() { return +this.getAttribute('height') || 0; } set height(v) { this.setAttribute('height', v); }
  select() {} setSelectionRange() {} reset() {} submit() {} requestSubmit() {}
  get open() { return this.hasAttribute('open'); } set open(v) { this.toggleAttribute('open', !!v); }
  get tabIndex() { return +this.getAttribute('tabindex') || 0; } set tabIndex(v) { this.setAttribute('tabindex', v); }
  get lang() { return this.getAttribute('lang') || ''; } get dir() { return this.getAttribute('dir') || ''; }
  get ownerDocument() { return document; }
  getRootNode() { let n = this; while (n.parentNode) n = n.parentNode; return n; }
  get nodeName() { return this.tagName; }
  get content() { return this; }
}

export class Doc extends Element {
  constructor() { super('#document'); this.nodeType = 9; this.hidden = false; this.readyState = 'loading'; this.visibilityState = 'visible'; this.activeElement = null; this.baseURI = 'file:///index.html'; this.cookie = ''; this.referrer = ''; this.characterSet = 'UTF-8'; }
  get hidden() { return this._hidden || false; } set hidden(v) { this._hidden = !!v; }
  createElement(t) { if (t === 'canvas') return makeCanvasElement(); return new Element(t); }
  createElementNS(ns, t) { return new Element(t, ns); }
  createTextNode(t) { return new Text(String(t)); }
  createDocumentFragment() { return new Fragment(); }
  createComment() { return new Text(''); }
  getElementById(id) {
    const c = (this._ids ||= new Map()).get(id);
    if (c && c.isConnected && c.getAttribute('id') === id) return c;
    const e = queryAll(this, '#' + id, true)[0] || null; if (e) this._ids.set(id, e); return e;
  }
  get documentElement() { return this.children.find((c) => c.localName === 'html') || null; }
  get body() { const h = this.documentElement; return h ? h.children.find((c) => c.localName === 'body') || null : null; }
  get head() { const h = this.documentElement; return h ? h.children.find((c) => c.localName === 'head') || null : null; }
  get title() { const t = this.querySelector('title'); return t ? t.textContent : ''; } set title(v) { let t = this.querySelector('title'); if (!t) { t = new Element('title'); this.head.appendChild(t); } t.textContent = v; }
  execCommand() { return false; } hasFocus() { return true; } elementFromPoint() { return null; } elementsFromPoint() { return []; } getSelection() { return { removeAllRanges() {}, addRange() {}, toString: () => '' }; }
  exitFullscreen() { return Promise.resolve(); } get fullscreenElement() { return null; }
  getBoundingClientRect() { return rect(0, 0, window.innerWidth, window.innerHeight); }
}
export const rect = (x, y, w, h) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() { return this; } });

// -------------------------------------------------------------- selectors ----
function parseSel(sel) {
  // returns [[{comb, tag, id, classes, attrs, pseudos}]...] one chain per comma
  const groups = []; let chain = [], cur = null, i = 0, comb = ' ';
  const s = sel.trim();
  const fresh = () => ({ comb, tag: null, id: null, classes: [], attrs: [], pseudos: [] });
  const ident = () => { const m = /^[-\w\\]+/.exec(s.slice(i)); if (!m) return ''; i += m[0].length; return m[0]; };
  while (i < s.length) {
    const c = s[i];
    if (c === ',') { if (cur) chain.push(cur); groups.push(chain); chain = []; cur = null; comb = ' '; i++; continue; }
    if (c === ' ' || c === '>' || c === '+' || c === '~') { let cc = ' '; while (i < s.length && ' >+~'.includes(s[i])) { if (s[i] !== ' ') cc = s[i]; i++; } if (cur) { chain.push(cur); cur = null; } comb = cc; continue; }
    cur ||= fresh();
    if (c === '*') { i++; cur.tag = '*'; }
    else if (c === '#') { i++; cur.id = ident(); }
    else if (c === '.') { i++; cur.classes.push(ident()); }
    else if (c === '[') { const j = s.indexOf(']', i); const body = s.slice(i + 1, j); i = j + 1; const m = /^([-\w:]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?/.exec(body); cur.attrs.push({ name: m[1], op: m[2] || null, val: m[3] ?? m[4] ?? m[5] ?? '' }); }
    else if (c === ':') { i++; if (s[i] === ':') i++; const name = ident(); let arg = null; if (s[i] === '(') { let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; } arg = s.slice(i + 1, j - 1); i = j; } cur.pseudos.push({ name, arg }); }
    else { cur.tag = ident().toLowerCase(); if (!cur.tag) i++; }
  }
  if (cur) chain.push(cur); if (chain.length) groups.push(chain);
  return groups;
}
function matchSimple(el, p) {
  if (p.tag && p.tag !== '*' && el.localName !== p.tag) return false;
  if (p.id && el.id !== p.id) return false;
  for (const c of p.classes) if (!el.classList.contains(c)) return false;
  for (const a of p.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === '=' && v !== a.val) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.val)) return false;
    if (a.op === '^=' && !v.startsWith(a.val)) return false;
    if (a.op === '$=' && !v.endsWith(a.val)) return false;
    if (a.op === '*=' && !v.includes(a.val)) return false;
    if (a.op === '|=' && !(v === a.val || v.startsWith(a.val + '-'))) return false;
  }
  for (const ps of p.pseudos) {
    const sib = el.parentNode ? el.parentNode.children : [el], idx = sib.indexOf(el);
    switch (ps.name) {
      case 'first-child': if (idx !== 0) return false; break;
      case 'last-child': if (idx !== sib.length - 1) return false; break;
      case 'nth-child': { const a = (ps.arg || '').replace(/\s/g, ''); const m = /^(?:(-?\d*)n)?([+-]\d+)?$/.exec(a); let ok; if (a === 'odd') ok = idx % 2 === 0; else if (a === 'even') ok = idx % 2 === 1; else if (/^\d+$/.test(a)) ok = idx + 1 === +a; else if (m) { const A = m[1] === undefined ? 0 : m[1] === '' ? 1 : m[1] === '-' ? -1 : +m[1], B = m[2] ? +m[2] : 0; ok = A === 0 ? idx + 1 === B : ((idx + 1 - B) / A >= 0 && Number.isInteger((idx + 1 - B) / A)); } else ok = false; if (!ok) return false; break; }
      case 'not': if (matchesSel(el, ps.arg)) return false; break;
      case 'checked': if (!el.checked) return false; break;
      case 'disabled': if (!el.disabled) return false; break;
      case 'empty': if (el.childNodes.length) return false; break;
      case 'root': if (el.localName !== 'html') return false; break;
      case 'focus': case 'hover': case 'active': case 'focus-visible': return false;
      default: break;
    }
  }
  return true;
}
function matchChain(el, chain, k) {
  const p = chain[k];
  if (!matchSimple(el, p)) return false;
  if (k === 0) return true;
  if (p.comb === '>') return el.parentNode instanceof Element && matchChain(el.parentNode, chain, k - 1);
  if (p.comb === '+') { const prev = el.previousElementSibling; return !!prev && matchChain(prev, chain, k - 1); }
  if (p.comb === '~') { let prev = el.previousElementSibling; while (prev) { if (matchChain(prev, chain, k - 1)) return true; prev = prev.previousElementSibling; } return false; }
  let a = el.parentNode; while (a instanceof Element) { if (matchChain(a, chain, k - 1)) return true; a = a.parentNode; } return false;
}
const SELCACHE = new Map();
function matchesSel(el, sel) { let g = SELCACHE.get(sel); if (!g) { g = parseSel(sel); SELCACHE.set(sel, g); } return g.some((ch) => ch.length && matchChain(el, ch, ch.length - 1)); }
function queryAll(root, sel, first) {
  let g = SELCACHE.get(sel); if (!g) { g = parseSel(sel); SELCACHE.set(sel, g); }
  const out = [];
  const walk = (n) => { for (const c of n.childNodes) { if (!(c instanceof Element)) continue; if (g.some((ch) => ch.length && matchChain(c, ch, ch.length - 1))) { out.push(c); if (first) return true; } if (walk(c)) return true; } return false; };
  walk(root); return out;
}

// ----------------------------------------------------------------- parser ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', middot: '·', deg: '°', times: '×', mdash: '—', ndash: '–', rarr: '→', larr: '←', check: '✓' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
function serialize(n) {
  if (n instanceof Text) return n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (!(n instanceof Element)) return '';
  const a = [...n._attrs].map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`).join('');
  return VOID.has(n.localName) ? `<${n.localName}${a}>` : `<${n.localName}${a}>${n.childNodes.map(serialize).join('')}</${n.localName}>`;
}
export function parseInto(root, html) {
  const stack = [root]; let i = 0; const top = () => stack[stack.length - 1];
  const SVG = 'http://www.w3.org/2000/svg';
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { top().appendChild(new Text(decode(html.slice(i)))); break; }
    if (lt > i) top().appendChild(new Text(decode(html.slice(i, lt))));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt); i = e < 0 ? html.length : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e < 0 ? html.length : e + 1; continue; }
    if (html[lt + 1] === '/') { const e = html.indexOf('>', lt); const name = html.slice(lt + 2, e).trim().toLowerCase(); i = e + 1; for (let k = stack.length - 1; k > 0; k--) if (stack[k].localName === name) { stack.length = k; break; } continue; }
    // start tag, with quoted attribute values that may contain '>'
    let j = lt + 1; const m = /^[a-zA-Z][-\w:]*/.exec(html.slice(j)); if (!m) { top().appendChild(new Text('<')); i = lt + 1; continue; }
    const name = m[0].toLowerCase(); j += m[0].length;
    const el = name === 'canvas' ? makeCanvasElement() : new Element(name, stack.some((s) => s.localName === 'svg') || name === 'svg' ? SVG : undefined);
    for (;;) {
      while (/\s/.test(html[j])) j++;
      if (html[j] === '>') { j++; break; } if (html[j] === '/' && html[j + 1] === '>') { j += 2; el._selfClose = true; break; } if (j >= html.length) break;
      const am = /^[^\s=>/]+/.exec(html.slice(j)); if (!am) { j++; continue; } j += am[0].length; let val = '';
      while (/\s/.test(html[j])) j++;
      if (html[j] === '=') { j++; while (/\s/.test(html[j])) j++; if (html[j] === '"' || html[j] === "'") { const q = html[j], e = html.indexOf(q, j + 1); val = html.slice(j + 1, e); j = e + 1; } else { const vm = /^[^\s>]+/.exec(html.slice(j)); val = vm ? vm[0] : ''; j += val.length; } }
      el.setAttribute(am[0].toLowerCase() === 'viewbox' ? 'viewBox' : am[0], decode(val));
    }
    top().appendChild(el);
    if (RAW.has(name) && !el._selfClose) { const e = html.toLowerCase().indexOf('</' + name, j); const body = html.slice(j, e < 0 ? html.length : e); if (body) el.appendChild(new Text(body)); const ge = html.indexOf('>', e); i = e < 0 ? html.length : ge + 1; }
    else { i = j; if (!VOID.has(name) && !el._selfClose) stack.push(el); }
  }
}
export function parseDocument(html) { const d = new Doc(); parseInto(d, html); d.readyState = 'interactive'; return d; }

// ------------------------------------------------------------- the window ----
// Set by the app entry: how the page's boxes are computed (js/clocklayout.js for the clock, the canvas size, zero for the rest).
let layoutHook = (el) => rect(0, 0, 0, 0);
export function setLayoutHook(fn) { layoutHook = fn; }
let makeCanvasElement = () => { throw new Error('no canvas factory'); };
export function setCanvasFactory(fn) { makeCanvasElement = fn; }
export function computedStyle(el) {
  if (el._csv === VER && el._cs) return el._cs;
  const own = (k) => { let n = el; while (n instanceof Element) { const v = n.style.getPropertyValue(k); if (v) return v; n = n.parentNode; } return ''; };
  const cls = el.getAttribute && el.getAttribute('class') || '';
  const display = el.style.display || (el.hasAttribute && el.hasAttribute('hidden') ? 'none' : /(^|\s)hidden(\s|$)/.test(cls) && el.localName === 'svg' ? 'none' : el.localName === 'span' || el.localName === 'a' ? 'inline' : 'block');
  const o = { display, visibility: el.style.visibility || 'visible', opacity: el.style.opacity || '1', transform: el.style.transform || 'none', position: 'static', getPropertyValue: (k) => (k.startsWith('--') ? own(k) : el.style.getPropertyValue(k) || ''), setProperty() {}, removeProperty() {}, fontSize: '16px', direction: 'ltr' };
  const cs = new Proxy(o, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? el.style.getPropertyValue(dash(k)) : undefined) });
  el._cs = cs; el._csv = VER;
  return cs;
}
