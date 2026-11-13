import React, { useRef } from 'react';
import { ImagePlus, Music2, Upload } from 'lucide-react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  BASS_INTENSITY_PRESETS,
  COLOR_THEMES,
  ColorThemeKey,
  DEMO_ARTWORKS,
  FIT_MODES,
  FitMode,
  FpsOption,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  WAVEFORM_STYLES,
  WaveformStyle,
} from '../engine/presets';

interface ControlRailProps {
  selectedArtworkId: string;
  customImageName: string | null;
  audioName: string;
  isDemoAudio: boolean;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  theme: ColorThemeKey;
  bassIntensity: number;
  fps: FpsOption;
  audioError: string | null;
  onSelectDemoArtwork: (id: string) => void;
  onUploadImage: (file: File) => void;
  onUseDemoAudio: () => void;
  onUploadAudio: (file: File) => void;
  onChangeRatio: (ratio: AspectRatioKey) => void;
  onChangeFitMode: (fit: FitMode) => void;
  onChangeStyle: (style: WaveformStyle) => void;
  onChangeTheme: (theme: ColorThemeKey) => void;
  onChangeBassIntensity: (val: number) => void;
  onChangeFps: (fps: FpsOption) => void;
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
  bassIntensity,
  fps,
  audioError,
  onSelectDemoArtwork,
  onUploadImage,
  onUseDemoAudio,
  onUploadAudio,
  onChangeRatio,
  onChangeFitMode,
  onChangeStyle,
  onChangeTheme,
  onChangeBassIntensity,
  onChangeFps,
}) => {
  const imgInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  return (
    <aside
      aria-label="แผงควบคุมพารามิเตอร์เรนเดอร์"
      className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-6"
    >
      {/* 1. Media Inputs */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">
            1. สื่อต้นฉบับ (ภาพและเสียง)
          </h2>
          <button
            type="button"
            onClick={() => imgInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded px-1.5 py-1"
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>อัปโหลดรูปภาพ</span>
          </button>
          <input
            ref={imgInputRef}
            type="file"
            accept={SUPPORTED_IMAGE_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadImage(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Built-in Artworks + Custom Image indicator */}
        <div className="grid grid-cols-3 gap-2">
          {DEMO_ARTWORKS.map((art) => {
            const active = selectedArtworkId === art.id;
            return (
              <button
                key={art.id}
                type="button"
                onClick={() => onSelectDemoArtwork(art.id)}
                className={`group relative rounded-lg overflow-hidden border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 ring-1 ring-sky-400/40'
                    : 'border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="aspect-video w-full bg-slate-900 overflow-hidden">
                  <img
                    src={art.src}
                    alt={art.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
                <div className="px-2 py-1.5 bg-[#0D1320]">
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

        {customImageName && (
          <p className="text-xs text-sky-300 truncate">
            ภาพที่อัปโหลด: {customImageName}
          </p>
        )}

        {/* Audio File Picker */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-500 bg-[#0D1320] hover:bg-slate-800/80 text-xs font-medium text-slate-100 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
            <span className="truncate">เลือกไฟล์เสียง (.mp3, .wav, .flac...)</span>
          </button>
          <button
            type="button"
            onClick={onUseDemoAudio}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
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
            accept={SUPPORTED_AUDIO_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadAudio(f);
              e.target.value = '';
            }}
          />
        </div>

        <p className="text-xs text-slate-400 truncate">
          เสียงปัจจุบัน: <span className="text-slate-200">{audioName}</span>
        </p>

        {audioError && (
          <p role="alert" className="text-xs text-rose-400">
            {audioError}
          </p>
        )}
      </div>

      <hr className="border-slate-800/80" />

      {/* 2. Aspect Ratio & Fit Mode */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-100">
          2. อัตราส่วนภาพ (1080p Full HD) และโหมดจัดวาง
        </h2>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((key) => {
            const active = ratio === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChangeRatio(key)}
                aria-pressed={active}
                className={`px-2 py-2 rounded-lg border text-xs font-mono font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
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
        <p className="text-xs text-slate-400">
          {ASPECT_RATIOS[ratio].usage}
        </p>

        <div className="grid grid-cols-2 gap-2 pt-1">
          {FIT_MODES.map((m) => {
            const active = fitMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onChangeFitMode(m.key)}
                aria-pressed={active}
                className={`px-3 py-2 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-semibold whitespace-nowrap">{m.label}</div>
                <div className="text-[11px] text-slate-400 truncate">{m.key}</div>
              </button>
            );
          })}
        </div>
      </div>

      <hr className="border-slate-800/80" />

      {/* 3. Waveform Style & Color Theme */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-100">
          3. รูปแบบคลื่นเสียงและโทนสี Neon Bloom
        </h2>
        <div className="grid grid-cols-1 gap-1.5">
          {WAVEFORM_STYLES.map((item) => {
            const active = style === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onChangeStyle(item.key)}
                aria-pressed={active}
                className={`px-3 py-2 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold whitespace-nowrap">{item.label}</span>
                  <span className="text-[11px] font-mono text-slate-400">{item.key}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{item.description}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          {(Object.keys(COLOR_THEMES) as ColorThemeKey[]).map((key) => {
            const item = COLOR_THEMES[key];
            const active = theme === key;
            const c1 = `rgb(${item.c1Rgb.join(',')})`;
            const c2 = `rgb(${item.c2Rgb.join(',')})`;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChangeTheme(key)}
                aria-pressed={active}
                className={`px-3 py-2 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="w-4 h-2.5 rounded-xs shrink-0"
                    style={{ background: `linear-gradient(90deg, ${c1}, ${c2})` }}
                  />
                  <span className="text-xs font-semibold whitespace-nowrap">{item.label}</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <hr className="border-slate-800/80" />

      {/* 4. Bass Intensity & FPS */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">
            4. แรงกระตุกเบส (20–150Hz) และ FPS
          </h2>
          <span className="text-xs font-mono tabular-nums text-sky-300">
            {bassIntensity.toFixed(1)}x
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {BASS_INTENSITY_PRESETS.map((preset) => {
            const active = Math.abs(bassIntensity - preset.value) < 0.05;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => onChangeBassIntensity(preset.value)}
                aria-pressed={active}
                className={`px-2 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
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

        <div className="grid grid-cols-2 gap-2 pt-1">
          {([30, 60] as FpsOption[]).map((f) => {
            const active = fps === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onChangeFps(f)}
                aria-pressed={active}
                className={`px-3 py-2 rounded-lg border text-xs font-mono font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
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
