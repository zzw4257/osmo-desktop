# OSMO Desktop

桌面版 DJI Mimo：面向 DJI Pocket 系列（Pocket 4 优先）的素材管理 + 专业调色 + 10-bit 导出工作站。
一套代码双端发布：**Tauri 2 桌面应用** + **网页应用**。

## 当前进度

- ✅ **M0** 脚手架 + 4K HEVC 10-bit 播放竖切（双端验证，精度基线见 `docs/baselines.md`）
- ✅ **M1** 调色引擎：WGSL mega-shader（D-Log 官方公式 CST / LUT 还原 / 白平衡 / 影调六件套 /
  色轮 / 曲线 / HSL 8 分区 / 分离色调 / 暗角……）、示波器三件套（直方图/波形/矢量）、
  媒体库（DJI 识别 + LRF 代理缩略图）、grade 持久化
- 🔄 **M2** 进行中：✅ 原生 10-bit 导出管线（ffmpeg⇄wgpu，实测 877/939 灰阶保真）、
  ✅ 桌面原生扫描/导出 UI；⏳ undo/redo 持久化、USB 卷探测+一键删除、LRF scrub、真机验证轮
- ⏳ **M3**：网页导出、UVC/RTMP 实时预览、签名打包分发

## 开发

```bash
pnpm install
pnpm dev:web        # 浏览器端 localhost:5173（Chrome/Edge 功能最全）
pnpm dev:desktop    # Tauri 桌面端（需 Rust 工具链）
./tooling/scripts/gen-samples.sh   # 生成 4K 10-bit 测试样片（需 ffmpeg）

# 验证
pnpm typecheck && pnpm test               # TS
(cd apps/desktop/src-tauri && cargo test --lib)   # Rust
```

dev 启动时会自动运行 10-bit 精度探针，结果以 `[PROBE-RESULT]` 打到终端。

### 无 UI 验证导出管线

```bash
pnpm exec tsx tooling/scripts/gen-export-job.ts <src.mp4> <out.mp4> 3840 2160 30 dlog job.json 0.5
(cd apps/desktop/src-tauri && cargo run --bin export-cli -- job.json)
```

## 架构要点

- **单一数学源**：调色数学只存在于 WGSL 核心（`packages/color-engine/src/pipeline/gradeCore.ts`）
  与 TS 打包器；预览（webview fragment shader）与导出（Rust 原生 wgpu compute）拼接同一段 WGSL，
  Rust 侧零调色数学，只接收 TS 打包的 params/曲线/LUT 二进制 blob
- **精度分层**（实测结论）：预览走 WebCodecs+WebGPU（桌面 ~9bit / 网页 8bit），
  10-bit 保真导出走原生 `ffmpeg 解码 → wgpu 调色 → VideoToolbox 硬编`
- **包边界**：`platform` 是唯一接触 Tauri API 的 TS 包（动态导入，网页包零污染）；
  `color-engine` 只认纹理不认视频来源；`media-pipeline` 不知调色存在
- 设计文档：`docs/m2-export-design.md`（导出）、`docs/baselines.md`（平台能力基线）

## 目录

```
packages/   shared color-engine scopes media-pipeline device-core storage platform presets ui app
apps/       desktop(Tauri 2 + Rust crates)  web(Vite)
tooling/    scripts(样片/导出任务生成)  tsconfig  vite
samples/    生成的测试样片（gitignored）+ fake-dcim 测试夹具
```
