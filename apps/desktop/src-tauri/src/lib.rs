pub mod device;
pub mod export;
pub mod import;
pub mod rtmp;
pub mod scan;

use export::{ExportArgs, ExportEvent};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Default)]
struct ExportJobs {
    next_id: AtomicU32,
    cancel_flags: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

#[tauri::command]
fn export_begin(
    state: State<'_, ExportJobs>,
    args: ExportArgs,
    on_event: Channel<ExportEvent>,
) -> Result<u32, String> {
    let job_id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    state.cancel_flags.lock().unwrap().insert(job_id, cancel.clone());

    std::thread::spawn(move || {
        let _ = export::run_export(&args, &cancel, |ev| {
            let _ = on_event.send(ev);
        });
    });
    Ok(job_id)
}

#[tauri::command]
fn export_cancel(state: State<'_, ExportJobs>, job_id: u32) {
    if let Some(flag) = state.cancel_flags.lock().unwrap().get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportJobs::default())
        .manage(rtmp::RtmpState::default())
        .invoke_handler(tauri::generate_handler![
            export_begin,
            export_cancel,
            scan::scan_media_dir,
            device::list_dji_volumes,
            device::delete_media_files,
            import::default_library_dir,
            import::import_copy,
            rtmp::rtmp_start,
            rtmp::rtmp_stop
        ])
        .setup(|app| {
            device::spawn_volume_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
