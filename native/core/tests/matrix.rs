//! matrix.cfg and the chain mapping: the real sample from rpi-fb-matrix, every rotation, and that nothing is lost or doubled.
use wobbly_core::matrix::{parse, Layout, Tile};

const SAMPLE: &str = "// comment
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
";

#[test]
fn reads_the_real_sample() {
    let l = parse(SAMPLE).unwrap();
    assert_eq!((l.display_width, l.display_height, l.panel_width, l.chain_length, l.parallel_count), (64, 64, 32, 4, 1));
    let got: Vec<Vec<(usize, u32)>> = l.tiles.iter().map(|r| r.iter().map(|t| (t.order, t.rotate)).collect()).collect();
    assert_eq!(got, vec![vec![(1, 0), (0, 0)], vec![(2, 180), (3, 180)]]);
    assert_eq!(l.canvas_size(), (128, 32));
}

#[test]
fn says_what_is_wrong() {
    let bad = |from: &str, to: &str| parse(&SAMPLE.replace(from, to)).unwrap_err();
    assert!(bad("display_width = 64", "display_width = 65").contains("not a multiple of panel_width"));
    assert!(bad("chain_length = 4", "chain_length = 3").contains("chain_length is 3"));
    assert!(bad("order = 3", "order = 5").contains("does not number its panels"));
    assert!(bad("rotate = 180; }, { order = 3", "rotate =  45; }, { order = 3").contains("quarter turn"));
    assert!(bad("parallel_count = 1", "parallel_count = 4").contains("1 to 3"));
    assert!(parse("panel_width = 32;").unwrap_err().contains("display_width is missing"));
}

#[test]
fn the_snake_maps_where_the_wiring_says() {
    let l = parse(SAMPLE).unwrap();
    // top-right panel is order 0: its top-left pixel is the first on the chain
    assert_eq!(l.to_canvas(32, 0), (0, 0));
    // top-left panel is order 1, upright: it starts 32 along the chain
    assert_eq!(l.to_canvas(0, 0), (32, 0));
    // bottom-left panel is order 2 and turned half a turn: its top-left display pixel lands at its far corner
    assert_eq!(l.to_canvas(0, 32), (2 * 32 + 31, 31));
    // bottom-right panel is order 3, turned: display pixel (32+5, 32+7) -> local (5,7) -> (26,24) on panel 3
    assert_eq!(l.to_canvas(37, 39), (3 * 32 + 26, 24));
}

#[test]
fn every_pixel_goes_somewhere_unique_for_every_rotation() {
    for rot in [0u32, 90, 180, 270] {
        let l = Layout { display_width: 16, display_height: 16, panel_width: 8, panel_height: 8, chain_length: 4, parallel_count: 1,
            tiles: vec![vec![Tile { order: 0, rotate: rot, parallel: 0 }, Tile { order: 1, rotate: 0, parallel: 0 }], vec![Tile { order: 3, rotate: rot, parallel: 0 }, Tile { order: 2, rotate: 180, parallel: 0 }]] };
        assert!(wobbly_core::matrix::validate(&l).is_ok());
        let (cw, ch) = l.canvas_size();
        let mut seen = vec![false; cw * ch];
        for y in 0..16 { for x in 0..16 { let (cx, cy) = l.to_canvas(x, y); assert!(cx < cw && cy < ch, "rot {rot}: ({x},{y}) -> ({cx},{cy}) off the canvas"); assert!(!seen[cy * cw + cx], "rot {rot}: two pixels land on ({cx},{cy})"); seen[cy * cw + cx] = true; } }
        assert_eq!(seen.iter().filter(|b| **b).count(), 256);
    }
}

#[test]
fn parallel_chains_stack_and_frames_keep_their_pixels() {
    let l = Layout { display_width: 8, display_height: 8, panel_width: 4, panel_height: 4, chain_length: 2, parallel_count: 2,
        tiles: vec![vec![Tile { order: 0, rotate: 0, parallel: 0 }, Tile { order: 1, rotate: 0, parallel: 0 }], vec![Tile { order: 0, rotate: 0, parallel: 1 }, Tile { order: 1, rotate: 0, parallel: 1 }]] };
    assert_eq!(l.canvas_size(), (8, 8));
    let frame: Vec<u8> = (0..8 * 8 * 3).map(|i| (i % 251) as u8).collect();
    let out = l.map_frame(&frame);
    assert_eq!(out.len(), frame.len());
    let mut a = frame.clone(); a.sort_unstable();
    let mut b = out.clone(); b.sort_unstable();
    assert_eq!(a, b, "no pixel may be lost or invented");
    // the second chain's first panel (display row 4) sits below the first chain on the canvas
    assert_eq!(l.to_canvas(0, 4), (0, 4));
}

#[test]
fn reads_what_the_node_command_line_writes() {
    // tests/matrix/*.cfg are written by native/cli/panel.mjs (tools/native-golden.mjs), *.expect is what the Node side meant
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/matrix");
    let mut n = 0;
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.extension().map(|x| x != "cfg").unwrap_or(true) { continue; }
        let l = parse(&std::fs::read_to_string(&p).unwrap()).unwrap_or_else(|m| panic!("{}: {m}", p.display()));
        let want = std::fs::read_to_string(p.with_extension("expect")).unwrap();
        let mut lines = want.lines();
        let head: Vec<usize> = lines.next().unwrap().split(' ').map(|x| x.parse().unwrap()).collect();
        assert_eq!((l.display_width, l.display_height, l.chain_length, l.parallel_count), (head[0], head[1], head[2], head[3]), "{}", p.display());
        let got: Vec<String> = l.tiles.iter().map(|r| r.iter().map(|t| format!("{}:{}:{}", t.order, t.rotate, t.parallel)).collect::<Vec<_>>().join(" ")).collect();
        let exp: Vec<&str> = lines.collect();
        assert_eq!(got, exp, "{}", p.display());
        // and every pixel lands on the canvas once
        let (cw, ch) = l.canvas_size();
        let mut seen = vec![false; cw * ch];
        for y in 0..l.display_height { for x in 0..l.display_width { let (cx, cy) = l.to_canvas(x, y); assert!(!seen[cy * cw + cx]); seen[cy * cw + cx] = true; } }
        n += 1;
    }
    assert_eq!(n, 5);
}
