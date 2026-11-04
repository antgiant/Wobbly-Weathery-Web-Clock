// LED panel layouts: matrix.cfg in and out, the wiring patterns, the checks and the drawing (native/cli/panel.mjs).
import { check, done } from '../lib/check.mjs';
const P = await import('../../native/cli/panel.mjs');
const T = await import('../../native/cli/patterns.mjs');

// the sample from the rpi-fb-matrix fork: a 2 x 2 of 32 x 32 panels, snaking from the upper right
const SAMPLE = `// comment
display_width = 64;
display_height = 64;
panel_width = 32;   // always 32
panel_height = 32;
chain_length = 4;
parallel_count = 1;
// a comment with ( parentheses ) and { braces } in it
panels = (
  ( { order = 1; rotate =   0; }, { order = 0; rotate =   0; } ),
  ( { order = 2; rotate = 180; }, { order = 3; rotate = 180; } )
)
//crop_origin = (0, 0)
`;
const cfg = P.parseMatrixCfg(SAMPLE);
check('the real matrix.cfg is read: sizes, chain, parallel and the panels grid', cfg.displayWidth === 64 && cfg.displayHeight === 64 && cfg.panelWidth === 32 && cfg.chainLength === 4 && cfg.parallelCount === 1 && JSON.stringify(cfg.panels.map((r) => r.map((t) => [t.order, t.rotate]))) === '[[[1,0],[0,0]],[[2,180],[3,180]]]' && cfg.cropOrigin === null);
check('the sample is valid', P.validate(cfg).length === 0, P.validate(cfg).join('; '));
const again = P.parseMatrixCfg(P.writeMatrixCfg(cfg));
check('writing then reading gives the same layout', JSON.stringify(again) === JSON.stringify(cfg));
check('a crop_origin is kept, and a parallel id', (() => { const c = P.parseMatrixCfg('display_width=64;display_height=32;panel_width=32;panel_height=32;chain_length=1;parallel_count=2;\npanels = (\n ( { order = 0; rotate = 0; parallel = 0; }, { order = 0; rotate = 0; parallel = 1; } )\n)\ncrop_origin = (10, 20)'); return c.cropOrigin?.join() === '10,20' && c.panels[0][1].parallel === 1 && P.writeMatrixCfg(c).includes('parallel = 1') && P.writeMatrixCfg(c).includes('crop_origin = (10, 20)'); })());

// plain answers -> the grid
const sample = P.fromAnswers({ panelWidth: 32, panelHeight: 32, across: 2, down: 2, entry: 'top-right', wiring: 'snake-across' });
check('"cable in at the top right, snake across then down" gives exactly the sample\'s grid', JSON.stringify(sample.panels) === JSON.stringify(cfg.panels.map((r) => r.map((t) => ({ ...t, parallel: 0 })))));
const grid = (a) => P.fromAnswers({ panelWidth: 32, panelHeight: 16, ...a }).panels.map((r) => r.map((t) => t.order).join('')).join('/');
check('one row runs from the entry corner either way', grid({ across: 4, down: 1, entry: 'top-left', wiring: 'row' }) === '0123' && grid({ across: 4, down: 1, entry: 'top-right', wiring: 'row' }) === '3210');
check('one column runs down or up', grid({ across: 1, down: 3, entry: 'top-left', wiring: 'column' }) === '0/1/2' && grid({ across: 1, down: 3, entry: 'bottom-left', wiring: 'column' }) === '2/1/0');
check('snake across alternates, from any corner', grid({ across: 3, down: 2, entry: 'top-left', wiring: 'snake-across' }) === '012/543' && grid({ across: 3, down: 2, entry: 'bottom-left', wiring: 'snake-across' }) === '543/012' && grid({ across: 3, down: 2, entry: 'bottom-right', wiring: 'snake-across' }) === '345/210');
check('snake down alternates by column', grid({ across: 2, down: 3, entry: 'top-left', wiring: 'snake-down' }) === '05/14/23');
check('every row the same way (cable runs back): no panel is turned', grid({ across: 3, down: 2, entry: 'top-left', wiring: 'rows-same-side' }) === '012/345' && P.fromAnswers({ panelWidth: 32, panelHeight: 16, across: 3, down: 2, wiring: 'rows-same-side' }).panels.flat().every((t) => t.rotate === 0));
check('a snake turns the returning rows half a turn; every wiring gives each number once', ['row', 'snake-across', 'snake-down', 'rows-same-side', 'columns-same-side'].every((w) => ['top-left', 'top-right', 'bottom-left', 'bottom-right'].every((e) => { const c = P.fromAnswers({ panelWidth: 32, panelHeight: 16, across: 3, down: 3, entry: e, wiring: w }); return c.panels.flat().map((t) => t.order).sort((a, b) => a - b).join() === '0,1,2,3,4,5,6,7,8' && P.validate(c).length === 0; })));
check('the totals follow from the answers', P.fromAnswers({ panelWidth: 64, panelHeight: 32, across: 3, down: 2, wiring: 'snake-across' }).displayWidth === 192 && P.totals(sample) === '64 x 64 pixels, 4 panels of 32 x 32, one chain of 4');
const par = P.fromAnswers({ panelWidth: 32, panelHeight: 32, across: 2, down: 2, wiring: 'row', parallel: 2 });
check('parallel chains: each chain numbers its own panels from 0 and the longest sets chain_length', par.parallelCount === 2 && par.chainLength === 2 && P.validate(par).length === 0 && /2 parallel chains/.test(P.totals(par)), JSON.stringify(par.panels.map((r) => r.map((t) => `${t.parallel}:${t.order}`))));

// the checks say what is wrong, in words
const v = (patch, ...rest) => P.validate({ ...cfg, ...patch }, ...rest);
check('a width that is not a multiple of the panel is refused, with the likely fix', /not a multiple of panel_width.*Try 64/.test(v({ displayWidth: 65 })[0]), v({ displayWidth: 65 }).join());
check('a height likewise; a strange panel height is questioned', /display_height \(70\).*Try 64/.test(v({ displayHeight: 70 }).join()) && /8, 16, 32 or 64 high/.test(v({ panelHeight: 20 }).join()));
check('a grid that does not match the display is refused', /grid is 2 across by 1 down, but the display needs 2 by 2/.test(v({ panels: [cfg.panels[0]] }).join()));
check('the Adafruit HAT allows one chain; the Zero has the pins for one; more than three is never allowed', /HAT drives one chain/.test(v({ parallelCount: 2 }, null, 'adafruit-hat').join()) && /only has the pins for one chain/.test(v({ parallelCount: 2 }, { name: 'Pi Zero', arch: 'armv6l' }).join()) && /up to 3/.test(v({ parallelCount: 4 }).join()));
check('a chain with a gap or a repeat in its numbering is refused', /does not number its panels/.test(v({ panels: [[{ order: 0, rotate: 0 }, { order: 0, rotate: 0 }], cfg.panels[1]] }).join()));
check('chain_length that is not the longest chain is corrected', /chain_length is 3, but the longest chain has 4 panels\. Use 4/.test(v({ chainLength: 3 }).join()));
check('a rotation that is not a quarter turn is refused', /rotation/.test(v({ panels: [[{ order: 1, rotate: 45 }, cfg.panels[0][1]], cfg.panels[1]] }).join()));

// drawing
const art = P.draw(cfg);
check('the drawing shows each panel\'s order and rotation, arrows along the chain, and where the cable goes in', art.includes('order 0') && art.includes('order 3') && art.includes('rot 180') && /order 1.*<=.*order 0/.test(art) && /order 2.*=>.*order 3/.test(art) && /v/.test(art) && /order 0.*cable/.test(art), '\n' + art);

// test patterns
const px = (f, x, y) => Array.from(f.data.slice((y * f.w + x) * 3, (y * f.w + x) * 3 + 3));
const b = T.bars(64, 24);
check('the bars run white, yellow, cyan, green, magenta, red, blue, black (a colour order mistake shows at once) and the grey ramp rises', ['255,255,255', '255,255,0', '0,255,255', '0,255,0', '255,0,255', '255,0,0', '0,0,255', '0,0,0'].every((c, i) => px(b, i * 8 + 1, 2).join() === c) && px(b, 0, 22)[0] === 0 && px(b, 63, 22)[0] === 255 && px(b, 32, 22)[0] > px(b, 16, 22)[0]);
const id = T.identify(cfg);
check('identify fills the whole display, marks each tile\'s top-left corner white, and numbers the tiles', id.w === 64 && id.h === 64 && [[0, 0], [32, 0], [0, 32], [32, 32]].every(([x, y]) => px(id, x + 1, y + 1).join() === '255,255,255') && px(id, 40, 20).some((v) => v > 0) === true);
check('identify draws different tiles differently (so a swapped tile shows)', new Set([[10, 28], [42, 28], [10, 60], [42, 60]].map(([x, y]) => px(id, x, y).join())).size >= 3);
const bd = T.border(64, 32);
check('the border lights exactly the outer ring', px(bd, 0, 0).join() === '255,255,255' && px(bd, 63, 31).join() === '255,255,255' && px(bd, 31, 0)[0] === 255 && px(bd, 31, 31)[0] === 255 && px(bd, 31, 15)[0] === 0 && Array.from(bd.data).filter((x) => x === 255).length === 3 * (2 * 64 + 2 * 30));
check('the brightness sweep goes from black to white', T.level(4, 4, 0).data[0] === 0 && T.level(4, 4, 1).data[0] === 255 && T.level(4, 4, 0.5).data[0] === 128);
const seq = T.sequence(cfg);
check('the test sequence has four steps, each saying what a wrong result means', seq.length === 4 && seq.every((s) => s.seconds > 0 && s.expect.length > 40 && s.frame(1).w === 64) && /led-rgb-sequence/.test(seq[0].expect) && /rotate/.test(seq[1].expect));
done();
