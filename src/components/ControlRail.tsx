import React, { useRef } from 'react';
import { ImagePlus, Music2, RotateCcw, Upload } from 'lucide-react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  BASS_INTENSITY_PRESETS,
  COLOR_THEMES,
  ColorThemeKey,
  FIT_MODES,
  FitMode,
  FpsOption,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  WAVEFORM_STYLES,
  WaveformColorMix,
  WaveformLayoutConfig,
  WaveformStyle,
  clampWaveformLayout,
  getThemeColorMix,
} from '../engine/presets';
import { DEMO_ARTWORKS } from '../engine/demoArtworks';

interface ControlRailProps {
  selectedArtworkId: string;
  customImageName: string | null;
  audioName: string;
  isDemoAudio: boolean;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  theme: ColorThemeKey;
  colorMix: WaveformColorMix;
  bassIntensity: number;
  fps: FpsOption;
  waveformLayout: WaveformLayoutConfig;
  audioError: string | null;
  onSelectDemoArtwork: (id: string) => void;
  onUploadImage: (file: File) => void;
  onUseDemoAudio: () => void;
  onUploadAudio: (file: File) => void;
  onChangeRatio: (ratio: AspectRatioKey) => void;
  onChangeFitMode: (fit: FitMode) => void;
  onChangeStyle: (style: WaveformStyle) => void;
  onChangeTheme: (theme: ColorThemeKey) => void;
  onChangeColorMix: (next: WaveformColorMix) => void;
  onChangeBassIntensity: (val: number) => void;
  onChangeFps: (fps: FpsOption) => void;
  onChangeWaveformLayout: (next: WaveformLayoutConfig) => void;
  onResetWaveformLayout: () => void;
  children?: React.ReactNode;
}

export const ControlRail: React.FC<ControlRailProps> = ({
  selectedArtworkId,
  customImageName,
  audioName,
  isDemoAudio,
  ratio,
  fitMode,
  style,
  theme,
  colorMix,
  bassIntensity,
  fps,
  waveformLayout,
  audioError,
  onSelectDemoArtwork,
  onUploadImage,
  onUseDemoAudio,
  onUploadAudio,
  onChangeRatio,
  onChangeFitMode,
  onChangeStyle,
  onChangeTheme,
  onChangeColorMix,
  onChangeBassIntensity,
  onChangeFps,
  onChangeWaveformLayout,
  onResetWaveformLayout,
  children,
}) => {
  const imgInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const updateLayout = (patch: Partial<WaveformLayoutConfig>) => {
    onChangeWaveformLayout(clampWaveformLayout({ ...waveformLayout, ...patch }));
  };

  return (
    <aside
      aria-label="แผงควบคุมพารามิเตอร์เรนเดอร์"
      className="bg-[#111827] border border-slate-800 rounded-xl p-3.5 lg:p-4 flex flex-col gap-2.5 lg:h-full lg:overflow-y-auto lg:justify-between"
    >
      {/* 1. Media Inputs */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-100">
            1. สื่อต้นฉบับ (ภาพและเสียง)
          </h2>
          <button
            type="button"
            onClick={() => imgInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded px-1.5 py-0.5"
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>อัปโหลดรูปภาพ</span>
          </button>
          <input
            ref={imgInputRef}
            type="file"
            aria-label="อัปโหลดไฟล์รูปภาพ"
            accept={SUPPORTED_IMAGE_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadImage(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className={`grid gap-1.5 ${DEMO_ARTWORKS.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
          {DEMO_ARTWORKS.map((art) => {
            const active = selectedArtworkId === art.id;
            return (
              <button
                key={art.id}
                type="button"
                onClick={() => onSelectDemoArtwork(art.id)}
                className={`group relative rounded-lg overflow-hidden border text-left transition-all flex items-center gap-2 p-1.5 bg-[#0D1320] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 ring-1 ring-sky-400/40'
                    : 'border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="w-11 h-8 rounded bg-slate-900 overflow-hidden shrink-0">
                  <img
                    src={art.src}
                    alt={art.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-slate-200 truncate">
                    {art.title}
                  </p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {art.aspectHint}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 bg-[#0D1320] hover:bg-slate-800/80 text-xs font-medium text-slate-100 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
            <span className="truncate">เลือกไฟล์เสียง (.mp3, .wav, .flac...)</span>
          </button>
          <button
            type="button"
            onClick={onUseDemoAudio}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              isDemoAudio
                ? 'border-sky-400/70 bg-sky-500/15 text-sky-200'
                : 'border-slate-700 hover:border-slate-500 text-slate-300'
            }`}
          >
            <Music2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>เพลงตัวอย่าง</span>
          </button>
          <input
            ref={audioInputRef}
            type="file"
            aria-label="อัปโหลดไฟล์เสียง"
            accept={SUPPORTED_AUDIO_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadAudio(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <p className="truncate">
            เสียงปัจจุบัน: <span className="text-slate-200">{audioName}</span>
          </p>
          {customImageName && (
            <p className="text-sky-300 truncate shrink-0 max-w-[180px]">
              ภาพ: {customImageName}
            </p>
          )}
        </div>
        <p className="text-[11px] text-slate-400">ถอดรหัสเสียงในเบราว์เซอร์โดยตรง รูปแบบที่ใช้ได้ขึ้นกับเบราว์เซอร์ แนะนำ MP3 หรือ WAV PCM</p>

        {audioError && (
          <p role="alert" className="text-xs text-rose-400">
            {audioError}
          </p>
        )}
      </div>

      {children && (
        <>
          <hr className="border-slate-800/80" />
          {children}
        </>
      )}

      <hr className="border-slate-800/80" />

      {/* 2. Aspect Ratio & Fit Mode */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-100 whitespace-nowrap">
            2. อัตราส่วนภาพ (1080p) และโหมดจัดวาง
          </h2>
          <span className="text-[11px] text-slate-400 truncate hidden sm:inline">
            {ASPECT_RATIOS[ratio].usage}
          </span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
          {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((key) => {
            const active = ratio === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChangeRatio(key)}
                aria-pressed={active}
                className={`px-1.5 py-1.5 rounded-lg border text-xs font-mono font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                {key}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {FIT_MODES.map((m) => {
            const active = fitMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onChangeFitMode(m.key)}
                aria-pressed={active}
                className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="text-xs font-semibold truncate">{m.label}</span>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">{m.key}</span>
              </button>
            );
          })}
        </div>
      </div>

      <hr className="border-slate-800/80" />

      {/* 3. Waveform Style (15 styles) & Color Theme */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-100">
            3. รูปแบบคลื่นเสียง (15 แบบ) และโทนสี
          </h2>
          <span className="text-[11px] font-mono text-slate-400">{style}</span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
          {WAVEFORM_STYLES.map((item) => {
            const active = style === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onChangeStyle(item.key)}
                aria-pressed={active}
                title={`${item.label} (${item.key}) — ${item.description}`}
                className={`px-1.5 py-1.5 rounded-md border text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-[11px] font-medium truncate">{item.label}</div>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(Object.keys(COLOR_THEMES) as ColorThemeKey[]).map((key) => {
            const item = COLOR_THEMES[key];
            const active = theme === key;
            const c1 = `rgb(${item.c1Rgb.join(',')})`;
            const cMid = `rgb(${item.cMidRgb.join(',')})`;
            const c2 = `rgb(${item.c2Rgb.join(',')})`;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChangeTheme(key)}
                aria-pressed={active}
                title={item.description}
                className={`px-2 py-1.5 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="w-3.5 h-2.5 rounded-xs shrink-0"
                    style={{ background: `linear-gradient(90deg, ${c1}, ${cMid}, ${c2})` }}
                  />
                  <span className="text-[11px] font-semibold truncate">{item.label}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 3-Color Custom Mixer */}
        <div className="mt-1 rounded-lg border border-slate-800 bg-[#0D1320] p-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-200">
              มิกซ์สีคลื่นเอง (ผสม 3 สี)
            </span>
            <button
              type="button"
              onClick={() => onChangeColorMix(getThemeColorMix(theme))}
              className="text-[10px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
            >
              รีเซ็ตตามธีม
            </button>
          </div>

          <div
            aria-hidden="true"
            className="h-2 w-full rounded-full border border-slate-700/80"
            style={{
              background: `linear-gradient(90deg, ${colorMix.c1} 0%, ${colorMix.c2} 50%, ${colorMix.c3} 100%)`,
            }}
          />

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { slot: 'c1', label: 'สีที่ 1 (ต้น)', val: colorMix.c1 },
                { slot: 'c2', label: 'สีที่ 2 (กลาง)', val: colorMix.c2 },
                { slot: 'c3', label: 'สีที่ 3 (ปลาย)', val: colorMix.c3 },
              ] as const
            ).map(({ slot, label, val }) => (
              <label
                key={slot}
                className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#090D16] px-2 py-1 cursor-pointer hover:border-slate-600 transition-colors"
              >
                <input
                  type="color"
                  aria-label={label}
                  value={val}
                  onChange={(e) =>
                    onChangeColorMix({
                      ...colorMix,
                      [slot]: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium text-slate-300 truncate">{label}</div>
                  <div className="text-[9px] font-mono text-slate-400 uppercase truncate">{val}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <hr className="border-slate-800/80" />

      {/* 4. Waveform Position, Scale & Opacity */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-100">
            4. ตำแหน่ง ขนาด และความโปร่งใสคลื่นเสียง
          </h2>
          <button
            type="button"
            onClick={onResetWaveformLayout}
            className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded px-1.5 py-0.5"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>รีเซ็ตค่าเริ่มต้น</span>
          </button>
        </div>

        {/* Quick vertical position presets */}
        <div className={`grid gap-1.5 ${DEMO_ARTWORKS.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
          <button
            type="button"
            onClick={() => updateLayout({ posX: 0.5, posY: 0.2 })}
            className="px-2 py-1 rounded-md border border-slate-800 bg-[#0D1320] hover:border-slate-600 text-[11px] text-slate-200 whitespace-nowrap transition-colors"
          >
            ด้านบน (20%)
          </button>
          <button
            type="button"
            onClick={() => updateLayout({ posX: 0.5, posY: 0.5 })}
            className="px-2 py-1 rounded-md border border-slate-800 bg-[#0D1320] hover:border-slate-600 text-[11px] text-slate-200 whitespace-nowrap transition-colors"
          >
            กึ่งกลาง (50%)
          </button>
          <button
            type="button"
            onClick={() => updateLayout({ posX: 0.5, posY: 0.82 })}
            className="px-2 py-1 rounded-md border border-slate-800 bg-[#0D1320] hover:border-slate-600 text-[11px] text-slate-200 whitespace-nowrap transition-colors"
          >
            ด้านล่าง (82%)
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="wf-pos-x" className="text-slate-300">
                ตำแหน่ง X
              </label>
              <span className="font-mono tabular-nums text-sky-300">
                {Math.round(waveformLayout.posX * 100)}%
              </span>
            </div>
            <input
              id="wf-pos-x"
              type="range"
              min={0.1}
              max={0.9}
              step={0.01}
              value={waveformLayout.posX}
              onChange={(e) => updateLayout({ posX: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
            />
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="wf-pos-y" className="text-slate-300">
                ตำแหน่ง Y
              </label>
              <span className="font-mono tabular-nums text-sky-300">
                {Math.round(waveformLayout.posY * 100)}%
              </span>
            </div>
            <input
              id="wf-pos-y"
              type="range"
              min={0.1}
              max={0.9}
              step={0.01}
              value={waveformLayout.posY}
              onChange={(e) => updateLayout({ posY: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
            />
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="wf-scale" className="text-slate-300">
                ขนาดคลื่น
              </label>
              <span className="font-mono tabular-nums text-sky-300">
                {waveformLayout.scale.toFixed(2)}x
              </span>
            </div>
            <input
              id="wf-scale"
              type="range"
              min={0.4}
              max={2.0}
              step={0.05}
              value={waveformLayout.scale}
              onChange={(e) => updateLayout({ scale: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
            />
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="wf-opacity" className="text-slate-300">
                ความโปร่งใส
              </label>
              <span className="font-mono tabular-nums text-sky-300">
                {Math.round(waveformLayout.opacity * 100)}%
              </span>
            </div>
            <input
              id="wf-opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={waveformLayout.opacity}
              onChange={(e) => updateLayout({ opacity: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
            />
          </div>
        </div>
      </div>

      <hr className="border-slate-800/80" />

      {/* 5. Bass Intensity & FPS */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-100">
            5. แรงกระตุกเบส (20–150Hz) และ FPS
          </h2>
          <span
            data-testid="bass-intensity-value"
            className="text-xs font-mono tabular-nums text-sky-300"
          >
            {bassIntensity.toFixed(2)}x
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <label htmlFor="bass-intensity-slider" className="sr-only">
            ปรับความแรงการกระตุกตามเบสแบบละเอียด
          </label>
          <input
            id="bass-intensity-slider"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={bassIntensity}
            onChange={(e) => onChangeBassIntensity(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500">
            <span>0.00x (นิ่ง)</span>
            <span>0.25x (นุ่มนวล)</span>
            <span>1.00x</span>
            <span>2.00x (แรงสุด)</span>
          </div>
        </div>

        <div className={`grid gap-1.5 ${DEMO_ARTWORKS.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
          {BASS_INTENSITY_PRESETS.map((preset) => {
            const active = Math.abs(bassIntensity - preset.value) < 0.025;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => onChangeBassIntensity(preset.value)}
                aria-pressed={active}
                className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {([30, 60] as FpsOption[]).map((f) => {
            const active = fps === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onChangeFps(f)}
                aria-pressed={active}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                {f} FPS {f === 30 ? '(มาตรฐาน)' : '(ลื่นพิเศษ)'}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
