//! Wireless preview ingest: the camera (via Mimo 自定义 RTMP) pushes to us;
//! ffmpeg listens as an RTMP server, stream-copies H.264 into fragmented
//! MP4 on stdout, and a tiny localhost HTTP relay hands those bytes to the
//! webview, which plays them through MSE into the grade pipeline.
//!
//! No transcode → latency is dominated by the camera's own buffer (~1-2s).

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, UdpSocket};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub const RTMP_PORT: u16 = 1935;
pub const HTTP_PORT: u16 = 18365;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RtmpInfo {
    pub rtmp_url: String,
    pub http_url: String,
}

pub struct RtmpSession {
    child: Child,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct RtmpState(pub Mutex<Option<RtmpSession>>);

fn lan_ip() -> String {
    // UDP connect() picks the outbound interface without sending packets.
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Spawn the ffmpeg RTMP listener + HTTP relay. Returns the URLs; the relay
/// serves exactly one webview client per session.
pub fn start_relay(ffmpeg: &str, stop: Arc<AtomicBool>) -> Result<(Child, RtmpInfo), String> {
    let mut child = Command::new(ffmpeg)
        .args(["-v", "error", "-listen", "1", "-timeout", "120"])
        .args(["-i", &format!("rtmp://0.0.0.0:{RTMP_PORT}/live")])
        .args(["-c:v", "copy", "-an", "-f", "mp4"])
        .args(["-movflags", "frag_keyframe+empty_moov+default_base_moof"])
        .arg("pipe:1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动 ffmpeg RTMP 监听: {e}"))?;

    let mut ffmpeg_out = child.stdout.take().ok_or("no ffmpeg stdout")?;
    let listener = TcpListener::bind(("127.0.0.1", HTTP_PORT))
        .map_err(|e| format!("HTTP 中继端口被占用: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let stop_relay = stop.clone();
    std::thread::spawn(move || {
        // Wait (interruptibly) for the single webview client.
        let mut client = loop {
            if stop_relay.load(Ordering::Relaxed) {
                return;
            }
            match listener.accept() {
                Ok((s, _)) => break s,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(_) => return,
            }
        };
        // Drain the request head, then stream until EOF/stop.
        let mut head = [0u8; 2048];
        let _ = client.read(&mut head);
        let _ = client.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        );
        let mut buf = [0u8; 64 * 1024];
        loop {
            if stop_relay.load(Ordering::Relaxed) {
                break;
            }
            match ffmpeg_out.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if client.write_all(&buf[..n]).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok((
        child,
        RtmpInfo {
            rtmp_url: format!("rtmp://{}:{}/live", lan_ip(), RTMP_PORT),
            http_url: format!("http://127.0.0.1:{HTTP_PORT}/stream.mp4"),
        },
    ))
}

#[tauri::command]
pub fn rtmp_start(state: tauri::State<'_, RtmpState>) -> Result<RtmpInfo, String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(old) = guard.take() {
        old.stop.store(true, Ordering::Relaxed);
        let mut child = old.child;
        let _ = child.kill();
        let _ = child.wait();
    }
    let stop = Arc::new(AtomicBool::new(false));
    let (child, info) = start_relay(&crate::export::ffmpeg_path(), stop.clone())?;
    *guard = Some(RtmpSession { child, stop });
    Ok(info)
}

#[tauri::command]
pub fn rtmp_stop(state: tauri::State<'_, RtmpState>) {
    if let Some(session) = state.0.lock().unwrap().take() {
        session.stop.store(true, Ordering::Relaxed);
        let mut child = session.child;
        let _ = child.kill();
        let _ = child.wait();
    }
}
