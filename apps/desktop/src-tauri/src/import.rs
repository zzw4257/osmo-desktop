//! Copy-import: device/SD clips into the managed library folder.
//! Resume-safe: existing files with matching size are skipped; copies land
//! under a .part name and are renamed only when complete, so an interrupted
//! import never leaves a truncated file that looks whole.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFile {
    pub src_path: String,
    pub lrf_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ImportEvent {
    File { name: String, status: String },
    Done { copied: u32, skipped: u32, failed: u32, dest_dir: String },
}

#[tauri::command]
pub fn default_library_dir() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "无法定位主目录")?;
    Ok(format!("{home}/Movies/OSMO Library"))
}

#[tauri::command]
pub fn import_copy(
    files: Vec<ImportFile>,
    dest_dir: String,
    on_event: tauri::ipc::Channel<ImportEvent>,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let mut copied = 0u32;
        let mut skipped = 0u32;
        let mut failed = 0u32;
        if let Err(e) = std::fs::create_dir_all(&dest_dir) {
            let _ = on_event.send(ImportEvent::File {
                name: dest_dir.clone(),
                status: format!("error: 创建目录失败 {e}"),
            });
            let _ = on_event.send(ImportEvent::Done { copied, skipped, failed: 1, dest_dir });
            return;
        }
        for f in &files {
            for src in std::iter::once(&f.src_path).chain(f.lrf_path.iter()) {
                let name = Path::new(src)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| src.clone());
                match copy_one(src, &dest_dir, &name) {
                    Ok(true) => {
                        copied += 1;
                        let _ = on_event.send(ImportEvent::File { name, status: "copied".into() });
                    }
                    Ok(false) => {
                        skipped += 1;
                        let _ = on_event.send(ImportEvent::File { name, status: "skipped".into() });
                    }
                    Err(e) => {
                        failed += 1;
                        let _ = on_event.send(ImportEvent::File {
                            name,
                            status: format!("error: {e}"),
                        });
                    }
                }
            }
        }
        let _ = on_event.send(ImportEvent::Done { copied, skipped, failed, dest_dir });
    });
    Ok(())
}

/// Ok(true) copied, Ok(false) skipped (already present, same size).
fn copy_one(src: &str, dest_dir: &str, name: &str) -> Result<bool, String> {
    let src_meta = std::fs::metadata(src).map_err(|e| format!("读取源文件失败: {e}"))?;
    if !src_meta.is_file() {
        return Err("不是普通文件".into());
    }
    let dest: PathBuf = Path::new(dest_dir).join(name);
    if let Ok(m) = std::fs::metadata(&dest) {
        if m.len() == src_meta.len() {
            return Ok(false); // resume: already imported
        }
    }
    let part = Path::new(dest_dir).join(format!("{name}.part"));
    std::fs::copy(src, &part).map_err(|e| format!("拷贝失败: {e}"))?;
    std::fs::rename(&part, &dest).map_err(|e| format!("落盘失败: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::copy_one;

    #[test]
    fn copies_then_skips_on_rerun() {
        let dir = std::env::temp_dir().join("osmo-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("lib")).unwrap();
        let src = dir.join("src/DJI_x.MP4");
        std::fs::write(&src, b"payload").unwrap();

        let lib = dir.join("lib").to_string_lossy().to_string();
        let first = copy_one(&src.to_string_lossy(), &lib, "DJI_x.MP4").unwrap();
        assert!(first, "first run copies");
        assert_eq!(std::fs::read(dir.join("lib/DJI_x.MP4")).unwrap(), b"payload");

        let second = copy_one(&src.to_string_lossy(), &lib, "DJI_x.MP4").unwrap();
        assert!(!second, "second run skips (resume)");

        // A stale .part must never satisfy the skip check
        assert!(!dir.join("lib/DJI_x.MP4.part").exists());
    }
}
