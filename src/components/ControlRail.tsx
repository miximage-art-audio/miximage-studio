import React, { useRef } from 'react';
import { Activity, Clock, EyeOff, ImagePlus, Music2, RotateCcw, Sliders, Sparkles, Upload } from 'lucide-react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  BASS_INTENSITY_PRESETS,
  COLOR_THEMES,
  ColorThemeKey,
  ColorThemeSpec,
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
  formatTime,
  getThemeColorMix,
} from '../engine/presets';
import { DEMO_ARTWORKS } from '../engine/demoArtworks';

interface ControlRailProps {
  selectedArtworkId: string;
  customImageName: string | null;
  customDuration: number | null;
  audioName: string;
  isDemoAudio: boolean;
  songDuration?: number;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  showWaveform: boolean;
  theme: ColorThemeKey;
  colorMix: WaveformColorMix;
  bassIntensity: number;
  fps: FpsOption;
  waveformLayout: WaveformLayoutConfig;
  audioError: string | null;
  onSelectDemoArtwork: (id: string) => void;
  onUploadImage: (file: File) => void;
  onChangeCustomDuration: (dur: number | null) => void;
  onUseDemoAudio: () => void;
  onUploadAudio: (file: File) => void;
  onChangeRatio: (ratio: AspectRatioKey) => void;
  onChangeFitMode: (fit: FitMode) => void;
  onChangeStyle: (style: WaveformStyle) => void;
  onChangeShowWaveform: (show: boolean) => void;
  onChangeTheme: (theme: ColorThemeKey) => void;
  onChangeColorMix: (next: WaveformColorMix) => void;
  onChangeBassIntensity: (val: number) => void;
  onChangeFps: (fps: FpsOption) => void;
  onChangeWaveformLayout: (next: WaveformLayoutConfig) => void;
  onResetWaveformLayout: () => void;
  children?: React.ReactNode;
}

const ALL_THEME_LIST = Object.values(COLOR_THEMES) as ColorThemeSpec[];
const CLASSIC_THEMES = ALL_THEME_LIST.filter((t) => t.category === 'classic');
const TWOTONE_THEMES = ALL_THEME_LIST.filter((t) => t.category === 'twotone');
const GRADIENT_THEMES = ALL_THEME_LIST.filter((t) => t.category === 'gradient');

export const ControlRail: React.FC<ControlRailProps> = ({
  selectedArtworkId,
  customImageName,
  customDuration,
  audioName,
  isDemoAudio,
  songDuration = 16,
  ratio,
  fitMode,
  style,
  showWaveform,
  theme,
  colorMix,
  bassIntensity,
  fps,
  waveformLayout,
  audioError,
  onSelectDemoArtwork,
  onUploadImage,
  onChangeCustomDuration,
  onUseDemoAudio,
  onUploadAudio,
  onChangeRatio,
  onChangeFitMode,
  onChangeStyle,
  onChangeShowWaveform,
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
  const lastNonZeroBassRef = useRef<number>(bassIntensity > 0 ? bassIntensity : 1.0);

  const updateLayout = (patch: Partial<WaveformLayoutConfig>) => {
    onChangeWaveformLayout(clampWaveformLayout({ ...waveformLayout, ...patch }));
  };

  const targetSongDur = songDuration > 0 ? songDuration : 16;
  const activeDuration =
    customDuration !== null && customDuration > 0
      ? Math.max(1, Math.min(customDuration, targetSongDur))
      : targetSongDur;

  const renderThemeButtons = (items: ColorThemeSpec[], isTwoTone = false) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {items.map((item) => {
        const active = theme === item.key;
        const c1 = `rgb(${item.c1Rgb.join(',')})`;
        const cMid = `rgb(${item.cMidRgb.join(',')})`;
        const c2 = `rgb(${item.c2Rgb.join(',')})`;
        const swatchBg = isTwoTone
          ? `linear-gradient(90deg, ${c1} 0%, ${c1} 48%, ${c2} 52%, ${c2} 100%)`
          : `linear-gradient(90deg, ${c1}, ${cMid}, ${c2})`;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChangeTheme(item.key)}
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
                className="w-4 h-2.5 rounded-xs shrink-0 border border-white/10"
                style={{ background: swatchBg }}
              />
              <span className="text-[11px] font-semibold truncate">{item.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <aside
      aria-label="แผงควบคุมพารามิเตอร์เรนเดอร์"
      className="bg-[#111827] border border-slate-800 rounded-xl p-3.5 lg:p-4 flex flex-col gap-2.5 lg:h-full lg:overflow-y-auto lg:justify-between"
    >
      {/* 1. Media Inputs (Image & Audio ONLY) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-100">
            1. สื่อต้นฉบับ (รูปภาพ และไฟล์เสียง)
          </h2>
          <button
            type="button"
            onClick={() => imgInputRef.current?.click()}
            className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded px-2 py-0.5 border border-sky-500/30 bg-sky-500/10"
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>เลือกรูปภาพ (.png, .jpg)</span>
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

        <div className="grid grid-cols-1 gap-1.5">
          {DEMO_ARTWORKS.map((art) => {
            const active = selectedArtworkId === art.id;
            return (
              <button
                key={art.id}
                type="button"
                onClick={() => onSelectDemoArtwork(art.id)}
                className={`group relative rounded-lg overflow-hidden border text-left transition-all flex items-center gap-2.5 p-1.5 bg-[#0D1320] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 ring-1 ring-sky-400/40'
                    : 'border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="w-11 h-9 rounded bg-[#070B14] border border-slate-800/80 overflow-hidden shrink-0 flex items-center justify-center p-1">
                  <img
                    src={art.src}
                    alt={art.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
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

        {/* Render Duration Control (Defaults to Full Song) */}
        <div className="bg-[#090D16] border border-emerald-500/40 rounded-lg p-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>ความยาวคลิปที่จะเรนเดอร์</span>
            </div>
            <span className="font-mono text-slate-300 font-semibold text-xs">
              {formatTime(activeDuration)} / {formatTime(targetSongDur)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onChangeCustomDuration(null)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                customDuration === null || Math.abs(activeDuration - targetSongDur) < 0.2
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              เต็มเพลง ({formatTime(targetSongDur)})
            </button>
            {targetSongDur > 15 && (
              <button
                type="button"
                onClick={() => onChangeCustomDuration(15)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                  Math.abs(activeDuration - 15) < 0.2
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                15 วิ (Shorts)
              </button>
            )}
            {targetSongDur > 30 && (
              <button
                type="button"
                onClick={() => onChangeCustomDuration(30)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                  Math.abs(activeDuration - 30) < 0.2
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                30 วิ (Reels/TikTok)
              </button>
            )}
            {targetSongDur > 60 && (
              <button
                type="button"
                onClick={() => onChangeCustomDuration(60)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                  Math.abs(activeDuration - 60) < 0.2
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                60 วิ (1 นาที)
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <label htmlFor="clip-duration-slider">ปรับความยาวเอง (วินาที):</label>
              <div className="flex items-center gap-1.5">
                <input
                  id="clip-duration-number"
                  type="number"
                  aria-label="กำหนดความยาวคลิปเป็นวินาที"
                  min={1}
                  max={Math.max(1, Number(targetSongDur.toFixed(1)))}
                  step={0.5}
                  value={Number(activeDuration.toFixed(1))}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v)) {
                      onChangeCustomDuration(Math.max(1, Math.min(v, targetSongDur)));
                    }
                  }}
                  className="w-16 px-1.5 py-0.5 rounded bg-[#0D1320] border border-slate-700 text-right font-mono text-emerald-300 text-[11px] focus:outline-none focus:border-emerald-400"
                />
                <span className="font-mono text-slate-400">วิ</span>
              </div>
            </div>
            <input
              id="clip-duration-slider"
              type="range"
              min={1}
              max={Math.max(1, targetSongDur)}
              step={0.5}
              value={activeDuration}
              onChange={(e) => onChangeCustomDuration(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
          </div>
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
            เสียง: <span className="text-slate-200">{audioName}</span>
          </p>
          {customImageName && (
            <p className="text-sky-300 truncate shrink-0 max-w-[180px]">
              ภาพ: {customImageName}
            </p>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          ถอดรหัสเสียงในเบราว์เซอร์โดยตรง รูปแบบที่ใช้ได้ขึ้นกับเบราว์เซอร์ แนะนำ MP3 หรือ WAV PCM
        </p>

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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          {FIT_MODES.map((m) => {
            const active = fitMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onChangeFitMode(m.key)}
                aria-pressed={active}
                title={m.description}
                className={`px-2 py-1.5 rounded-lg border flex items-center justify-between gap-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="text-[11px] font-semibold truncate">{m.label}</span>
                <span className="text-[9px] font-mono text-slate-400 shrink-0">{m.key}</span>
              </button>
            );
          })}
        </div>
      </div>

      <hr className="border-slate-800/80" />

      {/* 3. Waveform Style (20 styles incl. 5 DJ Smooth) & Color Themes */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-100">
            3. รูปแบบคลื่นเสียง ({WAVEFORM_STYLES.length} แบบ) และโทนสี
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            {showWaveform ? style : 'ไม่ใส่คลื่นเสียง (ปิด)'}
          </span>
        </div>

        {/* Toggle UI ใส่ หรือ ไม่ใส่ คลื่นเสียง */}
        <div className="grid grid-cols-2 p-1 bg-[#090D16] border border-slate-800 rounded-lg gap-1">
          <button
            type="button"
            onClick={() => onChangeShowWaveform(true)}
            aria-pressed={showWaveform}
            className={`py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              showWaveform
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
            <span>✓ ใส่คลื่นเสียง (เปิด)</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeShowWaveform(false)}
            aria-pressed={!showWaveform}
            className={`py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              !showWaveform
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
            <span>✕ ไม่ใส่คลื่นเสียง (ปิด)</span>
          </button>
        </div>

        {!showWaveform && (
          <div className="text-[11px] text-amber-300/90 bg-amber-950/20 border border-amber-900/30 rounded-lg p-2 leading-relaxed">
            ℹ️ <strong>กำลังปิดคลื่นเสียง:</strong> วิดีโอจะเน้นเฉพาะภาพพื้นหลัง (คลิกเลือกรูปแบบคลื่นด้านล่างเพื่อเปิดได้ทันที)
          </div>
        )}

        <div
          className={`grid grid-cols-3 sm:grid-cols-5 gap-1 transition-opacity ${
            !showWaveform ? 'opacity-50' : 'opacity-100'
          }`}
        >
          {WAVEFORM_STYLES.map((item) => {
            const active = showWaveform && style === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  onChangeShowWaveform(true);
                  onChangeStyle(item.key);
                }}
                aria-pressed={active}
                title={`${item.label} (${item.key}) — ${item.description}`}
                className={`px-1.5 py-1.5 rounded-md border text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                    : item.isDjSmooth
                      ? 'border-violet-500/35 bg-[#121629] text-violet-200 hover:border-violet-400'
                      : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-[11px] font-medium truncate">{item.label}</div>
              </button>
            );
          })}
        </div>

        {/* Preset Color Themes: Classic (4), Two-Tone (5), Gradient (5) */}
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              ชุดสีหลัก ({CLASSIC_THEMES.length} แบบ)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {CLASSIC_THEMES.map((item) => {
                const active = theme === item.key;
                const c1 = `rgb(${item.c1Rgb.join(',')})`;
                const cMid = `rgb(${item.cMidRgb.join(',')})`;
                const c2 = `rgb(${item.c2Rgb.join(',')})`;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onChangeTheme(item.key)}
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
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
              เฉดสีทูโทนสำเร็จรูป ({TWOTONE_THEMES.length} เฉด)
            </span>
            {renderThemeButtons(TWOTONE_THEMES, true)}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/90">
              เฉดสีไล่เฉดสำเร็จรูป ({GRADIENT_THEMES.length} เฉด)
            </span>
            {renderThemeButtons(GRADIENT_THEMES, false)}
          </div>
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
        <div className="grid grid-cols-3 gap-1.5">
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
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              <button
                type="button"
                onClick={() => updateLayout({ opacity: 1.0 })}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  Math.abs(waveformLayout.opacity - 1.0) < 0.05
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-400 hover:text-slate-200'
                }`}
              >
                ทึบ 100%
              </button>
              <button
                type="button"
                onClick={() => updateLayout({ opacity: 0.7 })}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  Math.abs(waveformLayout.opacity - 0.7) < 0.05
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-400 hover:text-slate-200'
                }`}
              >
                ใส 70%
              </button>
              <button
                type="button"
                onClick={() => updateLayout({ opacity: 0.4 })}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  Math.abs(waveformLayout.opacity - 0.4) < 0.05
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-400 hover:text-slate-200'
                }`}
              >
                ใส 40%
              </button>
              <button
                type="button"
                onClick={() => updateLayout({ opacity: 0.0 })}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  waveformLayout.opacity <= 0.05
                    ? 'border-rose-400 bg-rose-500/20 text-rose-200'
                    : 'border-slate-800 bg-[#0D1320] text-slate-400 hover:text-slate-200'
                }`}
              >
                ใส 0% (ซ่อน)
              </button>
            </div>
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
            {bassIntensity > 0 ? `${bassIntensity.toFixed(2)}x` : 'ไม่ใส่กระตุก (ปิด)'}
          </span>
        </div>

        {/* Toggle UI ใส่ หรือ ไม่ใส่ กระตุกตามเบส */}
        <div className="grid grid-cols-2 p-1 bg-[#090D16] border border-slate-800 rounded-lg gap-1">
          <button
            type="button"
            onClick={() => {
              if (bassIntensity === 0) {
                onChangeBassIntensity(lastNonZeroBassRef.current || 1.0);
              }
            }}
            aria-pressed={bassIntensity > 0}
            className={`py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              bassIntensity > 0
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>✓ ใส่กระตุกตามเบส (เปิด)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (bassIntensity > 0) {
                lastNonZeroBassRef.current = bassIntensity;
              }
              onChangeBassIntensity(0.0);
            }}
            aria-pressed={bassIntensity === 0}
            className={`py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              bassIntensity === 0
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
            <span>✕ ไม่ใส่กระตุก (ภาพนิ่ง 0.0x)</span>
          </button>
        </div>

        {bassIntensity === 0 ? (
          <div className="text-[11px] text-amber-300/90 bg-amber-950/20 border border-amber-900/30 rounded-lg p-2 leading-relaxed">
            ℹ️ <strong>ปิดแรงกระตุกเบสอยู่:</strong> ภาพพื้นหลังจะอยู่นิ่งสนิท ไม่มีการซูมหรือสั่นไหวตามจังหวะเบส
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <label htmlFor="bass-intensity-slider">
                ปรับความแรงการกระตุกตามเบส:
              </label>
              <span className="font-mono text-emerald-300 font-medium">
                {bassIntensity.toFixed(2)}x
              </span>
            </div>
            <input
              id="bass-intensity-slider"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={bassIntensity}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (val > 0) lastNonZeroBassRef.current = val;
                onChangeBassIntensity(val);
              }}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>0.00x (นิ่ง)</span>
              <span>0.25x (นุ่มนวล)</span>
              <span>1.00x (มาตรฐาน)</span>
              <span>2.00x (แรงสุด)</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {BASS_INTENSITY_PRESETS.map((preset) => {
            const active = Math.abs(bassIntensity - preset.value) < 0.025;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  if (preset.value > 0) lastNonZeroBassRef.current = preset.value;
                  onChangeBassIntensity(preset.value);
                }}
                aria-pressed={active}
                className={`px-1.5 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200 font-semibold shadow-sm'
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
