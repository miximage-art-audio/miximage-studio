import React, { useState } from 'react';
import { Download, Film, X } from 'lucide-react';
import { DspAnalysisResult, analyzeAudioSamples } from '../engine/dsp';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformLayoutConfig,
  WaveformStyle,
} from '../engine/presets';
import { createRenderSurface, renderStudioFrame } from '../engine/renderer';
import {
  findSupportedRecordingFormat,
  RecordingFormat,
  resolveRecordingFormat,
} from '../engine/recordingFormat';

interface RenderExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageEl: HTMLImageElement | null;
  audioSamples: Float32Array | null;
  audioBuffer: AudioBuffer | null;
  audioSampleRate: number;
  cachedDsp: DspAnalysisResult | null;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  theme: ColorThemeKey;
  bassIntensity: number;
  fps: FpsOption;
  waveformLayout: WaveformLayoutConfig;
}

type RenderStatus = 'idle' | 'rendering' | 'done' | 'error';

function getBrowserRecordingFormat(): RecordingFormat | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  return findSupportedRecordingFormat((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function getAudioContextConstructor(): typeof AudioContext | null {
  const browserWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext || browserWindow.webkitAudioContext || null;
}

export const RenderExportModal: React.FC<RenderExportModalProps> = ({
  isOpen,
  onClose,
  imageEl,
  audioSamples,
  audioBuffer,
  audioSampleRate,
  cachedDsp,
  ratio,
  fitMode,
  style,
  theme,
  bassIntensity,
  fps,
  waveformLayout,
}) => {
  const [resolutionScale, setResolutionScale] = useState<'1080p' | '720p'>('1080p');
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [progressPct, setProgressPct] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFormat, setVideoFormat] = useState<RecordingFormat | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supportedFormat = getBrowserRecordingFormat();
  const captureStreamSupported =
    typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;

  if (!isOpen) return null;

  const baseSpec = ASPECT_RATIOS[ratio];
  const scale = resolutionScale === '1080p' ? 1 : 2 / 3;
  const outW = Math.floor((baseSpec.width * scale) / 2) * 2;
  const outH = Math.floor((baseSpec.height * scale) / 2) * 2;

  const handleClose = () => {
    if (status === 'rendering') return;
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setVideoFormat(null);
    setStatus('idle');
    setProgressPct(0);
    setStatusText('');
    setErrorMsg(null);
    onClose();
  };

  const handleStartRender = async () => {
    if (!imageEl || !audioSamples) {
      setErrorMsg('กรุณาเลือกรูปภาพและไฟล์เสียงก่อนเริ่มเรนเดอร์');
      setStatus('error');
      return;
    }

    if (!supportedFormat) {
      setErrorMsg('เบราว์เซอร์นี้ไม่มี MediaRecorder ที่รองรับ MP4 หรือ WebM กรุณาเปิดด้วยเบราว์เซอร์รุ่นใหม่');
      setStatus('error');
      return;
    }

    if (!captureStreamSupported) {
      setErrorMsg('เบราว์เซอร์นี้ไม่รองรับ Canvas captureStream จึงยังบันทึกวิดีโอในหน้าเว็บนี้ไม่ได้');
      setStatus('error');
      return;
    }

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      setErrorMsg('เบราว์เซอร์นี้ไม่รองรับ Web Audio API สำหรับรวมเพลงลงในวิดีโอ');
      setStatus('error');
      return;
    }

    let audioContext: AudioContext | null = null;
    let source: AudioBufferSourceNode | null = null;
    let recordingStream: MediaStream | null = null;
    let animationFrameId = 0;

    try {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
      }
      setVideoFormat(null);
      setErrorMsg(null);
      setStatus('rendering');
      setProgressPct(0);
      setStatusText('กำลังเตรียมข้อมูลคลื่นความถี่เบส...');

      const dsp: DspAnalysisResult =
        cachedDsp && cachedDsp.fps === fps
          ? cachedDsp
          : analyzeAudioSamples(audioSamples, audioSampleRate, fps, 64);
      const surface = createRenderSurface(imageEl, outW, outH, fitMode);
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = outW;
      renderCanvas.height = outH;
      const renderCtx = renderCanvas.getContext('2d', { alpha: false });
      if (!renderCtx) throw new Error('สร้าง Canvas สำหรับเรนเดอร์ไม่สำเร็จ');

      const specCol = new Float32Array(64);
      const drawFrame = (exactFrame: number) => {
        const clampedFrame = Math.max(0, Math.min(dsp.totalFrames - 1, exactFrame));
        const f0 = Math.floor(clampedFrame);
        const f1 = Math.min(dsp.totalFrames - 1, f0 + 1);
        const frac = clampedFrame - f0;
        const smoothFrac = frac * frac * (3 - 2 * frac);
        const bassVal =
          (dsp.bassEnv[f0] ?? 0) * (1 - smoothFrac) +
          (dsp.bassEnv[f1] ?? 0) * smoothFrac;
        for (let band = 0; band < 64; band++) {
          const v0 = dsp.melSpec[band][f0] ?? 0;
          const v1 = dsp.melSpec[band][f1] ?? 0;
          specCol[band] = v0 * (1 - smoothFrac) + v1 * smoothFrac;
        }
        renderStudioFrame(
          renderCtx,
          surface,
          specCol,
          bassVal,
          style,
          theme,
          bassIntensity,
          clampedFrame,
          waveformLayout
        );
      };
      drawFrame(0);

      const canvasStream = renderCanvas.captureStream(fps);
      audioContext = new AudioContextConstructor();
      await audioContext.resume();
      const exportAudioBuffer = audioBuffer ?? audioContext.createBuffer(
        1,
        audioSamples.length,
        audioSampleRate
      );
      if (!audioBuffer) exportAudioBuffer.getChannelData(0).set(audioSamples);

      const durationSec = Math.min(dsp.durationSec, exportAudioBuffer.duration);
      if (!Number.isFinite(durationSec) || durationSec <= 0 || dsp.totalFrames <= 0) {
        throw new Error('ไฟล์เสียงไม่มีความยาวที่ใช้เรนเดอร์ได้');
      }

      const audioDestination = audioContext.createMediaStreamDestination();
      source = audioContext.createBufferSource();
      source.buffer = exportAudioBuffer;
      source.connect(audioDestination);
      recordingStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);

      const recorder = new MediaRecorder(recordingStream, {
        mimeType: supportedFormat.mimeType,
        videoBitsPerSecond: resolutionScale === '1080p' ? 8_000_000 : 5_000_000,
        audioBitsPerSecond: 256_000,
      });
      const chunks: Blob[] = [];
      let recorderError: Error | null = null;
      let lastRenderedFrame = 0;
      let lastProgressUpdate = 0;
      const stopRecorderIfActive = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };

      const recordedBlob = await new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) chunks.push(event.data);
        };

        recorder.onerror = () => {
          recorderError = new Error('MediaRecorder เกิดข้อผิดพลาดระหว่างบันทึกวิดีโอ');
          if (recorder.state !== 'inactive') recorder.stop();
        };

        recorder.onstop = () => {
          if (recorderError) {
            reject(recorderError);
            return;
          }
          const actualFormat = resolveRecordingFormat(recorder.mimeType, supportedFormat);
          if (!actualFormat) {
            reject(new Error('เบราว์เซอร์รายงานชนิดไฟล์วิดีโอที่ไม่รู้จัก จึงยกเลิกการตั้งชื่อนามสกุลไฟล์เพื่อป้องกันไฟล์ผิดรูปแบบ'));
            return;
          }
          const blob = new Blob(chunks, { type: actualFormat.mimeType || supportedFormat.mimeType });
          if (blob.size === 0) {
            reject(new Error('เบราว์เซอร์ไม่ได้สร้างข้อมูลวิดีโอ กรุณาลองใหม่อีกครั้ง'));
            return;
          }
          setVideoFormat(actualFormat);
          resolve(blob);
        };

        recorder.onstart = () => {
          const startedAt = audioContext!.currentTime;
          source!.onended = () => {
            drawFrame(dsp.totalFrames - 1);
            stopRecorderIfActive();
          };
          source!.start(startedAt);
          setStatusText(`กำลังบันทึกภาพและเสียงในเบราว์เซอร์ ${outW}×${outH} px...`);

          const tick = (now: number) => {
            if (recorder.state === 'inactive') return;
            const elapsed = Math.max(0, audioContext!.currentTime - startedAt);
            const exactFrame = Math.min(dsp.totalFrames - 1, elapsed * fps);
            drawFrame(exactFrame);
            lastRenderedFrame = Math.floor(exactFrame);

            if (now - lastProgressUpdate >= 120) {
              lastProgressUpdate = now;
              const nextProgress = Math.min(99, Math.floor((elapsed / durationSec) * 100));
              setProgressPct(nextProgress);
            }

            if (elapsed >= durationSec) {
              drawFrame(dsp.totalFrames - 1);
              stopRecorderIfActive();
              return;
            }
            animationFrameId = requestAnimationFrame(tick);
          };
          animationFrameId = requestAnimationFrame(tick);
        };

        recorder.start(1000);
      });

      const actualFormat = videoFormat ?? resolveRecordingFormat(recorder.mimeType, supportedFormat) ?? supportedFormat;
      const url = URL.createObjectURL(recordedBlob);
      setVideoUrl(url);
      setVideoFormat(actualFormat);
      setProgressPct(100);
      setStatus('done');
      setStatusText(
        actualFormat.extension === 'mp4'
          ? 'เรนเดอร์วิดีโอ .MP4 เสร็จสมบูรณ์'
          : 'บันทึกเป็น .WEBM เสร็จสมบูรณ์ เนื่องจากเบราว์เซอร์นี้ไม่รองรับ MP4'
      );
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างเรนเดอร์');
    } finally {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (source) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // The source may already have ended.
        }
        source.disconnect();
      }
      recordingStream?.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== 'closed') {
        await audioContext.close().catch(() => {});
      }
    }
  };

  const isBusy = status === 'rendering';

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
              เรนเดอร์วิดีโอในเบราว์เซอร์
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
          <div
            role="status"
            className={`rounded-lg border p-3 text-xs leading-relaxed ${
              !supportedFormat || !captureStreamSupported
                ? 'border-rose-900/60 bg-rose-950/30 text-rose-300'
                : supportedFormat.extension === 'mp4'
                  ? 'border-emerald-900/60 bg-emerald-950/25 text-emerald-300'
                  : 'border-amber-900/60 bg-amber-950/25 text-amber-200'
            }`}
          >
            {!captureStreamSupported
              ? 'เบราว์เซอร์นี้ไม่รองรับการจับภาพจาก Canvas'
              : !supportedFormat
                ? 'เบราว์เซอร์นี้ไม่รองรับการบันทึกวิดีโอด้วย MediaRecorder'
                : supportedFormat.extension === 'mp4'
                  ? 'เบราว์เซอร์นี้บันทึกเป็น .mp4 ได้ ไฟล์จะสร้างในเครื่องโดยตรง แต่ codec ที่ใช้ขึ้นกับเบราว์เซอร์ และอาจไม่ใช่ H.264/AAC'
                  : 'เบราว์เซอร์นี้ไม่รองรับ MP4 สำหรับการบันทึก ระบบจะสร้างไฟล์ .webm และจะไม่ตั้งชื่อ WebM เป็น .mp4'}
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 flex flex-wrap gap-x-4 gap-y-1.5 font-mono tabular-nums">
            <span>อัตราส่วน: {ratio}</span>
            <span>ขนาด: {outW}×{outH} px</span>
            <span>FPS: {fps}</span>
            <span>คลื่น: {style}</span>
            <span>สี: {theme}</span>
            <span>เบส: {bassIntensity.toFixed(1)}x</span>
          </div>

          {status === 'idle' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-slate-300">
                เลือกความละเอียดในการส่งออก
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setResolutionScale('1080p')}
                  aria-pressed={resolutionScale === '1080p'}
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
                  aria-pressed={resolutionScale === '720p'}
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

          {status === 'done' && videoUrl && videoFormat && (
            <div className="flex flex-col gap-3">
              <video
                src={videoUrl}
                controls
                className="w-full max-h-[260px] rounded-lg border border-slate-800 bg-black"
              />
              <a
                href={videoUrl}
                download={`miximage_${ratio.replace(':', 'x')}_${style}_${fps}fps.${videoFormat.extension}`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>ดาวน์โหลดไฟล์ .{videoFormat.extension.toUpperCase()}</span>
              </a>
            </div>
          )}

          {status === 'error' && errorMsg && (
            <p role="alert" className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/60 rounded-lg p-3">
              {errorMsg}
            </p>
          )}

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
                disabled={!supportedFormat || !captureStreamSupported}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                เริ่มเรนเดอร์วิดีโอ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
