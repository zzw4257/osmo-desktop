import type { Grade, HslBand } from "@osmo/color-engine";
import { HSL_BANDS, bakeCurveLut, defaultOps } from "@osmo/color-engine";
import { FILTER_PRESETS, applyPreset } from "@osmo/presets";
import type { ColorProfile } from "@osmo/shared";
import { ColorWheel, CurveEditor, Section, Slider, tokens } from "@osmo/ui";
import { useState } from "react";

export interface AdjustPanelProps {
  grade: Grade;
  onChange: (next: Grade) => void;
  onPickCreativeLut: (file: File) => void;
  onPickInputLut: (file: File) => void;
}

const PROFILES: Array<{ value: ColorProfile; label: string }> = [
  { value: "rec709", label: "普通 (Rec.709)" },
  { value: "dlog", label: "D-Log（Pocket 4 · 官方公式）" },
  { value: "dlog-m", label: "D-Log M（Pocket 3 · 需导入 LUT）" },
  { value: "dlog2", label: "D-Log 2（Pocket 4P · 需导入 LUT）" },
  { value: "hlg", label: "HLG（BT.2100 → SDR 映射）" },
];

const CURVE_TABS = [
  { key: "luma", label: "明度", accent: "#f2f2f3" },
  { key: "red", label: "红", accent: "#ff5f57" },
  { key: "green", label: "绿", accent: "#6fdd8b" },
  { key: "blue", label: "蓝", accent: "#5cb2ff" },
  { key: "hueVsHue", label: "色相→色相", accent: "#d078ff" },
  { key: "hueVsSat", label: "色相→饱和", accent: "#ffbd2e" },
] as const;

const BAND_LABELS: Record<HslBand, string> = {
  red: "红",
  orange: "橙",
  yellow: "黄",
  green: "绿",
  aqua: "青",
  blue: "蓝",
  purple: "紫",
  magenta: "洋红",
};

const BAND_COLORS: Record<HslBand, string> = {
  red: "#ff5f57",
  orange: "#ff9f43",
  yellow: "#f7ff5c",
  green: "#6fdd8b",
  aqua: "#4dd6c2",
  blue: "#5cb2ff",
  purple: "#9b7aff",
  magenta: "#ff6ad5",
};

/** The full grading panel — every op the WGSL pipeline exposes. */
export function AdjustPanel({ grade, onChange, onPickCreativeLut, onPickInputLut }: AdjustPanelProps) {
  const [curveTab, setCurveTab] = useState<(typeof CURVE_TABS)[number]["key"]>("luma");
  const [hslBand, setHslBand] = useState<HslBand>("orange");

  const ops = grade.ops;
  const patch = (p: Partial<Grade["ops"]>) => onChange({ ...grade, ops: { ...ops, ...p } });
  const patchInput = (p: Partial<Grade["input"]>) =>
    onChange({ ...grade, input: { ...grade.input, ...p } });

  const d = defaultOps();

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <Section title="色彩还原" defaultOpen badge={grade.input.profile !== "rec709" ? grade.input.profile.toUpperCase() : undefined}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <select
            value={grade.input.profile}
            onChange={(e) => patchInput({ profile: e.target.value as ColorProfile })}
            style={selectStyle}
          >
            {PROFILES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {(grade.input.profile === "dlog-m" || grade.input.profile === "dlog2") && (
            <label style={lutButtonStyle}>
              导入官方 .cube 还原 LUT
              <input
                type="file"
                accept=".cube"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    onPickInputLut(f);
                    patchInput({ inputLut: f.name });
                  }
                }}
              />
            </label>
          )}
          <Slider
            label="还原强度"
            value={Math.round(grade.input.strength * 100)}
            min={0}
            max={100}
            defaultValue={100}
            onChange={(v) => patchInput({ strength: v / 100 })}
          />
        </div>
      </Section>

      <Section
        title="滤镜"
        defaultOpen
        badge={
          grade.presetId
            ? FILTER_PRESETS.find((p) => p.id === grade.presetId)?.name
            : undefined
        }
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTER_PRESETS.map((p) => {
            const active = (grade.presetId ?? "none") === p.id;
            return (
              <button
                key={p.id}
                onClick={() =>
                  onChange({
                    ...grade,
                    presetId: p.id === "none" ? null : p.id,
                    ops: applyPreset(ops, p),
                  })
                }
                style={{
                  ...chipStyle,
                  padding: "5px 12px",
                  borderColor: active ? tokens.color.accent : tokens.color.border,
                  color: active ? tokens.color.accent : tokens.color.textDim,
                  background: active ? "rgba(255,106,0,0.10)" : "transparent",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 10, color: tokens.color.textDim, margin: "8px 0 0" }}>
          滤镜只写入风格参数，套用后所有项仍可继续微调
        </p>
      </Section>

      <Section title="白平衡" onReset={() => patch({ whiteBalance: d.whiteBalance })}>
        <Slider label="色温" value={ops.whiteBalance.temp} min={-100} max={100}
          onChange={(v) => patch({ whiteBalance: { ...ops.whiteBalance, temp: v } })} />
        <Slider label="色调" value={ops.whiteBalance.tint} min={-100} max={100}
          onChange={(v) => patch({ whiteBalance: { ...ops.whiteBalance, tint: v } })} />
      </Section>

      <Section title="影调" defaultOpen onReset={() => patch({ tonal: d.tonal })}>
        <Slider label="曝光" value={ops.tonal.exposure} min={-4} max={4} step={0.05}
          format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`}
          onChange={(v) => patch({ tonal: { ...ops.tonal, exposure: v } })} />
        <Slider label="对比度" value={ops.tonal.contrast} min={-100} max={100}
          onChange={(v) => patch({ tonal: { ...ops.tonal, contrast: v } })} />
        <Slider label="高光" value={ops.tonal.highlights} min={-100} max={100}
          onChange={(v) => patch({ tonal: { ...ops.tonal, highlights: v } })} />
        <Slider label="阴影" value={ops.tonal.shadows} min={-100} max={100}
          onChange={(v) => patch({ tonal: { ...ops.tonal, shadows: v } })} />
        <Slider label="白色" value={ops.tonal.whites} min={-100} max={100}
          onChange={(v) => patch({ tonal: { ...ops.tonal, whites: v } })} />
        <Slider label="黑色" value={ops.tonal.blacks} min={-100} max={100}
          onChange={(v) => patch({ tonal: { ...ops.tonal, blacks: v } })} />
      </Section>

      <Section title="色轮" onReset={() => patch({ wheels: d.wheels })}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <ColorWheel label="Lift 阴影" value={ops.wheels.lift} size={82}
            onChange={(v) => patch({ wheels: { ...ops.wheels, lift: v } })} />
          <ColorWheel label="Gamma 中间调" value={ops.wheels.gamma} size={82}
            onChange={(v) => patch({ wheels: { ...ops.wheels, gamma: v } })} />
          <ColorWheel label="Gain 高光" value={ops.wheels.gain} size={82}
            onChange={(v) => patch({ wheels: { ...ops.wheels, gain: v } })} />
          <ColorWheel label="Offset 整体" value={ops.wheels.offset} size={82} range={0.2}
            onChange={(v) => patch({ wheels: { ...ops.wheels, offset: v } })} />
        </div>
      </Section>

      <Section title="曲线" onReset={() => patch({ curves: d.curves })}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
          {CURVE_TABS.map((t) => (
            <button key={t.key} onClick={() => setCurveTab(t.key)}
              style={{
                ...chipStyle,
                borderColor: curveTab === t.key ? t.accent : tokens.color.border,
                color: curveTab === t.key ? t.accent : tokens.color.textDim,
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <CurveEditor
          points={ops.curves[curveTab]}
          bake={(pts, size) =>
            bakeCurveLut(pts, size, curveTab === "hueVsHue" || curveTab === "hueVsSat" ? "zero" : "diagonal")
          }
          identity={curveTab === "hueVsHue" || curveTab === "hueVsSat" ? "zero" : "diagonal"}
          accent={CURVE_TABS.find((t) => t.key === curveTab)!.accent}
          width={252}
          height={150}
          onChange={(pts) => patch({ curves: { ...ops.curves, [curveTab]: pts } })}
        />
        <p style={{ fontSize: 10, color: tokens.color.textDim, margin: "6px 0 0" }}>
          单击添加点 · 拖动调整 · 双击删除
        </p>
      </Section>

      <Section title="HSL 分区" onReset={() => patch({ hsl: d.hsl })}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {HSL_BANDS.map((b) => (
            <button key={b} onClick={() => setHslBand(b)} title={BAND_LABELS[b]}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                cursor: "pointer",
                background: BAND_COLORS[b],
                border: hslBand === b ? `2px solid ${tokens.color.text}` : "2px solid transparent",
                opacity: hslBand === b ? 1 : 0.55,
              }} />
          ))}
        </div>
        <Slider label={`${BAND_LABELS[hslBand]} · 色相`} value={ops.hsl[hslBand].h} min={-60} max={60}
          onChange={(v) => patch({ hsl: { ...ops.hsl, [hslBand]: { ...ops.hsl[hslBand], h: v } } })} />
        <Slider label={`${BAND_LABELS[hslBand]} · 饱和度`} value={ops.hsl[hslBand].s} min={-100} max={100}
          onChange={(v) => patch({ hsl: { ...ops.hsl, [hslBand]: { ...ops.hsl[hslBand], s: v } } })} />
        <Slider label={`${BAND_LABELS[hslBand]} · 明度`} value={ops.hsl[hslBand].l} min={-100} max={100}
          onChange={(v) => patch({ hsl: { ...ops.hsl, [hslBand]: { ...ops.hsl[hslBand], l: v } } })} />
      </Section>

      <Section title="色彩" onReset={() => patch({ saturation: 0, vibrance: 0 })}>
        <Slider label="饱和度" value={ops.saturation} min={-100} max={100}
          onChange={(v) => patch({ saturation: v })} />
        <Slider label="自然饱和度" value={ops.vibrance} min={-100} max={100}
          onChange={(v) => patch({ vibrance: v })} />
      </Section>

      <Section title="创意 LUT">
        <label style={lutButtonStyle}>
          {ops.creativeLut ? `已加载 · 点击更换` : "导入 .cube LUT"}
          <input type="file" accept=".cube" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onPickCreativeLut(f);
                patch({ creativeLut: { hash: f.name, strength: ops.creativeLut?.strength ?? 1 } });
              }
            }} />
        </label>
        {ops.creativeLut && (
          <>
            <Slider label="LUT 强度" value={Math.round(ops.creativeLut.strength * 100)} min={0} max={100}
              defaultValue={100}
              onChange={(v) => patch({ creativeLut: { ...ops.creativeLut!, strength: v / 100 } })} />
            <button style={{ ...chipStyle, marginTop: 4 }} onClick={() => patch({ creativeLut: null })}>
              移除 LUT
            </button>
          </>
        )}
      </Section>

      <Section title="细节" onReset={() => patch({ detail: d.detail })}>
        <Slider label="锐化" value={ops.detail.sharpen} min={0} max={100}
          onChange={(v) => patch({ detail: { ...ops.detail, sharpen: v } })} />
        <Slider label="降噪" value={ops.detail.denoise} min={0} max={100}
          onChange={(v) => patch({ detail: { ...ops.detail, denoise: v } })} />
        <Slider label="颗粒" value={ops.detail.grain} min={0} max={100}
          onChange={(v) => patch({ detail: { ...ops.detail, grain: v } })} />
      </Section>

      <Section title="效果" onReset={() => patch({ splitTone: d.splitTone, fade: 0, vignette: d.vignette })}>
        <Slider label="褪色" value={ops.fade} min={0} max={100} onChange={(v) => patch({ fade: v })} />
        <Slider label="阴影色相" value={ops.splitTone.shadowHue} min={0} max={360}
          onChange={(v) => patch({ splitTone: { ...ops.splitTone, shadowHue: v } })} />
        <Slider label="阴影染色" value={ops.splitTone.shadowSat} min={0} max={100}
          onChange={(v) => patch({ splitTone: { ...ops.splitTone, shadowSat: v } })} />
        <Slider label="高光色相" value={ops.splitTone.highlightHue} min={0} max={360}
          onChange={(v) => patch({ splitTone: { ...ops.splitTone, highlightHue: v } })} />
        <Slider label="高光染色" value={ops.splitTone.highlightSat} min={0} max={100}
          onChange={(v) => patch({ splitTone: { ...ops.splitTone, highlightSat: v } })} />
        <Slider label="染色平衡" value={ops.splitTone.balance} min={-100} max={100}
          onChange={(v) => patch({ splitTone: { ...ops.splitTone, balance: v } })} />
        <div style={{ height: 8 }} />
        <Slider label="暗角强度" value={ops.vignette.amount} min={-100} max={100}
          onChange={(v) => patch({ vignette: { ...ops.vignette, amount: v } })} />
        <Slider label="暗角中点" value={ops.vignette.midpoint} min={0} max={100} defaultValue={50}
          onChange={(v) => patch({ vignette: { ...ops.vignette, midpoint: v } })} />
        <Slider label="暗角圆度" value={ops.vignette.roundness} min={-100} max={100}
          onChange={(v) => patch({ vignette: { ...ops.vignette, roundness: v } })} />
        <Slider label="暗角羽化" value={ops.vignette.feather} min={0} max={100} defaultValue={50}
          onChange={(v) => patch({ vignette: { ...ops.vignette, feather: v } })} />
      </Section>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: tokens.color.surfaceRaised,
  color: tokens.color.text,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.sm,
  padding: "6px 8px",
  fontSize: 12,
};

const chipStyle: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${tokens.color.border}`,
  color: tokens.color.textDim,
  borderRadius: 999,
  padding: "3px 10px",
  fontSize: 11,
  cursor: "pointer",
};

const lutButtonStyle: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  background: tokens.color.surfaceRaised,
  border: `1px dashed ${tokens.color.border}`,
  color: tokens.color.textDim,
  borderRadius: tokens.radius.sm,
  padding: "8px",
  fontSize: 12,
  cursor: "pointer",
};
