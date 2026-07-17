//! DJI device detection (macOS: USB file-transfer mode mounts under
//! /Volumes) and guarded media deletion.
//!
//! Detection is a 2s poll of /Volumes with a cheap DCIM/DJI_* fingerprint —
//! DiskArbitration callbacks can replace the poll later without changing
//! the event contract ("dji-volumes-changed").

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DjiVolume {
    pub path: String,
    pub name: String,
}

fn find_dji_volumes() -> Vec<DjiVolume> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir("/Volumes") else {
        return found;
    };
    for entry in entries.flatten() {
        let vol = entry.path();
        let dcim = vol.join("DCIM");
        if !dcim.is_dir() {
            continue;
        }
        let has_dji_dir = std::fs::read_dir(&dcim)
            .map(|it| {
                it.flatten().any(|d| {
                    let n = d.file_name();
                    let n = n.to_string_lossy();
                    n.starts_with("DJI_") && d.path().is_dir()
                })
            })
            .unwrap_or(false);
        if has_dji_dir {
            found.push(DjiVolume {
                path: vol.to_string_lossy().to_string(),
                name: entry.file_name().to_string_lossy().to_string(),
            });
        }
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

#[tauri::command]
pub fn list_dji_volumes() -> Vec<DjiVolume> {
    find_dji_volumes()
}

/// Background poller; emits "dji-volumes-changed" whenever the set changes.
pub fn spawn_volume_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last: Vec<DjiVolume> = Vec::new();
        loop {
            let now = find_dji_volumes();
            if now != last {
                let _ = app.emit("dji-volumes-changed", &now);
                last = now;
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    pub path: String,
    /// Size the frontend last saw — deletion refuses on mismatch.
    pub expected_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Guarded delete: only files inside a DCIM tree (device-cleanup use case),
/// only when the on-disk size still matches what the UI showed. Content-hash
/// verification joins when SQL import tracking lands. Never follows links.
#[tauri::command]
pub fn delete_media_files(files: Vec<DeleteRequest>) -> Vec<DeleteResult> {
    files
        .into_iter()
        .map(|req| {
            let res = checked_delete(&req);
            DeleteResult {
                path: req.path,
                ok: res.is_ok(),
                error: res.err(),
            }
        })
        .collect()
}

fn checked_delete(req: &DeleteRequest) -> Result<(), String> {
    let path = PathBuf::from(&req.path);
    if !path.components().any(|c| c.as_os_str() == "DCIM") {
        return Err("仅允许删除 DCIM 目录内的素材".into());
    }
    let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("无法读取文件: {e}"))?;
    if !meta.is_file() {
        return Err("不是普通文件".into());
    }
    if meta.len() != req.expected_size {
        return Err(format!(
            "文件大小已变化（期望 {}，实际 {}），已跳过",
            req.expected_size,
            meta.len()
        ));
    }
    std::fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))?;
    // Best-effort: remove the paired LRF proxy too
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let lrf = path.with_extension(match ext.chars().next().map(|c| c.is_uppercase()) {
            Some(true) => "LRF",
            _ => "lrf",
        });
        if lrf.is_file() {
            let _ = std::fs::remove_file(&lrf);
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn is_under(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_fixture(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osmo-del-test-{tag}"));
        let dcim = dir.join("DCIM/DJI_001");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dcim).unwrap();
        std::fs::write(dcim.join("DJI_20260701143022_0042_D.MP4"), b"main").unwrap();
        std::fs::write(dcim.join("DJI_20260701143022_0042_D.LRF"), b"prox").unwrap();
        dir
    }

    #[test]
    fn deletes_video_and_paired_lrf() {
        let dir = setup_fixture("ok");
        let mp4 = dir.join("DCIM/DJI_001/DJI_20260701143022_0042_D.MP4");
        let results = delete_media_files(vec![DeleteRequest {
            path: mp4.to_string_lossy().to_string(),
            expected_size: 4,
        }]);
        assert!(results[0].ok, "{:?}", results[0].error);
        assert!(!mp4.exists());
        assert!(!dir.join("DCIM/DJI_001/DJI_20260701143022_0042_D.LRF").exists());
    }

    #[test]
    fn refuses_size_mismatch() {
        let dir = setup_fixture("size");
        let mp4 = dir.join("DCIM/DJI_001/DJI_20260701143022_0042_D.MP4");
        let results = delete_media_files(vec![DeleteRequest {
            path: mp4.to_string_lossy().to_string(),
            expected_size: 999,
        }]);
        assert!(!results[0].ok);
        assert!(mp4.exists(), "file must survive a size mismatch");
    }

    #[test]
    fn refuses_outside_dcim() {
        let dir = std::env::temp_dir().join("osmo-del-test-outside");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("notes.mp4");
        std::fs::write(&f, b"data").unwrap();
        let results = delete_media_files(vec![DeleteRequest {
            path: f.to_string_lossy().to_string(),
            expected_size: 4,
        }]);
        assert!(!results[0].ok);
        assert!(f.exists(), "non-DCIM file must never be deleted");
    }
}
