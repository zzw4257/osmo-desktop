# 平台能力基线（M0 竖切实测）

测量日期：2026-07-16 ｜ 机器：Apple Silicon Mac, macOS 27.0 ｜ 探针：`packages/color-engine/src/pipeline/precisionProbe.ts`

## 测试方法

- 样片：`samples/ramp_4k_hevc10.mp4`（3840×2160 水平灰阶渐变，HEVC Main10，源文件中行实测 **939 个不同 10-bit Y 值**，范围 1..1021——ffmpeg 解码验证）
- 链路：mp4box demux → WebCodecs VideoDecoder(prefer-hardware) → `importExternalTexture` → WGSL 采样 → rgba16float 渲染目标 → readback 数中间行不同级数
- 判定：≤256 级 = 8-bit 截断；>300 级 = 超过 8-bit

## 实测结果

| Shell | UA/内核 | VideoFrame.format | 灰阶级数 | 结论 |
|---|---|---|---|---|
| 浏览器（Playwright Chromium 149） | Blink | `null`（GPU-backed 不透明帧） | **256** | ❌ 外部纹理路径截断到 8-bit |
| Tauri 2 桌面（WKWebView / WebKit 605.1.15） | WebKit | `"NV12"` | **508** | ✅ 保留 ≥9-bit（未达完整 10-bit） |

播放性能（Chromium 实测）：4K HEVC Main10 (`hvc1.2.4.L156.b0`) 180/180 帧呈现 @30fps，0 丢帧，解码队列稳定。

WKWebView：同一构建的完整链路（解码→外部纹理→渲染→读回）跑通（探针经 `/__probe-result` 回报）。

## 架构结论（约束后续里程碑）

1. **预览走 WebCodecs+WebGPU 双端通用**：桌面预览精度 ~9bit+（视觉上无 banding 问题），网页预览 8-bit（可接受，标注）
2. **10-bit 保真导出必须走原生管线**（M2）：ffmpeg sidecar 解码 rawvideo P010 → 原生 wgpu 跑同一套 WGSL（shader 是纯文本，webview 与原生 wgpu 共享）→ ffmpeg `hevc_videotoolbox` 硬编。不经过 webview 解码路径，绕开两个内核各自的精度天花板，也避免了帧数据 IPC
3. **网页端导出 = 8-bit 层**：解码入口即 8-bit（Chromium 截断），叠加 10-bit 硬编覆盖率 ~8% 的现实——网页端定位为轻量入口，导出时明确提示引导桌面版
4. 每个里程碑用本探针回归（自动在 dev 启动时跑，结果打到 vite 终端）

## 复现

```bash
./tooling/scripts/gen-samples.sh   # 生成样片
pnpm dev:web                        # 浏览器打开 localhost:5173，启动即自动探针
pnpm dev:desktop                    # Tauri 窗口，探针结果打到同一终端
```
