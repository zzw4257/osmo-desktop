//! Native media folder scan: fast recursive listing with LRF pairing.
//! DJI-specific interpretation (filename → shot time, DCIM fingerprint)
//! stays in TypeScript (device-core) — Rust only lists what exists.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub path: String,
    pub name: String,
    pub rel_dir: String,
    pub size: u64,
    pub lrf_path: Option<String>,
}

const MAX_DEPTH: usize = 5;
const VIDEO_EXTS: [&str; 2] = ["mp4", "mov"];

#[tauri::command]
pub fn scan_media_dir(root: String) -> Result<Vec<MediaEntry>, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("不是文件夹: {root}"));
    }
    let mut files: Vec<(String, u64)> = Vec::new();
    walk(root_path, 0, &mut files).map_err(|e| e.to_string())?;

    let lower_set: std::collections::HashMap<String, String> = files
        .iter()
        .map(|(p, _)| (p.to_lowercase(), p.clone()))
        .collect();

    let mut entries = Vec::new();
    for (path, size) in &files {
        let p = Path::new(path);
        let Some(ext) = p.extension().and_then(|e| e.to_str()) else { continue };
        if !VIDEO_EXTS.contains(&ext.to_lowercase().as_str()) {
            continue;
        }
        let stem_path = path[..path.len() - ext.len() - 1].to_string();
        let lrf_path = lower_set.get(&format!("{}.lrf", stem_path.to_lowercase())).cloned();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let rel_dir = p
            .parent()
            .and_then(|d| d.strip_prefix(root_path).ok())
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default();
        entries.push(MediaEntry {
            path: path.clone(),
            name,
            rel_dir,
            size: *size,
            lrf_path,
        });
    }
    Ok(entries)
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<(String, u64)>) -> std::io::Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let ft = entry.file_type()?;
        if ft.is_dir() {
            let _ = walk(&entry.path(), depth + 1, out);
        } else if ft.is_file() {
            let meta = entry.metadata()?;
            out.push((entry.path().to_string_lossy().to_string(), meta.len()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn scans_fake_dcim_and_pairs_lrf() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../samples/fake-dcim");
        let entries = super::scan_media_dir(root.to_string()).expect("scan ok");
        assert_eq!(entries.len(), 2, "two videos expected");
        let with_lrf = entries
            .iter()
            .find(|e| e.name == "DJI_20260701143022_0042_D.MP4")
            .expect("0042 clip present");
        assert!(with_lrf.lrf_path.as_deref().unwrap_or("").ends_with(".LRF"));
        assert_eq!(with_lrf.rel_dir, "DCIM/DJI_001");
    }
}
