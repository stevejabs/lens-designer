// lib.rs — napi entry point for @lens-designer/capture-addon.
//
// Re-exports the per-target platform module under `platform`, then
// exposes a platform-blind napi binding surface that delegates to it.
// Adding a new OS = add a `mod <os>` + the cfg pair below; no other
// code changes (TD-15 rule 2).

#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

mod types;
pub use types::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as platform;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;

// ----- napi bindings -----

/// Returns the host platform's capabilities. The bridge queries this
/// once at startup to drive its UI routing.
#[napi]
pub fn get_platform_capabilities() -> PlatformCapabilities {
  platform::get_platform_capabilities()
}

/// Enumerate windows owned by processes named "Lens Studio".
/// Returns [] on platforms where `can_enumerate == false`.
#[napi]
pub fn enumerate_lens_studio_windows() -> napi::Result<Vec<WindowEntry>> {
  platform::enumerate_lens_studio_windows().map_err(Into::into)
}

/// Pick a Lens Studio source for capture. On platforms with
/// `requires_interactive_pick == false`, returns the auto-matched
/// window. On Wayland (v1.x), raises a portal dialog.
#[napi]
pub async fn pick_lens_studio_source() -> napi::Result<Option<WindowEntry>> {
  platform::pick_lens_studio_source().await.map_err(Into::into)
}

/// Capture a window-relative region as PNG.
#[napi]
pub async fn capture_source(id: String, region: Region) -> napi::Result<CaptureResult> {
  platform::capture_source(id, region).await.map_err(Into::into)
}

/// Release any stateful capture resources held for this source.
/// No-op on stateless platforms (macOS v1.0).
#[napi]
pub fn release_source(id: String) {
  platform::release_source(id);
}

/// Resolve a listening TCP port to its owning PID, or null.
#[napi]
pub fn port_to_pid(port: u32) -> Option<u32> {
  // napi can't express u16 directly; clamp.
  if port > u16::MAX as u32 {
    return None;
  }
  platform::port_to_pid(port as u16)
}
