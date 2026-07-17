//! Headless test entry for the RTMP relay:
//! `cargo run --bin rtmp-relay-cli`
//! Then push:  ffmpeg -re -i sample.mp4 -c:v libx264 -an -f flv rtmp://127.0.0.1:1935/live
//! And fetch:  curl -m 10 http://127.0.0.1:18365/stream.mp4 -o out.fmp4

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

fn main() {
    let stop = Arc::new(AtomicBool::new(false));
    let (mut child, info) =
        osmo_desktop_lib::rtmp::start_relay(&osmo_desktop_lib::export::ffmpeg_path(), stop)
            .expect("start relay");
    println!("rtmp_url={}", info.rtmp_url);
    println!("http_url={}", info.http_url);
    let status = child.wait().expect("wait ffmpeg");
    println!("ffmpeg exited: {status}");
}
