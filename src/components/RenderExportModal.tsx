import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Film, X } from 'lucide-react';
import { DspAnalysisResult, analyzeAudioSamples, sampleDspAtTime } from '../engine/dsp';
import { isWebCodecsAvailable, exportVideoWithWebCodecs } from '../engine/mp4Encoder';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformColorMix,
  WaveformLayoutConfig,
  WaveformStyle,
  formatTime,
} from '../engine/presets';
import { createRenderSurface, renderStudioFrame } from '../engine/renderer';
import {
  findSupportedRecordingFormat,
  RecordingFormat,
  resolveRecordingFormat,
} from '../engine/recordingFormat';

export interface RenderExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageEl: HTMLImageElement | null;
  renderDuration?: number;
  songDuration?: number;
  showWaveform?: boolean;
  audioSamples: Float32Array | null;
  audioBuffer: AudioBuffer | null;
  audioSampleRate: number;
  cachedDsp: DspAnalysisResult | null;
  ratio: AspectRatioKey;
  fitMode: FitMode;
  style: WaveformStyle;
  theme: ColorThemeKey;
  colorMix: WaveformColorMix;
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
  renderDuration,
  songDuration,
  showWaveform = true,
  audioSamples,
  audioBuffer,
  audioSampleRate,
  cachedDsp,
  ratio,
  fitMode,
  style,
  theme,
  colorMix,
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
  const abortControllerRef = useRef<AbortController | null>(null);

  const webCodecsAvailable = isWebCodecsAvailable();
  const supportedFallbackFormat = getBrowserRecordingFormat();
  const captureStreamSupported =
    typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  const canExport = webCodecsAvailable || (Boolean(supportedFallbackFormat) && captureStreamSupported);

  const actualSongSec = useMemo(() => {
    if (songDuration && songDuration > 0) return songDuration;
    if (cachedDsp?.durationSec && cachedDsp.durationSec > 0) return cachedDsp.durationSec;
    if (audioBuffer?.duration && audioBuffer.duration > 0) return audioBuffer.duration;
    if (audioSamples && audioSampleRate > 0) return audioSamples.length / audioSampleRate;
    return 16;
  }, [songDuration, cachedDsp?.durationSec, audioBuffer?.duration, audioSamples, audioSampleRate]);

  const [selectedDuration, setSelectedDuration] = useState<number>(() => {
    return renderDuration && renderDuration > 0 ? renderDuration : actualSongSec;
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedDuration(renderDuration && renderDuration > 0 ? renderDuration : actualSongSec);
    }
  }, [isOpen, renderDuration, actualSongSec]);

  if (!isOpen) return null;

  const baseSpec = ASPECT_RATIOS[ratio];
  const scale = resolutionScale === '1080p' ? 1 : 2 / 3;
  const outW = Math.floor((baseSpec.width * scale) / 2) * 2;
  const outH = Math.floor((baseSpec.height * scale) / 2) * 2;

  const handleCancelRender = () => {
    abortControllerRef.current?.abort();
  };

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

  const renderWithMediaRecorderFallback = async (
    dsp: DspAnalysisResult,
    renderCanvas: HTMLCanvasElement,
    drawFrameAt: (sec: number) => void,
    durationSec: number,
    signal: AbortSignal
  ): Promise<{ blob: Blob; format: RecordingFormat }> => {
    if (!supportedFallbackFormat || !captureStreamSupported) {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับการบันทึกวิดีโอทั้ง WebCodecs และ MediaRecorder');
    }
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Audio API สำหรับรวมเพลงลงในวิดีโอ');
    }

    // Mount canvas inside hidden DOM container so Chrome does not throttle captureStream
    const domMount = document.createElement('div');
    domMount.setAttribute('aria-hidden', 'true');
    Object.assign(domMount.style, {
      position: 'fixed',
      top: '-9999px',
      left: '-9999px',
      width: '2px',
      height: '2px',
      opacity: '0.001',
      pointerEvents: 'none',
      overflow: 'hidden',
    });
    domMount.appendChild(renderCanvas);
    document.body.appendChild(domMount);

    let audioContext: AudioContext | null = null;
    let source: AudioBufferSourceNode | null = null;
    let recordingStream: MediaStream | null = null;
    let frameTimerId: number | null = null;

    try {
      drawFrameAt(0);
      const canvasStream = renderCanvas.captureStream(fps);
      audioContext = new AudioContextConstructor();
      await audioContext.resume();

      const exportAudioBuffer =
        audioBuffer ??
        audioContext.createBuffer(1, audioSamples!.length, audioSampleRate);
      if (!audioBuffer) exportAudioBuffer.getChannelData(0).set(audioSamples!);

      const audioDestination = audioContext.createMediaStreamDestination();
      source = audioContext.createBufferSource();
      source.buffer = exportAudioBuffer;
      source.loop = exportAudioBuffer.duration < durationSec;
      source.connect(audioDestination);

      recordingStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);

      const recorder = new MediaRecorder(recordingStream, {
        mimeType: supportedFallbackFormat.mimeType,
        videoBitsPerSecond: resolutionScale === '1080p' ? 8_000_000 : 5_000_000,
        audioBitsPerSecond: 256_000,
      });

      const chunks: Blob[] = [];
      let recorderError: Error | null = null;
      const frameIntervalMs = Math.max(15, Math.round(1000 / fps));

      const stopAll = () => {
        if (frameTimerId !== null) {
          clearInterval(frameTimerId);
          frameTimerId = null;
        }
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      };

      const onAbort = () => {
        recorderError = new Error('RENDER_ABORTED');
        stopAll();
      };
      signal.addEventListener('abort', onAbort);

      try {
        const recordedBlob = await new Promise<Blob>((resolve, reject) => {
          recorder.ondataavailable = (event: BlobEvent) => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder.onerror = () => {
            recorderError = new Error('MediaRecorder เกิดข้อผิดพลาดระหว่างบันทึกวิดีโอ');
            stopAll();
          };
          recorder.onstop = () => {
            if (frameTimerId !== null) {
              clearInterval(frameTimerId);
              frameTimerId = null;
            }
            if (recorderError) {
              reject(recorderError);
              return;
            }
            const actualFormat = resolveRecordingFormat(
              recorder.mimeType,
              supportedFallbackFormat
            );
            if (!actualFormat) {
              reject(new Error('เบราว์เซอร์รายงานชนิดไฟล์วิดีโอที่ไม่รู้จัก'));
              return;
            }
            const blob = new Blob(chunks, {
              type: actualFormat.mimeType || supportedFallbackFormat.mimeType,
            });
            if (blob.size === 0) {
              reject(new Error('เบราว์เซอร์ไม่ได้สร้างข้อมูลวิดีโอ'));
              return;
            }
            resolve(blob);
          };

          recorder.onstart = () => {
            const startedAtPerf = performance.now();
            const startedAtCtx = audioContext!.currentTime;
            source!.start(startedAtCtx, 0, durationSec);
            setStatusText(
              `กำลังบันทึก Real-Time Fallback ${outW}×${outH} px (${formatTime(durationSec)})...`
            );

            frameTimerId = window.setInterval(() => {
              if (recorder.state === 'inactive') return;
              const wallElapsed = (performance.now() - startedAtPerf) / 1000;
              const audioElapsed = audioContext!.currentTime - startedAtCtx;
              const elapsed =
                audioContext!.state === 'running' && Math.abs(audioElapsed - wallElapsed) < 0.8
                  ? Math.max(0, audioElapsed)
                  : wallElapsed;

              drawFrameAt(Math.min(elapsed, dsp.durationSec));
              setProgressPct(Math.min(99, Math.floor((elapsed / durationSec) * 100)));

              if (elapsed >= durationSec) {
                drawFrameAt(durationSec);
                stopAll();
              }
            }, frameIntervalMs);
          };

          recorder.start(1000);
        });

        const actualFormat =
          resolveRecordingFormat(recorder.mimeType, supportedFallbackFormat) ??
          supportedFallbackFormat;
        return { blob: recordedBlob, format: actualFormat };
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    } finally {
      if (frameTimerId !== null) clearInterval(frameTimerId);
      if (source) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // ignore
        }
      }
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }
      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
      }
      domMount.remove();
    }
  };

  const handleStartRender = async () => {
    if (!imageEl || !audioSamples) {
      setErrorMsg('กรุณาเลือกรูปภาพและไฟล์เสียงก่อนเริ่มเรนเดอร์');
      setStatus('error');
      return;
    }

    const durationSec = selectedDuration > 0 ? selectedDuration : actualSongSec;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      setErrorMsg('ไฟล์เสียงไม่มีความยาวที่ใช้เรนเดอร์ได้');
      setStatus('error');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
      }
      setVideoFormat(null);
      setErrorMsg(null);
      setStatus('rendering');
      setProgressPct(0);
      setStatusText('กำลังเตรียมข้อมูลคลื่นความถี่เบสและตัวเข้ารหัส MP4...');

      const dsp: DspAnalysisResult =
        cachedDsp && cachedDsp.fps === fps
          ? cachedDsp
          : analyzeAudioSamples(audioSamples, audioSampleRate, fps, 64);

      if (dsp.totalFrames <= 0) {
        throw new Error('ไฟล์เสียงไม่มีความยาวที่ใช้เรนเดอร์ได้');
      }

      const surface = createRenderSurface(imageEl, outW, outH, fitMode);
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = outW;
      renderCanvas.height = outH;
      const renderCtx = renderCanvas.getContext('2d', { alpha: false });
      if (!renderCtx) throw new Error('สร้าง Canvas สำหรับเรนเดอร์ไม่สำเร็จ');

      const specCol = new Float32Array(64);
      const drawFrameAt = (sec: number) => {
        const audioSec = sec % (dsp.durationSec || 16);
        const { bassVal, onsetFlux, exactFrame } = sampleDspAtTime(dsp, audioSec, specCol);
        renderStudioFrame(
          renderCtx,
          surface,
          specCol,
          bassVal,
          style,
          theme,
          bassIntensity,
          exactFrame,
          waveformLayout,
          onsetFlux,
          colorMix,
          showWaveform
        );
      };

      const videoBitrate = resolutionScale === '1080p' ? 8_000_000 : 5_000_000;
      let outputBlob: Blob;
      let outputFormat: RecordingFormat;

      try {
        outputBlob = await exportVideoWithWebCodecs({
          width: outW,
          height: outH,
          fps,
          videoBitrate,
          durationSec,
          audioSamples,
          audioBuffer,
          audioSampleRate,
          renderCanvas,
          drawFrameAt,
          signal: controller.signal,
          onProgress: (pct, curFrame, totFrames) => {
            setProgressPct(pct);
            setStatusText(
              `กำลังเรนเดอร์ .MP4 เฟรมที่ ${curFrame.toLocaleString()} / ${totFrames.toLocaleString()} (${formatTime(durationSec)})`
            );
          },
        });
        outputFormat = {
          mimeType: 'video/mp4',
          extension: 'mp4',
          label: 'MP4',
        };
      } catch (err) {
        if (err instanceof Error && err.message === 'RENDER_ABORTED') {
          throw err;
        }
        // Only fallback to MediaRecorder if WebCodecs is unsupported
        if (err instanceof Error && err.message === 'WEBCODECS_UNSUPPORTED') {
          const fallbackRes = await renderWithMediaRecorderFallback(
            dsp,
            renderCanvas,
            drawFrameAt,
            durationSec,
            controller.signal
          );
          outputBlob = fallbackRes.blob;
          outputFormat = fallbackRes.format;
        } else {
          throw err;
        }
      }

      const url = URL.createObjectURL(outputBlob);
      setVideoUrl(url);
      setVideoFormat(outputFormat);
      setProgressPct(100);
      setStatus('done');
      setStatusText(
        `เรนเดอร์วิดีโอ .${outputFormat.extension.toUpperCase()} ความยาว ${formatTime(durationSec)} เสร็จสมบูรณ์!`
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'RENDER_ABORTED') {
        setStatus('idle');
        setProgressPct(0);
        setStatusText('');
        setErrorMsg(null);
      } else {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างเรนเดอร์');
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const isBusy = status === 'rendering';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="bg-[#0B0F19] border border-slate-800 rounded-xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Film className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="export-modal-title" className="text-sm font-semibold text-slate-100">
                ส่งออกวิดีโอ {webCodecsAvailable ? '.MP4 (Offline Fast Render)' : supportedFallbackFormat ? `.${supportedFallbackFormat.extension.toUpperCase()}` : ''}
              </h2>
              <p className="text-[11px] text-slate-400">
                เรนเดอร์คลื่นเสียงเพลง ({formatTime(selectedDuration)})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            aria-label="ปิดหน้าต่างส่งออกวิดีโอ"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          <div
            className={`p-3 rounded-lg border text-xs leading-relaxed ${
              !canExport
                ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
                : 'bg-sky-950/20 border-sky-800/40 text-sky-300'
            }`}
          >
            {!canExport
              ? 'เบราว์เซอร์นี้ไม่รองรับการสร้างไฟล์วิดีโอในหน้าเว็บ'
              : webCodecsAvailable
                ? '⚡ ใช้เอนจิน WebCodecs H.264/MP4 เรนเดอร์ครบทุกเฟรมตรงเวลา 100% ไม่ตัดจบกลางเพลง และเร็วกว่าเวลาจริง'
                : 'เบราว์เซอร์นี้ใช้โหมด MediaRecorder Fallback สำหรับสร้างวิดีโอในเครื่องโดยตรง'}
          </div>

          {status === 'idle' && (
            <div className="flex flex-col gap-3">
              {/* Duration selection section */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">
                    ความยาววิดีโอที่จะเรนเดอร์:
                  </span>
                  <span className="font-mono text-emerald-300 font-semibold text-xs">
                    {formatTime(selectedDuration)} ({selectedDuration.toFixed(1)} วินาที)
                  </span>
                </div>

                {/* Preset Chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedDuration(actualSongSec)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      Math.abs(selectedDuration - actualSongSec) < 0.2
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                        : 'border-slate-800 bg-slate-900 text-slate-300 hover:text-white'
                    }`}
                  >
                    🎵 เต็มเพลง ({formatTime(actualSongSec)})
                  </button>

                  {actualSongSec >= 15 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDuration(15)}
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                        Math.abs(selectedDuration - 15) < 0.2
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      15 วิ
                    </button>
                  )}

                  {actualSongSec >= 30 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDuration(30)}
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                        Math.abs(selectedDuration - 30) < 0.2
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      30 วิ
                    </button>
                  )}

                  {actualSongSec >= 60 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDuration(60)}
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                        Math.abs(selectedDuration - 60) < 0.2
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      60 วิ (1 นาที)
                    </button>
                  )}
                </div>

                {/* Duration Slider & Number */}
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    aria-label="ปรับความยาวคลิปที่จะส่งออก"
                    min={1}
                    max={Math.max(1, actualSongSec)}
                    step={0.5}
                    value={selectedDuration}
                    onChange={(e) => setSelectedDuration(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  />
                  <input
                    type="number"
                    aria-label="ความยาวเป็นวินาที"
                    min={1}
                    max={Math.max(1, Number(actualSongSec.toFixed(1)))}
                    step={0.5}
                    value={Number(selectedDuration.toFixed(1))}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) {
                        setSelectedDuration(Math.max(1, Math.min(v, actualSongSec)));
                      }
                    }}
                    className="w-16 px-1.5 py-0.5 rounded bg-[#0D1320] border border-slate-700 text-right font-mono text-emerald-300 text-xs focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>

              {/* Resolution selection */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-800/80">
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
            </div>
          )}

          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 flex flex-wrap gap-x-4 gap-y-1.5 font-mono tabular-nums">
            <span>สื่อ: ภาพนิ่ง</span>
            <span>อัตราส่วน: {ratio}</span>
            <span>จัดวาง: {fitMode}</span>
            <span>ขนาด: {outW}×{outH} px</span>
            <span>FPS: {fps}</span>
            <span>คลื่น: {showWaveform ? style : 'ไม่ใส่ (ปิด)'}</span>
            <span>ความยาว: {formatTime(selectedDuration)}</span>
            <span>เบส: {bassIntensity > 0 ? `${bassIntensity.toFixed(1)}x` : 'ไม่ใส่ (ปิดสั่น)'}</span>
          </div>

          {(isBusy || status === 'done') && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-200 truncate">{statusText}</span>
                <span className="font-mono tabular-nums text-sky-300 shrink-0">{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-400 transition-all duration-150"
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
                download={`miximage_${ratio.replace(':', 'x')}_${showWaveform ? style : 'no_wave'}_${fps}fps.${videoFormat.extension}`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>ดาวน์โหลดไฟล์ .{videoFormat.extension.toUpperCase()}</span>
              </a>
            </div>
          )}

          {status === 'error' && errorMsg && (
            <p
              role="alert"
              className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/60 rounded-lg p-3"
            >
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-800">
            <span className="text-[11px] text-slate-500">
              {webCodecsAvailable
                ? '💡 เรนเดอร์ตรงทุกเฟรมด้วย H.264 + AAC'
                : '💡 แนะนำเปิดหน้านี้ทิ้งไว้ขณะเรนเดอร์'}
            </span>
            <div className="flex items-center gap-2">
              {isBusy ? (
                <button
                  type="button"
                  onClick={handleCancelRender}
                  className="px-4 py-2 rounded-lg border border-rose-500/50 bg-rose-500/15 hover:bg-rose-500/25 text-xs font-medium text-rose-300 transition-colors"
                >
                  ยกเลิก
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-xs font-medium text-slate-200 transition-colors"
                >
                  ปิด
                </button>
              )}
              {(status === 'idle' || status === 'error') && (
                <button
                  type="button"
                  onClick={handleStartRender}
                  disabled={!canExport}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  เริ่มเรนเดอร์วิดีโอ ({formatTime(selectedDuration)})
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
