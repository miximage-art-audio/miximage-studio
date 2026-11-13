import React, { useState } from 'react';
import { Download, Film, X } from 'lucide-react';
import { DspAnalysisResult, analyzeAudioSamples } from '../engine/dsp';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformStyle,
} from '../engine/presets';
import { createRenderSurface, renderStudioFrame } from '../engine/renderer';

interface RenderExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageEl: HTMLImageElement | null;
  audioSamples: Float32Array | null;
  audioSampleRate: number;
  audioWavOrFile: Blob | null;
  audioFilename: string;
  cachedDsp: DspAnalysisResult | null;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  theme: ColorThemeKey;
  bassIntensity: number;
  fps: FpsOption;
}

type RenderStatus = 'idle' | 'rendering-frames' | 'encoding-ffmpeg' | 'done' | 'error';

export const RenderExportModal: React.FC<RenderExportModalProps> = ({
  isOpen,
  onClose,
  imageEl,
  audioSamples,
  audioSampleRate,
  audioWavOrFile,
  cachedDsp,
  ratio,
  fitMode,
  style,
  theme,
  bassIntensity,
  fps,
}) => {
  const [resolutionScale, setResolutionScale] = useState<'1080p' | '720p'>('1080p');
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [progressPct, setProgressPct] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const baseSpec = ASPECT_RATIOS[ratio];
  const scale = resolutionScale === '1080p' ? 1 : 2 / 3;
  // Ensure even dimensions for H.264 yuv420p
  const outW = Math.floor((baseSpec.width * scale) / 2) * 2;
  const outH = Math.floor((baseSpec.height * scale) / 2) * 2;

  const handleClose = () => {
    if (status === 'rendering-frames' || status === 'encoding-ffmpeg') return;
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setStatus('idle');
    setProgressPct(0);
    setErrorMsg(null);
    onClose();
  };

  const handleStartRender = async () => {
    if (!imageEl || !audioSamples || !audioWavOrFile) {
      setErrorMsg('กรุณาเลือกรูปภาพและไฟล์เสียงก่อนเริ่มเรนเดอร์');
      setStatus('error');
      return;
    }

    try {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
      }

      setErrorMsg(null);
      setStatus('rendering-frames');
      setProgressPct(2);
      setStatusText('กำลังเตรียมข้อมูลคลื่นความถี่เบส...');

      // Reuse already-analyzed DSP data if FPS matches
      const dsp: DspAnalysisResult =
        cachedDsp && cachedDsp.fps === fps
          ? cachedDsp
          : analyzeAudioSamples(audioSamples, audioSampleRate, fps, 64);
      const totalFrames = dsp.totalFrames;

      // 1. Start server FFmpeg render session
      const startForm = new FormData();
      startForm.append('audio', audioWavOrFile, 'master_audio.wav');
      startForm.append('fps', String(fps));
      startForm.append('width', String(outW));
      startForm.append('height', String(outH));

      const startRes = await fetch('/api/render/start', {
        method: 'POST',
        body: startForm,
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err.error || 'ไม่สามารถเริ่มงานเรนเดอร์บนเซิร์ฟเวอร์ได้');
      }
      const { jobId } = (await startRes.json()) as { jobId: string };

      // 2. Render frames on offscreen canvas and upload in chunks of 48 frames
      const surface = createRenderSurface(imageEl, outW, outH, fitMode);
      const offCanvas = document.createElement('canvas');
      offCanvas.width = outW;
      offCanvas.height = outH;
      const ctx = offCanvas.getContext('2d', { alpha: false })!;

      const specCol = new Float32Array(64);
      const chunkSize = 48;
      let batch: Blob[] = [];

      const flushBatch = async () => {
        if (batch.length === 0) return;
        const form = new FormData();
        batch.forEach((b, idx) => form.append('frames', b, `f_${idx}.jpg`));
        const res = await fetch(`/api/render/${jobId}/frames`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          throw new Error('ส่งเฟรมภาพไปยัง FFmpeg ไม่สำเร็จ');
        }
        batch = [];
      };

      for (let f = 0; f < totalFrames; f++) {
        for (let b = 0; b < 64; b++) {
          specCol[b] = dsp.melSpec[b][f] ?? 0;
        }
        const bassVal = dsp.bassEnv[f] ?? 0;
        renderStudioFrame(ctx, surface, specCol, bassVal, style, theme, bassIntensity, f);

        const blob = await new Promise<Blob>((resolve, reject) => {
          offCanvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('สร้างเฟรม JPEG ไม่สำเร็จ'))),
            'image/jpeg',
            0.88
          );
        });
        batch.push(blob);

        if (batch.length >= chunkSize) {
          await flushBatch();
          const pct = Math.min(82, Math.round(((f + 1) / totalFrames) * 80) + 2);
          setProgressPct(pct);
          setStatusText(`กำลังเรนเดอร์เฟรม ${f + 1} / ${totalFrames} (${outW}×${outH} px)...`);
        } else if (f % 8 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      await flushBatch();

      // 3. Finalize FFmpeg H.264 + AAC 320kbps MP4 encode
      setStatus('encoding-ffmpeg');
      setProgressPct(88);
      setStatusText('กำลังเข้ารหัส H.264 (CRF 18) และรวมเสียง AAC 320kbps ด้วย FFmpeg...');

      const finishRes = await fetch(`/api/render/${jobId}/finish`, {
        method: 'POST',
      });
      if (!finishRes.ok) {
        const err = await finishRes.json().catch(() => ({}));
        throw new Error(err.error || 'FFmpeg เข้ารหัส .MP4 ไม่สำเร็จ');
      }

      const mp4Blob = await finishRes.blob();
      const url = URL.createObjectURL(mp4Blob);
      setVideoUrl(url);
      setProgressPct(100);
      setStatus('done');
      setStatusText('เรนเดอร์วิดีโอ .MP4 เสร็จสมบูรณ์');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างเรนเดอร์');
    }
  };

  const isBusy = status === 'rendering-frames' || status === 'encoding-ffmpeg';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="render-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-lg bg-[#111827] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-sky-400" aria-hidden="true" />
            <h2 id="render-modal-title" className="text-base font-semibold text-slate-50">
              เรนเดอร์วิดีโอ .MP4 (H.264 + AAC 320kbps)
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            aria-label="ปิดหน้าต่างเรนเดอร์"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Summary of settings */}
          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 flex flex-wrap gap-x-4 gap-y-1.5 font-mono tabular-nums">
            <span>อัตราส่วน: {ratio}</span>
            <span>ขนาด: {outW}×{outH} px</span>
            <span>FPS: {fps}</span>
            <span>คลื่น: {style}</span>
            <span>สี: {theme}</span>
            <span>เบส: {bassIntensity.toFixed(1)}x</span>
          </div>

          {/* Quality Selection */}
          {status === 'idle' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-slate-300">
                เลือกความละเอียดในการส่งออก
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setResolutionScale('1080p')}
                  className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    resolutionScale === '1080p'
                      ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                      : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-semibold">1080p Full HD (ต้นฉบับ)</div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    {baseSpec.width} × {baseSpec.height} px
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setResolutionScale('720p')}
                  className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    resolutionScale === '720p'
                      ? 'border-sky-400 bg-sky-500/15 text-slate-50'
                      : 'border-slate-800 bg-[#0D1320] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-semibold">720p Fast Render</div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    เรนเดอร์เร็วขึ้น 2 เท่า
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {(isBusy || status === 'done') && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-200">{statusText}</span>
                <span className="font-mono tabular-nums text-sky-300">{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-400 transition-all duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Finished Video Preview */}
          {status === 'done' && videoUrl && (
            <div className="flex flex-col gap-3">
              <video
                src={videoUrl}
                controls
                className="w-full max-h-[260px] rounded-lg border border-slate-800 bg-black"
              />
              <a
                href={videoUrl}
                download={`miximage_${ratio.replace(':', 'x')}_${style}_${fps}fps.mp4`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>ดาวน์โหลดไฟล์ .MP4</span>
              </a>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && errorMsg && (
            <p role="alert" className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/60 rounded-lg p-3">
              {errorMsg}
            </p>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-1 border-t border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              disabled={isBusy}
              className="px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-xs font-medium text-slate-200 disabled:opacity-40 transition-colors"
            >
              ปิด
            </button>
            {(status === 'idle' || status === 'error') && (
              <button
                type="button"
                onClick={handleStartRender}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors"
              >
                เริ่มเรนเดอร์วิดีโอ .MP4
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
