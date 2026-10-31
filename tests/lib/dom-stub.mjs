// Just enough of a browser for node to import the app's modules that touch the page at load (config.js, core.js, ...):
// a localStorage backed by a Map, and a document whose elements accept everything and do nothing.

export function installDomStub({ storage = {}, search = '', language = 'en-US' } = {}) {
  const store = new Map(Object.entries(storage).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const el = () => {
    const e = {
      style: { setProperty() {}, getPropertyValue: () => '', removeProperty() {} },
      classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
      dataset: {}, hidden: false, children: [], value: '', checked: false, textContent: '', innerHTML: '',
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
      appendChild() {}, remove() {}, closest: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    };
    return e;
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    get _store() { return store; },
  };
  globalThis.document = {
    hidden: false, readyState: 'complete', title: '',
    querySelector: () => el(), querySelectorAll: () => [], getElementById: () => null, createElement: () => el(),
    addEventListener() {}, removeEventListener() {}, body: el(), documentElement: el(),
  };
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.dispatchEvent = () => true;
  globalThis.location = { search, hostname: 'test.local', href: 'http://test.local/' };
  Object.defineProperty(globalThis, 'navigator', { value: { language, languages: [language], userAgent: 'node', onLine: true }, configurable: true });
  globalThis.Event = globalThis.Event || class Event { constructor(t) { this.type = t; } };
  return { store };
}

/** Import a module afresh (its top-level code runs again), e.g. after seeding a different localStorage. */
let n = 0;
export const importFresh = (path) => import(`${path}?fresh=${++n}`);
