import React from 'react';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  COLOR_THEMES,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformStyle,
} from '../engine/presets';

interface StudioStageProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  theme: ColorThemeKey;
  fps: FpsOption;
  bassIntensity: number;
  isPlaying: boolean;
  isMuted: boolean;
  isAnalyzing: boolean;
  audioName: string;
  currentTime: number;
  duration: number;
  currentBassVal: number;
  totalFrames: number;
  peakBassFrames: number;
  onTogglePlay: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onSeek: (timeSec: number) => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const StudioStage: React.FC<StudioStageProps> = ({
  canvasRef,
  ratio,
  fitMode,
  style,
  theme,
  fps,
  bassIntensity,
  isPlaying,
  isMuted,
  isAnalyzing,
  audioName,
  currentTime,
  duration,
  currentBassVal,
  totalFrames,
  peakBassFrames,
  onTogglePlay,
  onRestart,
  onToggleMute,
  onSeek,
}) => {
  const ratioSpec = ASPECT_RATIOS[ratio];
  const themeSpec = COLOR_THEMES[theme];
  const zoomFactor = 1.0 + currentBassVal * 0.1 * bassIntensity;
  const isShakeActive = currentBassVal > 0.45;

  return (
    <section
      aria-label="พื้นที่แสดงผลวิดีโอสด"
      className="flex flex-col gap-4 bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5"
    >
      {/* Stage Top Metadata Strip (unboxed text with typographic separators) */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 border-b border-slate-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-100 font-semibold">{ratioSpec.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-slate-300">
            {ratioSpec.width} × {ratioSpec.height} px
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{fps} FPS</span>
          <span aria-hidden="true">·</span>
          <span>โหมด {fitMode === 'cover' ? 'Cover เต็มกรอบ' : 'Blur Pad ภาพเต็มใบ'}</span>
        </div>

        <div className="flex items-center gap-2">
          <span>{themeSpec.label}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate max-w-[200px]" title={audioName}>
            {audioName}
          </span>
        </div>
      </div>

      {/* Main Canvas Stage Container */}
      <div className="relative w-full rounded-lg bg-[#070A12] border border-slate-800/90 flex items-center justify-center p-3 sm:p-5 min-h-[280px] lg:min-h-[500px]">
        {isAnalyzing && (
          <div className="absolute inset-0 z-10 bg-[#070A12]/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 rounded-lg">
            <div className="w-7 h-7 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
            <p className="text-sm text-slate-200 font-medium">
              กำลังวิเคราะห์ย่านเบส 20–150 Hz และสเปกตรัม 64 ย่าน...
            </p>
          </div>
        )}

        <div
          className="relative flex items-center justify-center overflow-hidden rounded-md shadow-2xl border border-slate-800/70 bg-black"
          style={{
            aspectRatio: `${ratioSpec.width} / ${ratioSpec.height}`,
            maxHeight: 'min(520px, 52vh)',
            maxWidth: '100%',
            width: ratioSpec.width >= ratioSpec.height ? '100%' : 'auto',
            height: ratioSpec.width < ratioSpec.height ? 'min(520px, 52vh)' : 'auto',
          }}
        >
          <canvas
            ref={canvasRef}
            data-testid="studio-canvas"
            data-ratio={ratio}
            data-style={style}
            data-theme={theme}
            data-fit={fitMode}
            data-playing={isPlaying ? 'true' : 'false'}
            className="w-full h-full block object-contain"
          />
        </div>
      </div>

      {/* Transport & Real-Time DSP Telemetry Strip */}
      <div className="flex flex-col gap-3 pt-1">
        {/* Timeline Scrub Bar */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-slate-300 w-11 shrink-0">
            {formatTime(currentTime)}
          </span>
          <label htmlFor="timeline-scrubber" className="sr-only">
            เลื่อนตำแหน่งเวลาเพลง
          </label>
          <input
            id="timeline-scrubber"
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={0.05}
            value={Math.min(currentTime, duration)}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          />
          <span className="font-mono text-xs tabular-nums text-slate-400 w-11 text-right shrink-0">
            {formatTime(duration)}
          </span>
        </div>

        {/* Play Controls + Live DSP Physics Readout */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={isAnalyzing || duration <= 0}
              aria-label={isPlaying ? 'หยุดเล่นชั่วคราว' : 'เล่นพรีวิว'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-white disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
                  <span>หยุดชั่วคราว</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  <span>เล่นพรีวิว</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onRestart}
              disabled={isAnalyzing || duration <= 0}
              aria-label="เริ่มเล่นใหม่จากวินาทีที่ 0"
              className="p-2.5 rounded-lg border border-slate-700 hover:border-slate-600 hover:bg-slate-800 text-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              aria-label={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
              className="p-2.5 rounded-lg border border-slate-700 hover:border-slate-600 hover:bg-slate-800 text-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4 text-amber-400" aria-hidden="true" />
              ) : (
                <Volume2 className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Live Bass-Sync Readout (driven by real analyzed DSP envelope) */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span>แรงเบส 20–150Hz:</span>
              <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-400 transition-transform duration-75 origin-left"
                  style={{ transform: `scaleX(${Math.min(1, currentBassVal)})` }}
                />
              </div>
              <span
                data-testid="bass-energy-readout"
                className="font-mono tabular-nums text-slate-200 w-10 text-right"
              >
                {Math.round(currentBassVal * 100)}%
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-2 font-mono tabular-nums text-slate-300">
              <span>Zoom {zoomFactor.toFixed(2)}x</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className={isShakeActive ? 'text-amber-300' : 'text-slate-400'}>
                {isShakeActive ? 'Shake พีค' : 'Shake ปกติ'}
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>{totalFrames} เฟรม ({peakBassFrames} พีค)</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
