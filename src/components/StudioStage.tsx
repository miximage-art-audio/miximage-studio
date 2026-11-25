import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  COLOR_THEMES,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformLayoutConfig,
  WaveformStyle,
  clampWaveformLayout,
} from '../engine/presets';

interface StudioStageProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  showWaveform?: boolean;
  theme: ColorThemeKey;
  fps: FpsOption;
  bassIntensity: number;
  waveformLayout: WaveformLayoutConfig;
  isPlaying: boolean;
  isMuted: boolean;
  isAnalyzing: boolean;
  audioName: string;
  currentTime: number;
  duration: number;
  currentBassVal: number;
  currentOnsetFlux?: number;
  totalFrames: number;
  peakBassFrames: number;
  onTogglePlay: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onSeek: (timeSec: number) => void;
  onChangeWaveformLayout: (next: WaveformLayoutConfig) => void;
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
  showWaveform = true,
  theme,
  fps,
  bassIntensity,
  waveformLayout,
  isPlaying,
  isMuted,
  isAnalyzing,
  audioName,
  currentTime,
  duration,
  currentBassVal,
  currentOnsetFlux = 0,
  totalFrames,
  peakBassFrames,
  onTogglePlay,
  onRestart,
  onToggleMute,
  onSeek,
  onChangeWaveformLayout,
}) => {
  const ratioSpec = ASPECT_RATIOS[ratio];
  const themeSpec = COLOR_THEMES[theme];
  const zoomFactor = 1.0 + currentOnsetFlux * 0.12 * bassIntensity;
  const isShakeActive = currentOnsetFlux > 0.18;

  const [isDragging, setIsDragging] = useState(false);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const [stageBoxSize, setStageBoxSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  useEffect(() => {
    const el = stageBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setStageBoxSize({
        w: Math.max(0, Math.floor(rect.width)),
        h: Math.max(0, Math.floor(rect.height)),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startPosX: number;
    startPosY: number;
    rectW: number;
    rectH: number;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    canvas.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startPosX: waveformLayout.posX,
      startPosY: waveformLayout.posY,
      rectW: rect.width,
      rectH: rect.height,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStartRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.clientX) / drag.rectW;
    const dy = (e.clientY - drag.clientY) / drag.rectH;
    onChangeWaveformLayout(
      clampWaveformLayout({
        ...waveformLayout,
        posX: drag.startPosX + dx,
        posY: drag.startPosY + dy,
      })
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragStartRef.current && canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    dragStartRef.current = null;
    setIsDragging(false);
  };

  // Fit the active aspect ratio exactly inside the measured stage box without overflowing
  const targetRatio = ratioSpec.width / ratioSpec.height;
  let fittedBoxStyle: React.CSSProperties = {
    aspectRatio: `${ratioSpec.width} / ${ratioSpec.height}`,
    maxHeight: 'min(480px, 50vh)',
    maxWidth: '100%',
    width: ratioSpec.width >= ratioSpec.height ? '100%' : 'auto',
    height: ratioSpec.width < ratioSpec.height ? 'min(480px, 50vh)' : 'auto',
  };

  if (stageBoxSize.w > 40 && stageBoxSize.h > 40) {
    let w = stageBoxSize.w;
    let h = w / targetRatio;
    if (h > stageBoxSize.h) {
      h = stageBoxSize.h;
      w = h * targetRatio;
    }
    fittedBoxStyle = {
      width: `${Math.floor(w)}px`,
      height: `${Math.floor(h)}px`,
    };
  }

  return (
    <section
      aria-label="พื้นที่แสดงผลวิดีโอสด"
      className="flex flex-col gap-2.5 lg:gap-3 bg-[#111827] border border-slate-800 rounded-xl p-3 sm:p-4 lg:h-full min-h-0"
    >
      {/* Stage Top Metadata Strip (unboxed text with typographic separators) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 border-b border-slate-800/80 pb-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-100 font-semibold">{ratioSpec.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-slate-300">
            {ratioSpec.width} × {ratioSpec.height} px
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{fps} FPS</span>
          <span aria-hidden="true">·</span>
          <span>
            โหมด{' '}
            {fitMode === 'center'
              ? 'วางกึ่งกลางพอดี'
              : fitMode === 'cover'
                ? 'Cover เต็มกรอบ'
                : 'Blur Pad ภาพเต็มใบ'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span>{themeSpec.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-slate-300">
            ตำแหน่ง {Math.round(waveformLayout.posX * 100)}%, {Math.round(waveformLayout.posY * 100)}%
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate max-w-[160px]" title={audioName}>
            {audioName}
          </span>
        </div>
      </div>

      {/* Main Canvas Stage Container */}
      <div className="relative w-full rounded-lg bg-[#070A12] border border-slate-800/90 flex flex-col items-center justify-center p-2.5 sm:p-3 min-h-[250px] lg:min-h-0 lg:flex-1 gap-1.5 overflow-hidden">
        {isAnalyzing && (
          <div className="absolute inset-0 z-10 bg-[#070A12]/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 rounded-lg">
            <div className="w-7 h-7 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
            <p className="text-sm text-slate-200 font-medium">
              กำลังวิเคราะห์ย่านเบส 20–150 Hz และสเปกตรัม 64 ย่าน...
            </p>
          </div>
        )}

        <div
          ref={stageBoxRef}
          className="w-full flex-1 min-h-[210px] lg:min-h-0 flex items-center justify-center overflow-hidden"
        >
          <div
            className="relative flex items-center justify-center overflow-hidden rounded-md shadow-2xl border border-slate-800/70 bg-black"
            style={fittedBoxStyle}
          >
            <canvas
              ref={canvasRef}
              data-testid="studio-canvas"
              data-ratio={ratio}
              data-style={style}
              data-theme={theme}
              data-fit={fitMode}
              data-pos-x={waveformLayout.posX.toFixed(2)}
              data-pos-y={waveformLayout.posY.toFixed(2)}
              data-scale={waveformLayout.scale.toFixed(2)}
              data-opacity={waveformLayout.opacity.toFixed(2)}
              data-playing={isPlaying ? 'true' : 'false'}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              title="ลากบนภาพเพื่อย้ายตำแหน่งคลื่นเสียง"
              className={`w-full h-full block object-contain touch-none select-none ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            />
          </div>
        </div>

        {showWaveform === false ? (
          <div className="text-[11px] text-amber-300/90 bg-amber-950/20 border border-amber-900/30 rounded px-2.5 py-1 shrink-0 flex items-center justify-between gap-2">
            <span>✕ ปิดคลื่นเสียงอยู่ (เน้นเฉพาะภาพพื้นหลัง)</span>
            <span className="font-mono text-slate-400">
              กระตุกตามเบส: {bassIntensity > 0 ? `${bassIntensity.toFixed(1)}x` : 'ปิดสั่น'}
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 shrink-0">
            ลากเมาส์หรือนิ้วบนภาพพรีวิวเพื่อย้ายตำแหน่งคลื่นเสียงได้ทันที · ขนาด{' '}
            <span className="font-mono tabular-nums text-slate-400">
              {waveformLayout.scale.toFixed(2)}x
            </span>{' '}
            · โปร่งใส{' '}
            <span className="font-mono tabular-nums text-slate-400">
              {Math.round(waveformLayout.opacity * 100)}%
            </span>{' '}
            · กระตุกเบส:{' '}
            <span className="font-mono tabular-nums text-slate-400">
              {bassIntensity > 0 ? `${bassIntensity.toFixed(1)}x` : 'ปิดสั่น'}
            </span>
          </p>
        )}
      </div>

      {/* Transport & Real-Time DSP Telemetry Strip */}
      <div className="flex flex-col gap-2 pt-0.5 shrink-0">
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
