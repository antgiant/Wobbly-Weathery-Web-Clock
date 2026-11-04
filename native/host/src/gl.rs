//! The OpenGL ES calls the engine makes, reached from JavaScript as `__gl(name, ...args)`.
//! Objects are plain integers; typed arrays arrive as ArrayBuffers (the JS side copies them), results go back the same way.

use crate::egl::Egl;
use rquickjs::{ArrayBuffer, Ctx, Result, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CString};

pub struct Gl { egl: Egl, cache: RefCell<HashMap<&'static str, usize>> }

macro_rules! gl {
    ($s:expr, $name:literal, ($($t:ty),*) $(-> $r:ty)?, $($a:expr),*) => {{
        let addr = $s.addr($name);
        let f: unsafe extern "C" fn($($t),*) $(-> $r)? = unsafe { std::mem::transmute(addr) };
        unsafe { f($($a),*) }
    }};
}

fn num(v: &Value) -> f64 { if let Some(n) = v.as_number() { n } else if let Some(b) = v.as_bool() { b as i32 as f64 } else { 0.0 } }
fn bytes<'js>(v: &Value<'js>) -> Option<Vec<u8>> {
    let ab = v.as_object().and_then(|o| ArrayBuffer::from_object(o.clone()))?;
    ab.as_bytes().map(|b| b.to_vec())
}

impl Gl {
    pub fn new(egl: Egl) -> Gl { Gl { egl, cache: RefCell::new(HashMap::new()) } }
    pub fn version(&self) -> String { self.egl.version.clone() }
    fn addr(&self, name: &'static str) -> usize {
        if let Some(a) = self.cache.borrow().get(name) { return *a; }
        let a = self.egl.proc_address(name) as usize;
        if a == 0 { panic!("the GL driver has no {name}"); }
        self.cache.borrow_mut().insert(name, a);
        a
    }
    fn gen(&self, name: &'static str) -> u32 { let mut id = 0u32; match name { "glGenTextures" => gl!(self, "glGenTextures", (i32, *mut u32), 1, &mut id), "glGenBuffers" => gl!(self, "glGenBuffers", (i32, *mut u32), 1, &mut id), "glGenFramebuffers" => gl!(self, "glGenFramebuffers", (i32, *mut u32), 1, &mut id), _ => gl!(self, "glGenVertexArrays", (i32, *mut u32), 1, &mut id) }; id }
    fn del(&self, name: &'static str, id: u32) { match name { "glDeleteTextures" => gl!(self, "glDeleteTextures", (i32, *const u32), 1, &id), "glDeleteBuffers" => gl!(self, "glDeleteBuffers", (i32, *const u32), 1, &id), _ => gl!(self, "glDeleteFramebuffers", (i32, *const u32), 1, &id) }; }

    pub fn call<'js>(&self, ctx: &Ctx<'js>, name: &str, a: &[Value<'js>]) -> Result<Value<'js>> {
        let n = |i: usize| a.get(i).map(num).unwrap_or(0.0);
        let u = |i: usize| n(i) as u32;
        let s = |i: usize| n(i) as i32;
        let f = |i: usize| n(i) as f32;
        let ret = |x: f64| Ok(Value::new_float(ctx.clone(), x));
        let undef = || Ok(Value::new_undefined(ctx.clone()));
        match name {
            "createTexture" => ret(self.gen("glGenTextures") as f64),
            "createBuffer" => ret(self.gen("glGenBuffers") as f64),
            "createFramebuffer" => ret(self.gen("glGenFramebuffers") as f64),
            "createVertexArray" => ret(self.gen("glGenVertexArrays") as f64),
            "deleteTexture" => { self.del("glDeleteTextures", u(0)); undef() }
            "deleteBuffer" => { self.del("glDeleteBuffers", u(0)); undef() }
            "deleteFramebuffer" => { self.del("glDeleteFramebuffers", u(0)); undef() }
            "createShader" => ret(gl!(self, "glCreateShader", (u32) -> u32, u(0)) as f64),
            "shaderSource" => {
                let src = a.get(1).and_then(|v| v.as_string()).and_then(|s| s.to_string().ok()).unwrap_or_default();
                let c = CString::new(src).unwrap_or_default(); let p = c.as_ptr();
                gl!(self, "glShaderSource", (u32, i32, *const *const c_char, *const i32), u(0), 1, &p, std::ptr::null()); undef()
            }
            "compileShader" => { gl!(self, "glCompileShader", (u32), u(0)); undef() }
            "getShaderParameter" => { let mut v = 0i32; gl!(self, "glGetShaderiv", (u32, u32, *mut i32), u(0), u(1), &mut v); ret(v as f64) }
            "getShaderInfoLog" | "getProgramInfoLog" => {
                let mut buf = vec![0u8; 8192]; let mut len = 0i32;
                if name == "getShaderInfoLog" { gl!(self, "glGetShaderInfoLog", (u32, i32, *mut i32, *mut u8), u(0), 8192, &mut len, buf.as_mut_ptr()); }
                else { gl!(self, "glGetProgramInfoLog", (u32, i32, *mut i32, *mut u8), u(0), 8192, &mut len, buf.as_mut_ptr()); }
                let txt = String::from_utf8_lossy(&buf[..len.max(0) as usize]).to_string();
                Ok(rquickjs::String::from_str(ctx.clone(), &txt)?.into_value())
            }
            "createProgram" => ret(gl!(self, "glCreateProgram", () -> u32,) as f64),
            "attachShader" => { gl!(self, "glAttachShader", (u32, u32), u(0), u(1)); undef() }
            "bindAttribLocation" => {
                let nm = a.get(2).and_then(|v| v.as_string()).and_then(|s| s.to_string().ok()).unwrap_or_default();
                let c = CString::new(nm).unwrap_or_default(); gl!(self, "glBindAttribLocation", (u32, u32, *const c_char), u(0), u(1), c.as_ptr()); undef()
            }
            "linkProgram" => { gl!(self, "glLinkProgram", (u32), u(0)); undef() }
            "getProgramParameter" => { let mut v = 0i32; gl!(self, "glGetProgramiv", (u32, u32, *mut i32), u(0), u(1), &mut v); ret(v as f64) }
            "useProgram" => { gl!(self, "glUseProgram", (u32), u(0)); undef() }
            "getUniformLocation" => {
                let nm = a.get(1).and_then(|v| v.as_string()).and_then(|s| s.to_string().ok()).unwrap_or_default();
                let c = CString::new(nm).unwrap_or_default(); ret(gl!(self, "glGetUniformLocation", (u32, *const c_char) -> i32, u(0), c.as_ptr()) as f64)
            }
            "uniform1i" => { if s(0) >= 0 { gl!(self, "glUniform1i", (i32, i32), s(0), s(1)); } undef() }
            "uniform1f" => { if s(0) >= 0 { gl!(self, "glUniform1f", (i32, f32), s(0), f(1)); } undef() }
            "uniform2f" => { if s(0) >= 0 { gl!(self, "glUniform2f", (i32, f32, f32), s(0), f(1), f(2)); } undef() }
            "uniform3f" => { if s(0) >= 0 { gl!(self, "glUniform3f", (i32, f32, f32, f32), s(0), f(1), f(2), f(3)); } undef() }
            "uniform4f" => { if s(0) >= 0 { gl!(self, "glUniform4f", (i32, f32, f32, f32, f32), s(0), f(1), f(2), f(3), f(4)); } undef() }
            "uniformMatrix3fv" => { if s(0) >= 0 { if let Some(b) = bytes(&a[2]) { gl!(self, "glUniformMatrix3fv", (i32, i32, u8, *const f32), s(0), 1, 0, b.as_ptr() as *const f32); } } undef() }
            "texImage2D" => {
                let data = a.get(8).and_then(bytes);
                let p = data.as_ref().map(|d| d.as_ptr() as *const c_void).unwrap_or(std::ptr::null());
                gl!(self, "glTexImage2D", (u32, i32, i32, i32, i32, i32, u32, u32, *const c_void), u(0), s(1), s(2), s(3), s(4), s(5), u(6), u(7), p); undef()
            }
            "texParameteri" => { gl!(self, "glTexParameteri", (u32, u32, i32), u(0), u(1), s(2)); undef() }
            "generateMipmap" => { gl!(self, "glGenerateMipmap", (u32), u(0)); undef() }
            "activeTexture" => { gl!(self, "glActiveTexture", (u32), u(0)); undef() }
            "bindTexture" => { gl!(self, "glBindTexture", (u32, u32), u(0), u(1)); undef() }
            "bindFramebuffer" => { gl!(self, "glBindFramebuffer", (u32, u32), u(0), u(1)); undef() }
            "framebufferTexture2D" => { gl!(self, "glFramebufferTexture2D", (u32, u32, u32, u32, i32), u(0), u(1), u(2), u(3), s(4)); undef() }
            "checkFramebufferStatus" => ret(gl!(self, "glCheckFramebufferStatus", (u32) -> u32, u(0)) as f64),
            "bindBuffer" => { gl!(self, "glBindBuffer", (u32, u32), u(0), u(1)); undef() }
            "bufferData" => {
                if let Some(d) = a.get(1).and_then(bytes) { gl!(self, "glBufferData", (u32, isize, *const c_void, u32), u(0), d.len() as isize, d.as_ptr() as *const c_void, u(2)); }
                else { gl!(self, "glBufferData", (u32, isize, *const c_void, u32), u(0), n(1) as isize, std::ptr::null(), u(2)); }
                undef()
            }
            "bindVertexArray" => { gl!(self, "glBindVertexArray", (u32), u(0)); undef() }
            "enableVertexAttribArray" => { gl!(self, "glEnableVertexAttribArray", (u32), u(0)); undef() }
            "vertexAttribPointer" => { gl!(self, "glVertexAttribPointer", (u32, i32, u32, u8, i32, *const c_void), u(0), s(1), u(2), s(3) as u8, s(4), n(5) as usize as *const c_void); undef() }
            "vertexAttribDivisor" => { gl!(self, "glVertexAttribDivisor", (u32, u32), u(0), u(1)); undef() }
            "drawArrays" => { gl!(self, "glDrawArrays", (u32, i32, i32), u(0), s(1), s(2)); undef() }
            "drawArraysInstanced" => { gl!(self, "glDrawArraysInstanced", (u32, i32, i32, i32), u(0), s(1), s(2), s(3)); undef() }
            "viewport" => { gl!(self, "glViewport", (i32, i32, i32, i32), s(0), s(1), s(2), s(3)); undef() }
            "enable" => { gl!(self, "glEnable", (u32), u(0)); undef() }
            "disable" => { gl!(self, "glDisable", (u32), u(0)); undef() }
            "blendFuncSeparate" => { gl!(self, "glBlendFuncSeparate", (u32, u32, u32, u32), u(0), u(1), u(2), u(3)); undef() }
            "pixelStorei" => { if u(0) < 0x9240 { gl!(self, "glPixelStorei", (u32, i32), u(0), s(1)); } undef() }
            "readPixels" => {
                // with a buffer bound to PIXEL_PACK_BUFFER the last argument is an offset (a number); otherwise pixels come back as an ArrayBuffer
                if a.len() > 6 && a[6].as_number().is_some() {
                    gl!(self, "glReadPixels", (i32, i32, i32, i32, u32, u32, *mut c_void), s(0), s(1), s(2), s(3), u(4), u(5), n(6) as usize as *mut c_void); undef()
                } else {
                    let mut out = vec![0u8; (s(2) * s(3) * 4) as usize];
                    gl!(self, "glReadPixels", (i32, i32, i32, i32, u32, u32, *mut c_void), s(0), s(1), s(2), s(3), u(4), u(5), out.as_mut_ptr() as *mut c_void);
                    Ok(ArrayBuffer::new_copy(ctx.clone(), out)?.into_value())
                }
            }
            "blitFramebuffer" => { gl!(self, "glBlitFramebuffer", (i32, i32, i32, i32, i32, i32, i32, i32, u32, u32), s(0), s(1), s(2), s(3), s(4), s(5), s(6), s(7), u(8), u(9)); undef() }
            "flush" => { gl!(self, "glFlush", (),); undef() }
            "finish" => { gl!(self, "glFinish", (),); undef() }
            "fenceSync" => ret(gl!(self, "glFenceSync", (u32, u32) -> *const c_void, u(0), u(1)) as usize as f64),
            "clientWaitSync" => ret(gl!(self, "glClientWaitSync", (*const c_void, u32, u64) -> u32, n(0) as usize as *const c_void, u(1), n(2) as u64) as f64),
            "deleteSync" => { gl!(self, "glDeleteSync", (*const c_void), n(0) as usize as *const c_void); undef() }
            "getBufferSubData" => {
                let len = n(2) as usize; let mut out = vec![0u8; len];
                gl!(self, "glGetBufferSubData", (u32, isize, isize, *mut c_void), u(0), n(1) as isize, len as isize, out.as_mut_ptr() as *mut c_void);
                Ok(ArrayBuffer::new_copy(ctx.clone(), out)?.into_value())
            }
            "getIntegerv" => {   // (pname, count) -> "a,b,..."
                let mut v = [0i32; 4]; gl!(self, "glGetIntegerv", (u32, *mut i32), u(0), v.as_mut_ptr());
                let n = (a.get(1).map(num).unwrap_or(1.0) as usize).clamp(1, 4);
                let t = v[..n].iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",");
                Ok(rquickjs::String::from_str(ctx.clone(), &t)?.into_value())
            }
            "getShaderPrecisionFormat" => {
                let (mut r, mut p) = ([0i32; 2], 0i32);
                gl!(self, "glGetShaderPrecisionFormat", (u32, u32, *mut i32, *mut i32), u(0), u(1), r.as_mut_ptr(), &mut p);
                Ok(rquickjs::String::from_str(ctx.clone(), &format!("{},{},{}", r[0], r[1], p))?.into_value())
            }
            "getAttribLocation" => {
                let nm = a.get(1).and_then(|v| v.as_string()).and_then(|s| s.to_string().ok()).unwrap_or_default();
                let c = CString::new(nm).unwrap_or_default(); ret(gl!(self, "glGetAttribLocation", (u32, *const c_char) -> i32, u(0), c.as_ptr()) as f64)
            }
            "deleteProgram" => { gl!(self, "glDeleteProgram", (u32), u(0)); undef() }
            "deleteShader" => { gl!(self, "glDeleteShader", (u32), u(0)); undef() }
            "clearColor" => { gl!(self, "glClearColor", (f32, f32, f32, f32), f(0), f(1), f(2), f(3)); undef() }
            "clear" => { gl!(self, "glClear", (u32), u(0)); undef() }
            "hasProc" => { let nm = a.get(0).and_then(|v| v.as_string()).and_then(|s| s.to_string().ok()).unwrap_or_default(); ret(if self.egl.proc_address(&nm).is_null() { 0.0 } else { 1.0 }) }
            "getError" => ret(gl!(self, "glGetError", () -> u32,) as f64),
            "getString" => {
                let p = gl!(self, "glGetString", (u32) -> *const c_char, u(0));
                let t = if p.is_null() { String::new() } else { unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().to_string() };
                Ok(rquickjs::String::from_str(ctx.clone(), &t)?.into_value())
            }
            other => Err(rquickjs::Exception::throw_message(ctx, &format!("unsupported GL call {other}"))),
        }
    }
}
