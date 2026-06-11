// windows.rs — Windows capture implementation.
//
// **Stub for v1.0.** Every function returns `CaptureError::PlatformUnsupported`.
// Phase 6 / v1.1 fills in the bodies with Windows.Graphics.Capture
// (windows crate), EnumWindows enumeration, and GetExtendedTcpTable
// for port→PID. See architecture §3.2.
//
// The file exists from day one per TD-15 rule 2. Adding the impl =
// fill in this module, not invent a new one.

use crate::types::*;

pub fn get_platform_capabilities() -> PlatformCapabilities {
  // Stub capabilities. v1.1 returns the real Windows shape:
  //   can_enumerate: true, requires_interactive_pick: false,
  //   requires_permission_grant: false, has_stateful_capture_session: true
  PlatformCapabilities {
    can_enumerate: false,
    requires_interactive_pick: false,
    requires_permission_grant: false,
    has_stateful_capture_session: false,
  }
}

pub fn enumerate_lens_studio_windows() -> CaptureResultInternal<Vec<WindowEntry>> {
  Err(CaptureError::PlatformUnsupported(Some(
    "Windows capture-addon is a v1.0 stub; ship v1.1 for real support".into(),
  )))
}

pub async fn pick_lens_studio_source() -> CaptureResultInternal<Option<WindowEntry>> {
  Err(CaptureError::PlatformUnsupported(Some(
    "Windows capture-addon is a v1.0 stub; ship v1.1 for real support".into(),
  )))
}

pub async fn capture_source(
  _id: String,
  _region: Region,
) -> CaptureResultInternal<CaptureResult> {
  Err(CaptureError::PlatformUnsupported(Some(
    "Windows capture-addon is a v1.0 stub; ship v1.1 for real support".into(),
  )))
}

pub fn release_source(_id: String) {
  // No-op on stub.
}

pub fn port_to_pid(_port: u16) -> Option<u32> {
  // Stub returns None — protocol semantics are "not found" rather than
  // an explicit error, since portToPid is allowed to fail silently.
  None
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  use super::*;

  #[test]
  fn stub_get_platform_capabilities_returns_all_false() {
    let caps = get_platform_capabilities();
    assert!(!caps.can_enumerate);
    assert!(!caps.requires_interactive_pick);
    assert!(!caps.requires_permission_grant);
    assert!(!caps.has_stateful_capture_session);
  }

  #[test]
  fn stub_enumerate_returns_platform_unsupported() {
    let err = enumerate_lens_studio_windows().unwrap_err();
    assert!(matches!(err, CaptureError::PlatformUnsupported(_)));
  }

  #[tokio::test]
  async fn stub_pick_returns_platform_unsupported() {
    let err = pick_lens_studio_source().await.unwrap_err();
    assert!(matches!(err, CaptureError::PlatformUnsupported(_)));
  }

  #[tokio::test]
  async fn stub_capture_returns_platform_unsupported() {
    let err = capture_source(
      "abc".to_string(),
      Region {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
      },
    )
    .await
    .unwrap_err();
    assert!(matches!(err, CaptureError::PlatformUnsupported(_)));
  }

  #[test]
  fn stub_port_to_pid_returns_none() {
    assert_eq!(port_to_pid(9229), None);
  }
}
