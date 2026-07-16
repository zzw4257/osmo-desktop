//! Headless test entry for the export pipeline:
//! `cargo run --bin export-cli -- job.json`
//! job.json = serialized ExportArgs (produced by tooling/scripts/gen-export-job.ts)

use std::sync::atomic::AtomicBool;

fn main() {
    let path = std::env::args().nth(1).expect("usage: export-cli <job.json>");
    let json = std::fs::read_to_string(&path).expect("read job file");
    let args: osmo_desktop_lib::export::ExportArgs =
        serde_json::from_str(&json).expect("parse job json");
    let cancel = AtomicBool::new(false);
    let started = std::time::Instant::now();
    match osmo_desktop_lib::export::run_export(&args, &cancel, |ev| {
        eprintln!("event: {}", serde_json::to_string(&ev).unwrap());
    }) {
        Ok(frames) => {
            println!(
                "OK frames={} elapsed={:.1}s fps={:.1}",
                frames,
                started.elapsed().as_secs_f64(),
                frames as f64 / started.elapsed().as_secs_f64()
            );
        }
        Err(e) => {
            eprintln!("FAILED: {e}");
            std::process::exit(1);
        }
    }
}
