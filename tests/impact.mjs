// Which browser suites a change can break. `npm test` runs lint, the unit tests (a few seconds) and only the browser
// suites the changed files can affect, each trimmed to its core, so a typical change is checked in well under a minute.
// A change to something everything depends on (the engine, the scheduler, config) runs the whole quick check, which takes
// minutes. CI and `npm run test:full` always run everything.
//
// Every file under js/ must match a rule (tests/unit/impact.test.mjs fails otherwise), so a new file cannot silently be
// left untested.

export const ALL_FAST = ['smoke', 'clock', 'countdown', 'settings', 'sky', 'options', 'led', 'alerts', 'wind', 'digitweather', 'offline', 'startup'];

// [pattern on the path, suites to run]. The first matching rules all apply.
export const RULES = [
  [/^js\/(wind\.js|sky\/windsway\.js)$/, ['wind', 'clock']],
  [/^js\/(clock|easing)\.js$/, ['clock', 'countdown', 'wind', 'led']],
  [/^js\/countdown\.js$/, ['countdown', 'clock']],
  [/^js\/(config|units|simtime|location|index)\.js$/, 'ALL'],
  [/^js\/(season)\.js$/, ['options', 'christmas']],
  [/^js\/(install)\.js$/, ['options']],
  [/^js\/(offline|version)\.js$|^sw\.js$|^manifest\.webmanifest$|^icons\//, ['offline', 'smoke']],
  [/^js\/(wakelock|settings_gear)\.js$/, ['settings', 'options']],
  [/^js\/sky\/glsl-scene\.js$/, ['sky', 'led', 'digitweather']],
  [/^js\/sky\/glass\.js$/, ['sky', 'led', 'digitweather', 'options']],
  [/^js\/sky\/(glsl-plants|plants|biome|landscape|lightpollution)\.js$/, ['sky', 'smoke']],
  [/^js\/sky\/(astro|glsl-atmosphere)\.js$/, ['sky', 'led', 'alerts']],
  [/LICENSE|\.txt$|\.md$/, []],                                          // licences and notes: nothing to run
  [/^js\/sky\/(ledgrid|ledpanel|ledcard)\.js$/, ['led', 'alerts']],
  [/^js\/sky\/(alerts|sunpath|rain)\.js$/, ['alerts', 'options']],
  [/^js\/sky\/(presets|bindings|dim)\.js$/, ['settings', 'options']],
  [/^js\/sky\/(burnin)\.js$/, ['options']],
  [/^js\/sky\/(weather|data)\.js$/, ['sky', 'alerts', 'digitweather']],
  [/^js\/sky\/(view|controls|orientation)\.js$/, ['startup', 'sky', 'wind']],
  [/^js\/sky\/(engine|scheduler|app|core|appearance)\.js$/, 'ALL'],
  [/^js\/(vendor|virgo)\//, ['sky', 'smoke']],
  [/^(index\.html|styles\.css)$/, ['smoke', 'settings', 'options', 'led']],
  [/^data\//, ['sky', 'smoke']],
  [/^tests\/browser\/([a-z]+)\.test\.mjs$/, (m) => [m[1]]],
  [/^tests\/(lib\/|run\.mjs|impact\.mjs)/, 'ALL'],
];

/** @returns {{suites: string[], all: boolean, reasons: Object<string,string[]>}} */
export function suitesFor(files) {
  const suites = new Set(['smoke']), reasons = {};
  let all = false;
  for (const f of files) {
    for (const [re, what] of RULES) {
      const m = re.exec(f);
      if (!m) continue;
      const list = what === 'ALL' ? ALL_FAST : typeof what === 'function' ? what(m) : what;
      if (what === 'ALL') all = true;
      for (const s of list) { suites.add(s); (reasons[s] ||= []).push(f); }
    }
  }
  return { suites: [...suites], all, reasons };
}
