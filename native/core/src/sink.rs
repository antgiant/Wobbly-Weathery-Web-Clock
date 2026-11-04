//! The LED panel sink: wobbly-clock-run starts `wobbly-matrix` (native/matrix-sink, the C end that talks to the hub75 library) and streams frames to it.

use crate::config::LedOptions;
use crate::matrix::Layout;
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};

/// The library's own `--led-*` flags for a layout and the configured options.
pub fn matrix_args(l: &Layout, o: &LedOptions) -> Vec<String> {
    let mut a = vec![
        format!("--led-rows={}", l.panel_height), format!("--led-cols={}", l.panel_width), format!("--led-chain={}", l.chain_length), format!("--led-parallel={}", l.parallel_count),
        format!("--led-gpio-mapping={}", o.gpio_mapping), format!("--led-slowdown-gpio={}", o.slowdown_gpio), format!("--led-pwm-bits={}", o.pwm_bits),
        format!("--led-pwm-lsb-nanoseconds={}", o.pwm_lsb_nanoseconds), format!("--led-rgb-sequence={}", o.rgb_sequence),
        format!("--led-multiplexing={}", o.multiplexing), format!("--led-row-addr-type={}", o.row_addr_type),
    ];
    if !o.panel_type.is_empty() { a.push(format!("--led-panel-type={}", o.panel_type)); }
    a
}

pub struct MatrixSink { child: Child, stdin: ChildStdin }

impl MatrixSink {
    /// Start the C program (`WOBBLY_MATRIX_BIN`, else `wobbly-matrix` on the PATH).
    pub fn spawn(l: &Layout, o: &LedOptions) -> Result<MatrixSink, String> {
        let bin = std::env::var("WOBBLY_MATRIX_BIN").unwrap_or_else(|_| "wobbly-matrix".into());
        let mut child = Command::new(&bin).args(matrix_args(l, o)).stdin(Stdio::piped()).spawn()
            .map_err(|e| format!("cannot start {bin}: {e} (build it from native/matrix-sink and put it on the PATH, or set WOBBLY_MATRIX_BIN)"))?;
        let stdin = child.stdin.take().ok_or("no pipe to the panel program")?;
        Ok(MatrixSink { child, stdin })
    }

    /// One frame: `canvas` is `w * h * 3` RGB bytes already arranged for the chain; `brightness` is 1 to 100.
    pub fn send(&mut self, canvas: &[u8], w: usize, h: usize, brightness: u8) -> Result<(), String> {
        if canvas.len() != w * h * 3 { return Err("the canvas has the wrong size".into()); }
        self.stdin.write_all(format!("{w} {h} {brightness}\n").as_bytes()).and_then(|_| self.stdin.write_all(canvas)).and_then(|_| self.stdin.flush())
            .map_err(|e| format!("the panel program stopped: {e}"))
    }

    /// Close the pipe (the panel goes dark) and wait for the program.
    pub fn finish(self) -> Result<(), String> {
        let MatrixSink { mut child, stdin } = self;
        drop(stdin);
        let s = child.wait().map_err(|e| e.to_string())?;
        if s.success() { Ok(()) } else { Err(format!("the panel program exited with {s}")) }
    }
}
