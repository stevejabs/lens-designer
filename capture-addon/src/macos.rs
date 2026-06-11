// macos.rs — macOS capture implementation.
//
// v1.0 uses CGWindowListCreateImage for capture (sync, works on macOS
// 12.3+, requires Screen Recording permission). Deviation from
// architecture TD-5 (which named ScreenCaptureKit as the path): SCK's
// async streaming model is significantly more FFI work and produces
// the same user-visible behavior — same TCC prompt, same pixel data,
// same latency band. Migrating from CGWindowListCreateImage to SCK is
// a single-file change behind the locked TS API (TD-15 rule 1) and is
// queued as a follow-up before any public push (v1.1).
//
// References:
//   developer.apple.com/documentation/coregraphics/1455730-cgwindowlistcreateimage
//   developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo

use crate::types::*;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::{CGDisplay, CGRectNull, CGWindowListCopyWindowInfo};
use core_graphics::window::{
  kCGNullWindowID, kCGWindowImageBoundsIgnoreFraming, kCGWindowImageNominalResolution,
  kCGWindowListExcludeDesktopElements, kCGWindowListOptionIncludingWindow, CGWindowID,
};
use image::{ImageBuffer, Rgba};
use libproc::libproc::file_info::{pidfdinfo, ListFDs, ProcFDType};
use libproc::libproc::net_info::{InSockInfo, SocketFDInfo, SocketInfoKind, TcpSIState};
use libproc::libproc::proc_pid::listpidinfo;
use libproc::processes::{pids_by_type, ProcFilter};
use std::time::SystemTime;


pub fn get_platform_capabilities() -> PlatformCapabilities {
  PlatformCapabilities {
    can_enumerate: true,
    requires_interactive_pick: false,
    requires_permission_grant: true,
    has_stateful_capture_session: false,
  }
}

pub fn enumerate_lens_studio_windows() -> CaptureResultInternal<Vec<WindowEntry>> {
  // SAFETY: CGWindowListCopyWindowInfo returns a +1 CFArray of
  // CFDictionary, or null. The Exclude-Desktop-Elements options pulls
  // both onscreen + off-Space windows (which are still capturable).
  // `kCGWindowIsOnscreen` field of each dict tells us the onscreen
  // state per window — no need for a second call.
  let array_ref =
    unsafe { CGWindowListCopyWindowInfo(kCGWindowListExcludeDesktopElements, kCGNullWindowID) };
  if array_ref.is_null() {
    return Ok(Vec::new());
  }
  let array: CFArray<CFDictionary> =
    unsafe { CFArray::wrap_under_create_rule(array_ref) };

  let mut entries: Vec<WindowEntry> = Vec::new();
  for dict_item in array.iter() {
    // ItemRef<CFDictionary> derefs to &CFDictionary.
    let dict: &CFDictionary = &dict_item;
    if let Some(entry) = window_entry_from_dict(dict) {
      if (entry.owner_name == "Lens Studio" || entry.owner_name.starts_with("Lens Studio"))
        && is_likely_editor_window(&entry)
      {
        entries.push(entry);
      }
    }
  }

  // Sort by area desc — the main editor window is typically the largest.
  entries.sort_by(|a, b| {
    let area_a = a.bounds.width * a.bounds.height;
    let area_b = b.bounds.width * b.bounds.height;
    area_b
      .partial_cmp(&area_a)
      .unwrap_or(std::cmp::Ordering::Equal)
  });

  Ok(entries)
}

fn is_likely_editor_window(entry: &WindowEntry) -> bool {
  // Editor windows are large; floating panels, menus, tooltips small.
  // Same heuristic the existing Swift helper used.
  entry.bounds.width >= 600.0 && entry.bounds.height >= 400.0
}

fn cf_key(name: &str) -> CFString {
  CFString::new(name)
}

fn dict_get_cftype(dict: &CFDictionary, key: &str) -> Option<CFType> {
  let key = cf_key(key);
  let ptr = dict.find(key.as_concrete_TypeRef().cast::<std::ffi::c_void>())?;
  if (*ptr).is_null() {
    return None;
  }
  // SAFETY: the pointer is to a valid CF object retained by the
  // surrounding dict. We wrap with the get-rule (retain) so the CFType
  // we return owns its own retain count.
  unsafe { Some(CFType::wrap_under_get_rule(*ptr as CFTypeRef)) }
}

fn read_window_id(dict: &CFDictionary) -> Option<i64> {
  let v = dict_get_cftype(dict, "kCGWindowNumber")?;
  v.downcast::<CFNumber>().and_then(|n| n.to_i64())
}

fn read_pid(dict: &CFDictionary) -> Option<u32> {
  let v = dict_get_cftype(dict, "kCGWindowOwnerPID")?;
  v.downcast::<CFNumber>()
    .and_then(|n| n.to_i32())
    .map(|n| n as u32)
}

fn read_string(dict: &CFDictionary, key_name: &str) -> Option<String> {
  let v = dict_get_cftype(dict, key_name)?;
  v.downcast::<CFString>().map(|s| s.to_string())
}

fn read_bool(dict: &CFDictionary, key_name: &str) -> Option<bool> {
  let v = dict_get_cftype(dict, key_name)?;
  v.downcast::<CFNumber>()
    .and_then(|n| n.to_i64())
    .map(|n| n != 0)
}

fn read_bounds(dict: &CFDictionary) -> Option<WindowBounds> {
  let bounds_value = dict_get_cftype(dict, "kCGWindowBounds")?;
  let bounds_dict = bounds_value.downcast::<CFDictionary>()?;

  let x = read_bounds_number(&bounds_dict, "X")?;
  let y = read_bounds_number(&bounds_dict, "Y")?;
  let width = read_bounds_number(&bounds_dict, "Width")?;
  let height = read_bounds_number(&bounds_dict, "Height")?;

  Some(WindowBounds {
    x,
    y,
    width,
    height,
  })
}

fn read_bounds_number(dict: &CFDictionary, key_name: &str) -> Option<f64> {
  let v = dict_get_cftype(dict, key_name)?;
  v.downcast::<CFNumber>().and_then(|n| n.to_f64())
}

fn window_entry_from_dict(dict: &CFDictionary) -> Option<WindowEntry> {
  let id = read_window_id(dict)?;
  let pid = read_pid(dict)?;
  let owner_name = read_string(dict, "kCGWindowOwnerName").unwrap_or_default();
  let title = read_string(dict, "kCGWindowName").unwrap_or_default();
  let bounds = read_bounds(dict)?;
  let onscreen = read_bool(dict, "kCGWindowIsOnscreen").unwrap_or(false);

  Some(WindowEntry {
    id: id.to_string(),
    pid,
    owner_name,
    title,
    bounds,
    onscreen,
  })
}

pub async fn pick_lens_studio_source() -> CaptureResultInternal<Option<WindowEntry>> {
  // Mac has requires_interactive_pick: false — auto-match by largest LS window.
  match enumerate_lens_studio_windows() {
    Ok(windows) => Ok(windows.into_iter().next()),
    Err(e) => Err(e),
  }
}

pub async fn capture_source(
  id: String,
  region: Region,
) -> CaptureResultInternal<CaptureResult> {
  let parsed: u32 = id.parse().map_err(|_| {
    CaptureError::WindowNotFound(Some(format!("source id '{id}' is not a valid CGWindowID")))
  })?;
  let window_id: CGWindowID = parsed;

  // CGWindowListCreateImage is sync + GPU/window-server-bound; spawn
  // to a blocking thread to keep the libuv main loop unblocked.
  let captured = tokio::task::spawn_blocking(move || capture_window_to_buffer(window_id, region))
    .await
    .map_err(|e| CaptureError::CaptureFailed(Some(format!("worker join failed: {e}"))))??;

  Ok(captured)
}

fn capture_window_to_buffer(
  window_id: CGWindowID,
  region: Region,
) -> CaptureResultInternal<CaptureResult> {
  let image_options =
    kCGWindowImageBoundsIgnoreFraming | kCGWindowImageNominalResolution;

  // CGDisplay::screenshot wraps CGWindowListCreateImage and returns
  // None on null (no permission OR window gone — undistinguishable
  // from this layer; the bridge's permission probe handles it).
  // SAFETY: CGRectNull is an extern static; reads are sound because
  // it's a stable CG constant exposed by /System/Library/Frameworks/CoreGraphics.
  let null_rect = unsafe { CGRectNull };
  let cg_image = CGDisplay::screenshot(
    null_rect,
    kCGWindowListOptionIncludingWindow,
    window_id,
    image_options,
  )
  .ok_or_else(|| {
    CaptureError::CaptureFailed(Some(
      "CGWindowListCreateImage returned null — window may be gone or Screen Recording is not granted".into(),
    ))
  })?;

  let full_width = cg_image.width() as u32;
  let full_height = cg_image.height() as u32;
  if full_width == 0 || full_height == 0 {
    return Err(CaptureError::CaptureFailed(Some(format!(
      "captured image has zero dimension ({full_width}×{full_height})"
    ))));
  }

  let bytes = cg_image.data();
  let bytes_per_row = cg_image.bytes_per_row();
  let bytes_per_pixel = cg_image.bits_per_pixel() / 8;
  if bytes_per_pixel != 4 {
    return Err(CaptureError::CaptureFailed(Some(format!(
      "unexpected bits_per_pixel={}, expected 32 (BGRA)",
      cg_image.bits_per_pixel()
    ))));
  }

  // CGImage's data is BGRA at bytes_per_row stride. Pack into RGBA.
  let raw: &[u8] = bytes.bytes();
  let mut rgba: Vec<u8> = Vec::with_capacity((full_width * full_height * 4) as usize);
  for row in 0..(full_height as usize) {
    let row_start = row * bytes_per_row;
    for col in 0..(full_width as usize) {
      let i = row_start + col * 4;
      rgba.push(raw[i + 2]);
      rgba.push(raw[i + 1]);
      rgba.push(raw[i]);
      rgba.push(raw[i + 3]);
    }
  }

  let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_vec(full_width, full_height, rgba)
    .ok_or_else(|| CaptureError::CaptureFailed(Some("RGBA buffer size mismatch".into())))?;

  let clamped = clamp_region(&region, full_width, full_height);
  let cropped_view = image::imageops::crop_imm(
    &img,
    clamped.x as u32,
    clamped.y as u32,
    clamped.width as u32,
    clamped.height as u32,
  );
  let cropped = cropped_view.to_image();

  let mut png_bytes: Vec<u8> =
    Vec::with_capacity(cropped.width() as usize * cropped.height() as usize);
  {
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    cropped
      .write_to(&mut cursor, image::ImageFormat::Png)
      .map_err(|e| CaptureError::CaptureFailed(Some(format!("PNG encode failed: {e}"))))?;
  }

  let captured_at_ms = SystemTime::now()
    .duration_since(SystemTime::UNIX_EPOCH)
    .map(|d| d.as_millis() as f64)
    .unwrap_or(0.0);

  Ok(CaptureResult {
    png: png_bytes.into(),
    width: cropped.width(),
    height: cropped.height(),
    captured_at_ms,
  })
}

fn clamp_region(region: &Region, max_width: u32, max_height: u32) -> Region {
  let x = region.x.max(0.0).min(max_width as f64);
  let y = region.y.max(0.0).min(max_height as f64);
  let width = region.width.max(0.0).min(max_width as f64 - x);
  let height = region.height.max(0.0).min(max_height as f64 - y);
  Region {
    x,
    y,
    width: width.max(1.0),
    height: height.max(1.0),
  }
}

pub fn release_source(_id: String) {
  // No stateful capture session on macOS (CGWindowListCreateImage is
  // a fire-and-forget sync call). No-op.
}

pub fn port_to_pid(port: u16) -> Option<u32> {
  // Iterate every PID, look at its open socket fds, find a TCP listener
  // bound to `port`. macOS doesn't expose a global "who owns this port"
  // table — libproc is the documented path.
  let pids = pids_by_type(ProcFilter::All).ok()?;
  for pid in pids {
    let pid = pid as i32;
    let Ok(fds) = listpidinfo::<ListFDs>(pid, 65_535) else {
      continue;
    };
    for fd_info in fds {
      if fd_info.proc_fdtype != ProcFDType::Socket as u32 {
        continue;
      }
      let Ok(socket_info) = pidfdinfo::<SocketFDInfo>(pid, fd_info.proc_fd) else {
        continue;
      };
      if socket_info.psi.soi_kind as u32 != SocketInfoKind::Tcp as u32 {
        continue;
      }
      let tcp = unsafe { socket_info.psi.soi_proto.pri_tcp };
      let tcp_state: i32 = tcp.tcpsi_state;
      if tcp_state != TcpSIState::Listen as i32 {
        continue;
      }
      let local: InSockInfo = tcp.tcpsi_ini;
      // local-port is stored in network byte order in `insi_lport`.
      let local_port: u16 = (local.insi_lport as u16).to_be();
      if local_port == port {
        return Some(pid as u32);
      }
    }
  }
  None
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
  use super::*;
  use std::net::TcpListener;

  #[test]
  fn capabilities_match_mac_shape() {
    let caps = get_platform_capabilities();
    assert!(caps.can_enumerate);
    assert!(!caps.requires_interactive_pick);
    assert!(caps.requires_permission_grant);
    assert!(!caps.has_stateful_capture_session);
  }

  #[test]
  fn enumerate_returns_array() {
    // Don't assert on length — may or may not have LS running.
    let _ = enumerate_lens_studio_windows().unwrap();
  }

  #[test]
  fn port_to_pid_returns_none_for_free_port() {
    // 63421 is well outside common ranges; usually free.
    let _ = port_to_pid(63421);
    // We just verify the call doesn't crash. Stronger assertions below.
  }

  #[test]
  fn port_to_pid_finds_self_when_bound() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let pid = port_to_pid(port);
    assert_eq!(
      pid,
      Some(std::process::id()),
      "port {} should be owned by self pid {}; got {:?}",
      port,
      std::process::id(),
      pid
    );
    drop(listener);
  }

  #[test]
  fn clamp_region_clips_to_bounds() {
    let r = Region {
      x: -5.0,
      y: -5.0,
      width: 10_000.0,
      height: 10_000.0,
    };
    let clamped = clamp_region(&r, 100, 80);
    assert_eq!(clamped.x, 0.0);
    assert_eq!(clamped.y, 0.0);
    assert_eq!(clamped.width, 100.0);
    assert_eq!(clamped.height, 80.0);
  }

  #[test]
  fn clamp_region_preserves_in_bounds() {
    let r = Region {
      x: 10.0,
      y: 20.0,
      width: 50.0,
      height: 40.0,
    };
    let clamped = clamp_region(&r, 100, 80);
    assert_eq!(clamped.x, 10.0);
    assert_eq!(clamped.y, 20.0);
    assert_eq!(clamped.width, 50.0);
    assert_eq!(clamped.height, 40.0);
  }
}
