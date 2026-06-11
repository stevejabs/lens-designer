// linux.rs — Linux capture implementation.
//
// **Stub for v1.0 and v1.1.** Lens Studio doesn't ship on Linux today.
// Deferred until Snap supports Linux. See architecture §3.2 for the
// planned Wayland (xdg-desktop-portal) + X11 implementation shape.
//
// The file exists from day one per TD-15 rule 2.

use crate::types::*;

pub fn get_platform_capabilities() -> PlatformCapabilities {
  PlatformCapabilities {
    can_enumerate: false,
    requires_interactive_pick: false,
    requires_permission_grant: false,
    has_stateful_capture_session: false,
  }
}

pub fn enumerate_lens_studio_windows() -> CaptureResultInternal<Vec<WindowEntry>> {
  Err(CaptureError::PlatformUnsupported(Some(
    "Linux capture-addon is deferred until Lens Studio supports Linux".into(),
  )))
}

pub async fn pick_lens_studio_source() -> CaptureResultInternal<Option<WindowEntry>> {
  Err(CaptureError::PlatformUnsupported(Some(
    "Linux capture-addon is deferred until Lens Studio supports Linux".into(),
  )))
}

pub async fn capture_source(
  _id: String,
  _region: Region,
) -> CaptureResultInternal<CaptureResult> {
  Err(CaptureError::PlatformUnsupported(Some(
    "Linux capture-addon is deferred until Lens Studio supports Linux".into(),
  )))
}

pub fn release_source(_id: String) {}

pub fn port_to_pid(_port: u16) -> Option<u32> {
  None
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
  use super::*;

  #[test]
  fn stub_returns_platform_unsupported() {
    let err = enumerate_lens_studio_windows().unwrap_err();
    assert!(matches!(err, CaptureError::PlatformUnsupported(_)));
  }
}
