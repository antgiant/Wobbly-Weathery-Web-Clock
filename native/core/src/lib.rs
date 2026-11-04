//! Wobbly core: the logic the native clock must share exactly with the web page. No I/O, no dependencies, `no_std`-friendly maths
//! (only `f64` arithmetic). Every function is checked against vectors generated from the web code (`tests/golden.tsv`, made by
//! `tools/native-golden.mjs`), so a change on either side that breaks the agreement fails a test.

pub mod clock;
pub mod config;
pub mod countdown;
pub mod digits;
pub mod dim;
pub mod disc;
pub mod effects;
pub mod frame;
pub mod glass;
pub mod sky;
pub mod skytable;
pub mod stars;
pub mod sun;
pub mod weather;
pub mod wind;
pub mod weathertable;
pub mod tz;
pub mod morph;
pub mod raster;
pub mod live;
pub mod matrix;
pub mod output;
pub mod scene;
pub mod season;
pub mod sink;
