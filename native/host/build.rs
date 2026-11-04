// Puts the page's files into the program, so the Pi needs one file and an update replaces everything: index.html, js/, the settings schema and
// the data (stars, moon, Milky Way). `--web DIR` at run time uses a folder instead (for working on the page).
use std::fs;
use std::path::{Path, PathBuf};

fn walk(dir: &Path, out: &mut Vec<PathBuf>, keep: &dyn Fn(&Path) -> bool) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut es: Vec<_> = rd.flatten().collect();
    es.sort_by_key(|e| e.file_name());
    for e in es {
        let p = e.path();
        if p.is_dir() { walk(&p, out, keep); } else if keep(&p) { out.push(p); }
    }
}

fn main() {
    // ARMv6 (the original Pi Zero) has no 64-bit atomic instructions; QuickJS's Atomics need them from libatomic
    if std::env::var("CARGO_CFG_TARGET_ARCH").map_or(false, |a| a == "arm") && std::env::var("WOBBLY_NO_LIBATOMIC").is_err() { println!("cargo:rustc-link-arg=-Wl,--no-as-needed,-latomic"); }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let mut files: Vec<PathBuf> = vec![root.join("index.html")];
    walk(&root.join("js"), &mut files, &|p| p.extension().map_or(false, |x| x == "js"));
    walk(&root.join("schema"), &mut files, &|p| p.extension().map_or(false, |x| x == "js"));
    walk(&root.join("data"), &mut files, &|p| p.extension().map_or(false, |x| x == "bin" || x == "jpg" || x == "png"));
    let mut code = String::from("pub const WEB: &[(&str, &[u8])] = &[\n");
    for f in &files {
        if !f.exists() { continue; }
        let rel = f.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        code.push_str(&format!("    ({:?}, include_bytes!({:?})),\n", rel, f.to_string_lossy()));
        println!("cargo:rerun-if-changed={}", f.to_string_lossy());
    }
    code.push_str("];\n");
    for d in ["js", "schema", "data"] { println!("cargo:rerun-if-changed={}", root.join(d).to_string_lossy()); }
    println!("cargo:rerun-if-changed={}", root.join("index.html").to_string_lossy());
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("web_files.rs");
    fs::write(out, code).unwrap();
}
