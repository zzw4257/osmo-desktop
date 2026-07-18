//! Native 10-bit export pipeline (see docs/m2-export-design.md):
//! ffmpeg decode → rawvideo P010 pipe → wgpu compute (the SAME WGSL grade
//! core the preview uses, received from the frontend) → P010 pipe →
//! ffmpeg VideoToolbox 10-bit encode with audio stream-copied from source.
//!
//! Rust implements NO grading math: params/curves/LUT blobs are packed by
//! the TypeScript single-source-of-truth and uploaded verbatim.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub src_path: String,
    pub out_path: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub bitrate_mbps: u32,
    pub shader_wgsl: String,
    pub params_b64: String,
    pub curves_b64: String,
    pub input_lut_b64: String,
    pub input_lut_size: u32,
    pub creative_lut_b64: String,
    pub creative_lut_size: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExportEvent {
    Progress { frame: u32 },
    Done { frames: u32 },
    Error { message: String },
}

/// Resolve ffmpeg. GUI apps launched from Finder don't inherit the shell
/// PATH, so probe the common install locations before falling back to PATH
/// lookup. A bundled static sidecar can replace this wholesale later.
pub fn ffmpeg_path() -> String {
    if let Ok(p) = std::env::var("OSMO_FFMPEG") {
        return p;
    }
    for candidate in [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/opt/local/bin/ffmpeg",
    ] {
        if std::path::Path::new(candidate).is_file() {
            return candidate.to_string();
        }
    }
    "ffmpeg".to_string()
}

/// Blocking export loop. `emit` receives progress/done/error events.
pub fn run_export(
    args: &ExportArgs,
    cancel: &AtomicBool,
    mut emit: impl FnMut(ExportEvent),
) -> Result<u32, String> {
    let w = args.width as usize;
    let h = args.height as usize;
    if w % 2 != 0 || h % 2 != 0 {
        return Err(format!("odd frame size {w}x{h} unsupported"));
    }
    let frame_bytes = w * h * 3; // P010: Y = 2wh, UV interleaved = wh
    let b64 = base64::engine::general_purpose::STANDARD;
    let params = b64.decode(&args.params_b64).map_err(err_str)?;
    let curves = b64.decode(&args.curves_b64).map_err(err_str)?;
    let input_lut = b64.decode(&args.input_lut_b64).map_err(err_str)?;
    let creative_lut = b64.decode(&args.creative_lut_b64).map_err(err_str)?;

    // ---- GPU setup ----
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        ..Default::default()
    }))
    .map_err(err_str)?;
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("export"),
        required_features: wgpu::Features::TEXTURE_FORMAT_16BIT_NORM,
        required_limits: wgpu::Limits::default(),
        experimental_features: wgpu::ExperimentalFeatures::disabled(),
        memory_hints: wgpu::MemoryHints::MemoryUsage,
        trace: wgpu::Trace::Off,
    }))
    .map_err(err_str)?;

    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("grade-export"),
        source: wgpu::ShaderSource::Wgsl(args.shader_wgsl.clone().into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("grade-export"),
        layout: None,
        module: &module,
        entry_point: Some("main"),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });

    // group(0): params + curves
    let params_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("params"),
        size: params.len() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    queue.write_buffer(&params_buf, 0, &params);

    let curves_tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("curves"),
        size: wgpu::Extent3d { width: 1024, height: 6, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R32Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &curves_tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &curves,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(1024 * 4),
            rows_per_image: Some(6),
        },
        wgpu::Extent3d { width: 1024, height: 6, depth_or_array_layers: 1 },
    );

    let upload_lut3d = |bytes: &[u8], size: u32, label: &str| -> wgpu::Texture {
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width: size, height: size, depth_or_array_layers: size },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(size * 8),
                rows_per_image: Some(size),
            },
            wgpu::Extent3d { width: size, height: size, depth_or_array_layers: size },
        );
        tex
    };
    let input_lut_tex = upload_lut3d(&input_lut, args.input_lut_size, "input-lut");
    let creative_lut_tex = upload_lut3d(&creative_lut, args.creative_lut_size, "creative-lut");
    let lut_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("lut"),
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });

    // group(1): frame planes + output
    let y_tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("y-plane"),
        size: wgpu::Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R16Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let uv_tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("uv-plane"),
        size: wgpu::Extent3d {
            width: (w / 2) as u32,
            height: (h / 2) as u32,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rg16Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let out_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("out-p010"),
        size: frame_bytes as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("staging"),
        size: frame_bytes as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let info_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("frame-info"),
        size: 8,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    queue.write_buffer(&info_buf, 0, &[(w as u32).to_le_bytes(), (h as u32).to_le_bytes()].concat());

    let group0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("g0"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: params_buf.as_entire_binding() },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(
                    &curves_tex.create_view(&Default::default()),
                ),
            },
        ],
    });
    let y_view = y_tex.create_view(&Default::default());
    let uv_view = uv_tex.create_view(&Default::default());
    let group1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("g1"),
        layout: &pipeline.get_bind_group_layout(1),
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&y_view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&uv_view) },
            wgpu::BindGroupEntry { binding: 2, resource: out_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 3, resource: info_buf.as_entire_binding() },
        ],
    });
    let group2 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("g2"),
        layout: &pipeline.get_bind_group_layout(2),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(
                    &input_lut_tex.create_view(&Default::default()),
                ),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(
                    &creative_lut_tex.create_view(&Default::default()),
                ),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(&lut_sampler),
            },
        ],
    });

    // ---- ffmpeg processes ----
    let ffmpeg = ffmpeg_path();
    let mut decoder = spawn_logged(
        Command::new(&ffmpeg)
            .args(["-v", "error", "-i", &args.src_path])
            .args(["-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "p010le", "pipe:1"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null()),
    )?;
    let fps = format!("{}", args.fps);
    let size = format!("{}x{}", w, h);
    let bitrate = format!("{}M", args.bitrate_mbps);
    let mut encoder = spawn_logged(
        Command::new(&ffmpeg)
            .args(["-v", "error", "-y"])
            .args(["-f", "rawvideo", "-pix_fmt", "p010le", "-s", &size, "-r", &fps])
            // Color tags MUST be set on the input side too: ffmpeg's
            // hevc_videotoolbox wrapper reads color_primaries/color_trc from
            // the decoded AVFrame's own metadata to populate the encoded
            // HEVC VUI, not purely from output-side override flags (verified
            // empirically — output-only flags silently write matrix_coefficients
            // but leave primaries/transfer as "unknown" in the exported file).
            .args(["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"])
            .args(["-i", "pipe:0"])
            .args(["-i", &args.src_path])
            .args(["-map", "0:v", "-map", "1:a?", "-c:a", "copy"])
            .args(["-c:v", "hevc_videotoolbox", "-profile:v", "main10", "-b:v", &bitrate])
            .args(["-pix_fmt", "p010le", "-colorspace", "bt709", "-color_primaries", "bt709"])
            .args(["-color_trc", "bt709", "-tag:v", "hvc1", "-movflags", "+faststart"])
            .arg(&args.out_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped()),
    )?;

    let mut dec_out = decoder.child.stdout.take().ok_or("no decoder stdout")?;
    let mut enc_in = encoder.child.stdin.take().ok_or("no encoder stdin")?;

    // ---- frame loop ----
    let mut frame_data = vec![0u8; frame_bytes];
    let mut frames: u32 = 0;
    let result = loop {
        if cancel.load(Ordering::Relaxed) {
            break Err("已取消".to_string());
        }
        match dec_out.read_exact(&mut frame_data) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break Ok(frames),
            Err(e) => break Err(format!("解码读取失败: {e}")),
        }

        // upload planes: Y (2wh bytes) then interleaved UV (wh bytes)
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &y_tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &frame_data[..w * h * 2],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some((w * 2) as u32),
                rows_per_image: Some(h as u32),
            },
            wgpu::Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: 1 },
        );
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &uv_tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &frame_data[w * h * 2..],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some((w * 2) as u32),
                rows_per_image: Some((h / 2) as u32),
            },
            wgpu::Extent3d {
                width: (w / 2) as u32,
                height: (h / 2) as u32,
                depth_or_array_layers: 1,
            },
        );

        let mut enc = device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_compute_pass(&Default::default());
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &group0, &[]);
            pass.set_bind_group(1, &group1, &[]);
            pass.set_bind_group(2, &group2, &[]);
            pass.dispatch_workgroups(
                ((w / 2) as u32).div_ceil(8),
                ((h / 2) as u32).div_ceil(8),
                1,
            );
        }
        enc.copy_buffer_to_buffer(&out_buf, 0, &staging, 0, frame_bytes as u64);
        queue.submit([enc.finish()]);

        let slice = staging.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        device.poll(wgpu::PollType::wait_indefinitely()).map_err(err_str)?;
        {
            let mapped = match slice.get_mapped_range() {
                Ok(m) => m,
                Err(e) => break Err(format!("GPU 读回失败: {e}")),
            };
            if let Err(e) = enc_in.write_all(&mapped) {
                drop(mapped);
                staging.unmap();
                break Err(format!("编码写入失败: {e}"));
            }
        }
        staging.unmap();

        frames += 1;
        if frames % 10 == 0 {
            emit(ExportEvent::Progress { frame: frames });
        }
    };

    // ---- teardown ----
    drop(enc_in); // close encoder stdin → ffmpeg finalizes the file
    let _ = decoder.child.kill();
    let _ = decoder.child.wait();
    let enc_status = encoder.child.wait().map_err(err_str)?;

    match result {
        Ok(frames) => {
            if !enc_status.success() {
                return Err(format!("编码器退出异常: {}", encoder.stderr_tail()));
            }
            emit(ExportEvent::Done { frames });
            Ok(frames)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&args.out_path);
            let detail = format!(
                "{e}{}{}",
                fmt_tail("；解码器: ", &decoder.stderr_tail()),
                fmt_tail("；编码器: ", &encoder.stderr_tail()),
            );
            emit(ExportEvent::Error { message: detail.clone() });
            Err(detail)
        }
    }
}

fn fmt_tail(prefix: &str, tail: &str) -> String {
    if tail.is_empty() { String::new() } else { format!("{prefix}{tail}") }
}

struct LoggedChild {
    child: Child,
    stderr: Arc<std::sync::Mutex<String>>,
}

impl LoggedChild {
    fn stderr_tail(&self) -> String {
        let s = self.stderr.lock().unwrap();
        let tail: String = s.chars().rev().take(400).collect::<String>().chars().rev().collect();
        tail.trim().to_string()
    }
}

fn spawn_logged(cmd: &mut Command) -> Result<LoggedChild, String> {
    let mut child = cmd.spawn().map_err(|e| format!("无法启动 ffmpeg: {e}"))?;
    let stderr = Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(err) = child.stderr.take() {
        let sink = stderr.clone();
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(err);
            let mut buf = String::new();
            let _ = reader.read_to_string(&mut buf);
            *sink.lock().unwrap() = buf;
        });
    }
    Ok(LoggedChild { child, stderr })
}

fn err_str(e: impl std::fmt::Display) -> String {
    e.to_string()
}
