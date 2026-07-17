pub mod export;
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
        .invoke_handler(tauri::generate_handler![export_begin, export_cancel, scan::scan_media_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
