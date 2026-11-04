//! LED panels: reading rpi-fb-matrix's `matrix.cfg` and mapping the picture onto the chain the hub75 library drives. The same file and the same
//! meaning as the Node command line's `panel.mjs` (`order` is a panel's place along its chain, `rotate` its turn in degrees, `parallel` its chain).

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tile { pub order: usize, pub rotate: u32, pub parallel: usize }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    pub display_width: usize,
    pub display_height: usize,
    pub panel_width: usize,
    pub panel_height: usize,
    pub chain_length: usize,
    pub parallel_count: usize,
    pub tiles: Vec<Vec<Tile>>,
}

fn strip_comments(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '/' && chars.peek() == Some(&'/') { while let Some(&n) = chars.peek() { if n == '\n' { break; } chars.next(); } }
        else if c == '#' { while let Some(&n) = chars.peek() { if n == '\n' { break; } chars.next(); } }
        else if c == '/' && chars.peek() == Some(&'*') { chars.next(); let mut prev = ' '; for n in chars.by_ref() { if prev == '*' && n == '/' { break; } prev = n; } }
        else { out.push(c); }
    }
    out
}

fn number(src: &str, name: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(i) = src[from..].find(name) {
        let at = from + i;
        let before_ok = at == 0 || !src.as_bytes()[at - 1].is_ascii_alphanumeric() && src.as_bytes()[at - 1] != b'_';
        let rest = src[at + name.len()..].trim_start();
        if before_ok && rest.starts_with('=') {
            let v: String = rest[1..].trim_start().chars().take_while(|c| c.is_ascii_digit()).collect();
            return v.parse().ok();
        }
        from = at + name.len();
    }
    None
}

fn field(body: &str, name: &str) -> Option<i64> {
    let i = body.find(name)?;
    let rest = body[i + name.len()..].trim_start().strip_prefix('=')?.trim_start();
    let v: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '-').collect();
    v.parse().ok()
}

/// Parse a matrix.cfg (libconfig text). Returns an error in words for a missing or inconsistent value.
pub fn parse(text: &str) -> Result<Layout, String> {
    let src = strip_comments(text);
    let get = |n: &str| number(&src, n).ok_or(format!("matrix.cfg: {n} is missing"));
    let (dw, dh, pw, ph) = (get("display_width")?, get("display_height")?, get("panel_width")?, get("panel_height")?);
    let chain = get("chain_length")?;
    let parallel = number(&src, "parallel_count").unwrap_or(1);
    let at = src.find("panels").ok_or("matrix.cfg: panels is missing")?;
    let body = &src[at..];
    let start = body.find('(').ok_or("matrix.cfg: panels has no list")?;
    let (mut depth, mut row, mut rows, mut end) = (0, String::new(), Vec::<String>::new(), body.len());
    for (i, ch) in body[start..].char_indices() {
        match ch {
            '(' => { depth += 1; if depth == 2 { row.clear(); continue; } }
            ')' => { depth -= 1; if depth == 1 { rows.push(row.clone()); continue; } if depth == 0 { end = start + i; break; } }
            _ => {}
        }
        if depth >= 2 { row.push(ch); }
    }
    let _ = end;
    let tiles: Vec<Vec<Tile>> = rows.iter().map(|r| {
        r.split('{').skip(1).map(|g| { let g = g.split('}').next().unwrap_or(""); Tile { order: field(g, "order").unwrap_or(0).max(0) as usize, rotate: field(g, "rotate").unwrap_or(0).rem_euclid(360) as u32, parallel: field(g, "parallel").unwrap_or(0).max(0) as usize } }).collect()
    }).collect();
    let layout = Layout { display_width: dw, display_height: dh, panel_width: pw, panel_height: ph, chain_length: chain, parallel_count: parallel, tiles };
    validate(&layout)?;
    Ok(layout)
}

/// The checks (each in words): sizes are multiples of the panel, the grid matches, every chain is numbered 0, 1, 2 ... and the rotations are quarter turns.
pub fn validate(l: &Layout) -> Result<(), String> {
    if l.panel_width == 0 || l.panel_height == 0 || l.display_width % l.panel_width != 0 { return Err(format!("display_width ({}) is not a multiple of panel_width ({})", l.display_width, l.panel_width)); }
    if l.display_height % l.panel_height != 0 { return Err(format!("display_height ({}) is not a multiple of panel_height ({})", l.display_height, l.panel_height)); }
    let (across, down) = (l.display_width / l.panel_width, l.display_height / l.panel_height);
    if l.tiles.len() != down || l.tiles.iter().any(|r| r.len() != across) { return Err(format!("the panels grid must be {across} across by {down} down")); }
    if l.parallel_count == 0 || l.parallel_count > 3 { return Err(format!("parallel_count is {}; it must be 1 to 3", l.parallel_count)); }
    for p in 0..l.parallel_count {
        let mut orders: Vec<usize> = l.tiles.iter().flatten().filter(|t| t.parallel == p).map(|t| t.order).collect();
        orders.sort_unstable();
        if orders.iter().enumerate().any(|(i, o)| *o != i) { return Err(format!("chain {p} does not number its panels 0, 1, 2 ... in a row")); }
        if orders.len() > l.chain_length { return Err(format!("chain {p} has {} panels but chain_length is {}", orders.len(), l.chain_length)); }
    }
    if l.tiles.iter().flatten().any(|t| t.parallel >= l.parallel_count) { return Err("a panel is on a parallel chain that does not exist".into()); }
    if l.tiles.iter().flatten().any(|t| t.rotate % 90 != 0) { return Err("a panel's rotation is not a quarter turn".into()); }
    if l.tiles.iter().flatten().any(|t| (t.rotate == 90 || t.rotate == 270) && l.panel_width != l.panel_height) { return Err("a quarter-turn rotation needs square panels".into()); }
    Ok(())
}

impl Layout {
    /// The size of the canvas the hub75 library drives: all the chains side by side along x, the parallel chains stacked along y.
    pub fn canvas_size(&self) -> (usize, usize) { (self.chain_length * self.panel_width, self.parallel_count * self.panel_height) }

    /// Where display pixel (x, y) goes on the canvas.
    pub fn to_canvas(&self, x: usize, y: usize) -> (usize, usize) {
        let (pw, ph) = (self.panel_width, self.panel_height);
        let t = &self.tiles[y / ph][x / pw];
        let (lx, ly) = (x % pw, y % ph);
        let (rx, ry) = match t.rotate { 90 => (ph - 1 - ly, lx), 180 => (pw - 1 - lx, ph - 1 - ly), 270 => (ly, pw - 1 - lx), _ => (lx, ly) };
        (t.order * pw + rx, t.parallel * ph + ry)
    }

    /// Rearrange a display frame (RGB, `display_width` x `display_height`) into the canvas the library expects.
    pub fn map_frame(&self, rgb: &[u8]) -> Vec<u8> {
        let (cw, ch) = self.canvas_size();
        let mut out = vec![0u8; cw * ch * 3];
        for y in 0..self.display_height {
            for x in 0..self.display_width {
                let (cx, cy) = self.to_canvas(x, y);
                let (s, d) = ((y * self.display_width + x) * 3, (cy * cw + cx) * 3);
                out[d..d + 3].copy_from_slice(&rgb[s..s + 3]);
            }
        }
        out
    }
}
