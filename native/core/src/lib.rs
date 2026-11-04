//! What the native clock program needs that is not the web page: the settings file it reads, the mapping of the picture onto a chain of LED
//! panels, gamma, framebuffer bytes, and the pipe to the panel program. (The clock itself, sky and all, is the web page's own code, run by
//! `native/host`; this crate used to hold a Rust re-implementation of it, which was retired so that there is one renderer, not two.)

pub mod config;
pub mod matrix;
pub mod output;
pub mod sink;
