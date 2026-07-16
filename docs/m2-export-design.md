# M2 导出管线设计（桌面 · 10-bit 保真路径）

依据 `docs/baselines.md` 的结论：webview 解码路径精度受限（Chromium 8-bit / WKWebView ~9bit），
10-bit 保真导出必须完全绕开 webview 的解码与纹理导入。

## 数据流

```
ffmpeg#1 (sidecar)                Rust (export-bridge crate)              ffmpeg#2 (sidecar)
-i src -map 0:v:0                 ┌─────────────────────────┐             -f rawvideo -pix_fmt p010le
-f rawvideo -pix_fmt p010le  ──►  │ 读 stdout 帧 (w*h*3 字节) │             -s WxH -r fps -i pipe:0
pipe:1                            │ Y→r16unorm 纹理          │             -i src -map 0:v -map 1:a?
                                  │ UV→rg16unorm 纹理(半分辨) │             -c:a copy
                                  │ wgpu compute: 共享 WGSL   │  ──stdin──► -c:v hevc_videotoolbox
                                  │ → P010 storage buffer    │             -profile:v 2 -pix_fmt p010le
                                  │ map & write              │             -tag:v hvc1 out.mp4
                                  └─────────────────────────┘
```

背压天然由管道缓冲实现（读不动就停解，写不动就停渲）。

## 单一数学源原则（关键决策）

调色数学只存在于两处且都是「生成物」：
1. **WGSL 核心函数**（`packages/color-engine/src/pipeline/wgsl/gradeCore.ts` 导出的字符串）——
   preview fragment shader 与 export compute shader 共同拼接它
2. **TS 打包器**（uniforms.ts / spline.ts / cubeParser.ts）——导出时前端把
   params(288B)、curves(1024×6 f32)、input/creative LUT(rgba16f) 打包成
   字节 blob 经 IPC 传给 Rust；**Rust 不重新实现任何调色数学**，只上传 blob

## IPC 接口（Tauri commands）

- `export_begin(job) -> jobId`：job = { srcPath, outPath, width, height, fps,
  paramsB64, curvesB64, inputLutB64+size, creativeLutB64+size }
- 事件 Channel：`{type:"progress", frame, fps} | {type:"done"} | {type:"error", message}`
- `export_cancel(jobId)`

## P010 与 limited-range 注意

P010 = 10 位存于 16 位高位（v16 = v10 << 6）。r16unorm 采样得 v16/65535。
视频是 limited range（Y: 64..940, C: 64..960，均为 10-bit 值）：
`y = (v*65535/64 - 64)/876`，`c = (v*65535/64 - 512)/896`，BT.709 矩阵转 RGB。
输出侧逆变换回 limited-range P010。用 ramp 样片验证（导出后 ffprobe/解码数灰阶应 >900）。

## 里程碑内验证

1. 单测：TS 打包 blob 的字节布局快照
2. ramp 样片 + 中性 grade 导出 → ffmpeg 解码数灰阶 ≈ 源（>900 级，证明 10-bit 全程保真）
3. 加曝光 grade 导出 → 目视 + ffprobe（hevc / Main 10 / yuv420p10le / hvc1）
4. 音频拷贝：带音轨素材导出后音画同步
