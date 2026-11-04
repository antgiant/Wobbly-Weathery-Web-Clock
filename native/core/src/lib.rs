//! Wobbly core: the logic the native clock must share exactly with the web page. No I/O, no dependencies, `no_std`-friendly maths
//! (only `f64` arithmetic). Every function is checked against vectors generated from the web code (`tests/golden.tsv`, made by
//! `tools/native-golden.mjs`), so a change on either side that breaks the agreement fails a test.

pub mod countdown;
pub mod digits;
pub mod dim;
pub mod morph;
pub mod raster;
