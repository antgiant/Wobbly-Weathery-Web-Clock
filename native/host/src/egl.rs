//! A GPU context with no window: EGL through the system's libEGL (Mesa on a Raspberry Pi, the software renderer on a build machine), OpenGL ES 3 (or 2 for the
//! Pi 3 profile). The window system is not needed: pictures are drawn into an offscreen framebuffer, which the outputs then show or read back.

use libloading::{Library, Symbol};
use std::ffi::{c_char, c_void, CString};

type Dpy = *mut c_void;
const EGL_OPENGL_ES_API: u32 = 0x30A0;
const EGL_RENDERABLE_TYPE: i32 = 0x3040;
const EGL_OPENGL_ES2_BIT: i32 = 0x4;
const EGL_OPENGL_ES3_BIT: i32 = 0x40;
const EGL_SURFACE_TYPE: i32 = 0x3033;
const EGL_PBUFFER_BIT: i32 = 0x1;
const EGL_NONE: i32 = 0x3038;
const EGL_CONTEXT_CLIENT_VERSION: i32 = 0x3098;
const EGL_WIDTH: i32 = 0x3057;
const EGL_HEIGHT: i32 = 0x3056;

pub struct Egl { _lib: Library, get_proc: unsafe extern "C" fn(*const c_char) -> *const c_void, pub version: String }

impl Egl {
    /// Open a context. `es_version` is 3 or 2. Returns the loaded EGL (keep it alive as long as GL is used).
    pub fn open(es_version: i32) -> Result<Egl, String> {
        unsafe {
            let lib = Library::new("libEGL.so.1").or_else(|_| Library::new("libEGL.so")).map_err(|e| format!("cannot load libEGL (install Mesa: libegl1): {e}"))?;
            macro_rules! sym { ($n:literal, $t:ty) => { *lib.get::<$t>($n).map_err(|e| format!("libEGL has no {}: {e}", String::from_utf8_lossy($n)))? } }
            let get_proc: unsafe extern "C" fn(*const c_char) -> *const c_void = sym!(b"eglGetProcAddress\0", unsafe extern "C" fn(*const c_char) -> *const c_void);
            let get_display: unsafe extern "C" fn(*mut c_void) -> Dpy = sym!(b"eglGetDisplay\0", unsafe extern "C" fn(*mut c_void) -> Dpy);
            let initialize: unsafe extern "C" fn(Dpy, *mut i32, *mut i32) -> u32 = sym!(b"eglInitialize\0", unsafe extern "C" fn(Dpy, *mut i32, *mut i32) -> u32);
            let bind_api: unsafe extern "C" fn(u32) -> u32 = sym!(b"eglBindAPI\0", unsafe extern "C" fn(u32) -> u32);
            let choose_config: unsafe extern "C" fn(Dpy, *const i32, *mut *mut c_void, i32, *mut i32) -> u32 = sym!(b"eglChooseConfig\0", unsafe extern "C" fn(Dpy, *const i32, *mut *mut c_void, i32, *mut i32) -> u32);
            let create_context: unsafe extern "C" fn(Dpy, *mut c_void, *mut c_void, *const i32) -> *mut c_void = sym!(b"eglCreateContext\0", unsafe extern "C" fn(Dpy, *mut c_void, *mut c_void, *const i32) -> *mut c_void);
            let create_pbuffer: unsafe extern "C" fn(Dpy, *mut c_void, *const i32) -> *mut c_void = sym!(b"eglCreatePbufferSurface\0", unsafe extern "C" fn(Dpy, *mut c_void, *const i32) -> *mut c_void);
            let make_current: unsafe extern "C" fn(Dpy, *mut c_void, *mut c_void, *mut c_void) -> u32 = sym!(b"eglMakeCurrent\0", unsafe extern "C" fn(Dpy, *mut c_void, *mut c_void, *mut c_void) -> u32);
            // a display with no window system: the "surfaceless" platform if Mesa offers it, else the default display
            let get_platform: Option<unsafe extern "C" fn(u32, *mut c_void, *const i32) -> Dpy> = lib.get::<unsafe extern "C" fn(u32, *mut c_void, *const i32) -> Dpy>(b"eglGetPlatformDisplay\0").ok().map(|s: Symbol<_>| *s);
            let mut dpy: Dpy = std::ptr::null_mut();
            if let Some(gp) = get_platform { dpy = gp(0x31DD, std::ptr::null_mut(), std::ptr::null()); }   // EGL_PLATFORM_SURFACELESS_MESA
            if dpy.is_null() { dpy = get_display(std::ptr::null_mut()); }
            if dpy.is_null() { return Err("no EGL display".into()); }
            let (mut maj, mut min) = (0, 0);
            if initialize(dpy, &mut maj, &mut min) == 0 { return Err("eglInitialize failed (is a GPU driver installed?)".into()); }
            bind_api(EGL_OPENGL_ES_API);
            let bit = if es_version >= 3 { EGL_OPENGL_ES3_BIT } else { EGL_OPENGL_ES2_BIT };
            let attrs = [EGL_RENDERABLE_TYPE, bit, EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_NONE];
            let (mut cfg, mut n) = (std::ptr::null_mut(), 0);
            if choose_config(dpy, attrs.as_ptr(), &mut cfg, 1, &mut n) == 0 || n == 0 { return Err(format!("no EGL configuration for OpenGL ES {es_version}")); }
            let ctx_attrs = [EGL_CONTEXT_CLIENT_VERSION, es_version, EGL_NONE];
            let ctx = create_context(dpy, cfg, std::ptr::null_mut(), ctx_attrs.as_ptr());
            if ctx.is_null() { return Err(format!("could not create an OpenGL ES {es_version} context")); }
            let pb_attrs = [EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE];
            let surf = create_pbuffer(dpy, cfg, pb_attrs.as_ptr());
            if make_current(dpy, surf, surf, ctx) == 0 { return Err("eglMakeCurrent failed".into()); }
            Ok(Egl { _lib: lib, get_proc, version: format!("EGL {maj}.{min}") })
        }
    }
    pub fn proc_address(&self, name: &str) -> *const c_void { let c = CString::new(name).unwrap(); unsafe { (self.get_proc)(c.as_ptr()) } }
}
