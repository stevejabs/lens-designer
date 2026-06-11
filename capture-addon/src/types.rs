// types.rs — shared types across platform modules.
//
// These mirror tools/lens-designer/capture-addon/index.d.ts and
// tools/lens-designer/bridge/test/MockCaptureAddon.ts. Changes here
// must land in both shims (TD-15 rule 1: a single TS API surface).

use napi_derive::napi;
use serde::{Deserialize, Serialize};

/// Window-relative capture region, in window points (top-left origin).
#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Region {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

/// Bounds of a window in screen points.
#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WindowBounds {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

/// Enumerated window entry. `id` is an opaque, platform-specific source
/// identifier encoded as a string (CGWindowID on macOS, HWND on Windows,
/// portal session token on Linux/Wayland). The bridge never parses it.
#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WindowEntry {
  pub id: String,
  pub pid: u32,
  pub owner_name: String,
  pub title: String,
  pub bounds: WindowBounds,
  pub onscreen: bool,
}

/// Returned by `capture_source`. PNG bytes; no on-disk file involved.
#[napi(object)]
pub struct CaptureResult {
  pub png: napi::bindgen_prelude::Buffer,
  pub width: u32,
  pub height: u32,
  pub captured_at_ms: f64,
}

/// What the host platform can do. The bridge queries this once at
/// startup and routes accordingly. Adding a platform with a new
/// combination of flags requires no caller changes (TD-15 rule 5).
#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlatformCapabilities {
  /// True if windows can be enumerated without user interaction.
  /// False on Wayland (the portal flow drives selection).
  pub can_enumerate: bool,
  /// True if the capture API requires the user to pick a source via a
  /// system dialog (portal).
  pub requires_interactive_pick: bool,
  /// True if capturing pixels requires explicit OS permission grant.
  pub requires_permission_grant: bool,
  /// True if capture sessions are stateful (created once, reused per
  /// source, must be released when done).
  pub has_stateful_capture_session: bool,
}

/// Platform-blind error kinds. Consumers handle these once and translate
/// to per-OS remediation copy in a single table (TD-15 rule 4).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureErrorKind {
  PermissionDenied,
  WindowNotFound,
  CaptureFailed,
  CapabilityUnsupported,
  PlatformUnsupported,
}

/// Serialized error body. We pack this as JSON into the napi `Error`'s
/// reason; index.js parses it and re-throws as a TS `CaptureError`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CaptureErrorPayload {
  pub kind: CaptureErrorKind,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub detail: Option<String>,
}

impl CaptureErrorPayload {
  pub fn new(kind: CaptureErrorKind, detail: Option<String>) -> Self {
    Self { kind, detail }
  }

  /// Convert to a napi error. Reason is JSON so index.js can parse it.
  pub fn into_napi_error(self) -> napi::Error {
    let json = serde_json::to_string(&self)
      .unwrap_or_else(|_| String::from("{\"kind\":\"capture-failed\"}"));
    napi::Error::new(napi::Status::GenericFailure, json)
  }
}

/// Internal Rust-side error type. Platform modules return this; the
/// napi binding layer translates to a JS exception.
#[derive(Clone, Debug)]
pub enum CaptureError {
  PermissionDenied(Option<String>),
  WindowNotFound(Option<String>),
  CaptureFailed(Option<String>),
  CapabilityUnsupported(Option<String>),
  PlatformUnsupported(Option<String>),
}

impl CaptureError {
  pub fn into_payload(self) -> CaptureErrorPayload {
    match self {
      Self::PermissionDenied(d) => CaptureErrorPayload::new(CaptureErrorKind::PermissionDenied, d),
      Self::WindowNotFound(d) => CaptureErrorPayload::new(CaptureErrorKind::WindowNotFound, d),
      Self::CaptureFailed(d) => CaptureErrorPayload::new(CaptureErrorKind::CaptureFailed, d),
      Self::CapabilityUnsupported(d) => {
        CaptureErrorPayload::new(CaptureErrorKind::CapabilityUnsupported, d)
      }
      Self::PlatformUnsupported(d) => {
        CaptureErrorPayload::new(CaptureErrorKind::PlatformUnsupported, d)
      }
    }
  }

  pub fn into_napi_error(self) -> napi::Error {
    self.into_payload().into_napi_error()
  }
}

impl From<CaptureError> for napi::Error {
  fn from(e: CaptureError) -> Self {
    e.into_napi_error()
  }
}

pub type CaptureResultInternal<T> = Result<T, CaptureError>;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn capture_error_serializes_kind_as_kebab() {
    let payload = CaptureErrorPayload::new(CaptureErrorKind::PermissionDenied, None);
    let json = serde_json::to_string(&payload).unwrap();
    assert_eq!(json, r#"{"kind":"permission-denied"}"#);
  }

  #[test]
  fn capture_error_with_detail_includes_detail() {
    let payload = CaptureErrorPayload::new(
      CaptureErrorKind::CaptureFailed,
      Some("test detail".to_string()),
    );
    let json = serde_json::to_string(&payload).unwrap();
    assert_eq!(
      json,
      r#"{"kind":"capture-failed","detail":"test detail"}"#
    );
  }

  #[test]
  fn capture_error_omits_detail_when_none() {
    let payload = CaptureErrorPayload::new(CaptureErrorKind::WindowNotFound, None);
    let json = serde_json::to_string(&payload).unwrap();
    assert!(!json.contains("detail"));
  }
}
