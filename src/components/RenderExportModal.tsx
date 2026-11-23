import React, { useState, useEffect, useMemo } from 'react';
import { Download, Film, X } from 'lucide-react';
import { DspAnalysisResult, analyzeAudioSamples, sampleDspAtTime } from '../engine/dsp';
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
import {
  createRenderSurface,
  renderStudioFrame,
  updateRenderSurfaceBase,
} from '../engine/renderer';
import {
  findSupportedRecordingFormat,
  RecordingFormat,
  resolveRecordingFormat,
} from '../engine/recordingFormat';

export interface RenderExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaType?: 'image' | 'video';
  imageEl: HTMLImageElement | null;
  videoEl?: HTMLVideoElement | null;
  renderDuration?: number;
  songDuration?: number;
  showWaveform?: boolean;
  trimStartSec?: number;
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
  mediaType = 'image',
  imageEl,
  videoEl,
  renderDuration,
  songDuration,
  showWaveform = true,
  trimStartSec = 0,
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

  const supportedFormat = getBrowserRecordingFormat();
  const captureStreamSupported =
    typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;

  const actualSongSec = useMemo(() => {
    if (songDuration && songDuration > 0) return songDuration;
    if (cachedDsp?.durationSec && cachedDsp.durationSec > 0) return cachedDsp.durationSec;
    if (audioBuffer?.duration && audioBuffer.duration > 0) return audioBuffer.duration;
    if (audioSamples && audioSampleRate > 0) return audioSamples.length / audioSampleRate;
    return 16;
  }, [songDuration, cachedDsp?.durationSec, audioBuffer?.duration, audioSamples, audioSampleRate]);

  const vDuration = useMemo(() => {
    if (mediaType === 'video' && videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      return videoEl.duration;
    }
    return 0;
  }, [mediaType, videoEl]);

  const masterMax = useMemo(() => {
    return Math.max(actualSongSec, vDuration || actualSongSec);
  }, [actualSongSec, vDuration]);

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
    const hasMedia =
      mediaType === 'video'
        ? Boolean(videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0)
        : Boolean(imageEl);

    if (!hasMedia || !audioSamples) {
      setErrorMsg(
        mediaType === 'video'
          ? 'กรุณารอไฟล์วิดีโอพร้อมทำงานและเลือกไฟล์เสียงก่อนเริ่มเรนเดอร์'
          : 'กรุณาเลือกรูปภาพและไฟล์เสียงก่อนเริ่มเรนเดอร์'
      );
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
    let intervalTimer: number | null = null;

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

      const surfaceSource = mediaType === 'video' && videoEl ? videoEl : imageEl!;
      const surface = createRenderSurface(surfaceSource, outW, outH, fitMode);
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = outW;
      renderCanvas.height = outH;
      const renderCtx = renderCanvas.getContext('2d', { alpha: false });
      if (!renderCtx) throw new Error('สร้าง Canvas สำหรับเรนเดอร์ไม่สำเร็จ');

      const specCol = new Float32Array(64);
      const drawFrameAt = (sec: number) => {
        if (
          mediaType === 'video' &&
          videoEl &&
          videoEl.videoWidth > 0 &&
          videoEl.videoHeight > 0
        ) {
          const vDur = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 0;
          if (vDur > 0) {
            const expectedVTime = (trimStartSec + sec) % vDur;
            const drift = Math.abs(videoEl.currentTime - expectedVTime);
            if (drift > 1.2 && drift < vDur - 0.4) {
              try {
                videoEl.currentTime = expectedVTime;
              } catch {
                // ignore
              }
            }
            if (videoEl.paused) {
              videoEl.play().catch(() => {});
            }
          }
          updateRenderSurfaceBase(surface, videoEl, videoEl.videoWidth, videoEl.videoHeight, fitMode);
        }

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

      drawFrameAt(0);

      const canvasStream = renderCanvas.captureStream(fps);
      audioContext = new AudioContextConstructor();
      await audioContext.resume();

      const exportAudioBuffer =
        audioBuffer ??
        audioContext.createBuffer(1, audioSamples.length, audioSampleRate);
      if (!audioBuffer) exportAudioBuffer.getChannelData(0).set(audioSamples);

      const maxAudioDuration = exportAudioBuffer.duration;
      const durationSec = selectedDuration > 0 ? selectedDuration : actualSongSec;

      if (!Number.isFinite(durationSec) || durationSec <= 0 || dsp.totalFrames <= 0) {
        throw new Error('ไฟล์เสียงไม่มีความยาวที่ใช้เรนเดอร์ได้');
      }

      const audioDestination = audioContext.createMediaStreamDestination();
      source = audioContext.createBufferSource();
      source.buffer = exportAudioBuffer;
      source.loop = maxAudioDuration < durationSec; // Loop audio if duration is longer than song
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
      let lastProgressUpdate = 0;

      const stopRecorderIfActive = () => {
        if (intervalTimer !== null) {
          clearInterval(intervalTimer);
          intervalTimer = null;
        }
        if (recorder.state !== 'inactive') recorder.stop();
        if (mediaType === 'video' && videoEl) {
          try {
            videoEl.pause();
          } catch {
            // ignore
          }
        }
      };

      const recordedBlob = await new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) chunks.push(event.data);
        };

        recorder.onerror = () => {
          recorderError = new Error('MediaRecorder เกิดข้อผิดพลาดระหว่างบันทึกวิดีโอ');
          stopRecorderIfActive();
        };

        recorder.onstop = () => {
          if (intervalTimer !== null) {
            clearInterval(intervalTimer);
            intervalTimer = null;
          }
          if (recorderError) {
            reject(recorderError);
            return;
          }
          const actualFormat = resolveRecordingFormat(recorder.mimeType, supportedFormat);
          if (!actualFormat) {
            reject(
              new Error(
                'เบราว์เซอร์รายงานชนิดไฟล์วิดีโอที่ไม่รู้จัก จึงยกเลิกการตั้งชื่อนามสกุลไฟล์เพื่อป้องกันไฟล์ผิดรูปแบบ'
              )
            );
            return;
          }
          const blob = new Blob(chunks, {
            type: actualFormat.mimeType || supportedFormat.mimeType,
          });
          if (blob.size === 0) {
            reject(new Error('เบราว์เซอร์ไม่ได้สร้างข้อมูลวิดีโอ กรุณาลองใหม่อีกครั้ง'));
            return;
          }
          setVideoFormat(actualFormat);
          resolve(blob);
        };

        recorder.onstart = () => {
          const startedAt = audioContext!.currentTime;

          if (mediaType === 'video' && videoEl) {
            try {
              videoEl.muted = true;
              videoEl.loop = true;
              const vDur = videoEl.duration || 1;
              videoEl.currentTime = vDur > 0 ? trimStartSec % vDur : 0;
              videoEl.play().catch(() => {});
            } catch {
              // ignore
            }
          }

          source!.onended = () => {
            drawFrameAt(durationSec);
            stopRecorderIfActive();
          };
          source!.start(startedAt, 0, durationSec);
          setStatusText(`กำลังบันทึกภาพและเสียง ${outW}×${outH} px (${formatTime(durationSec)})...`);

          // Secondary interval backup to ensure stop triggers accurately even if requestAnimationFrame throttles
          intervalTimer = window.setInterval(() => {
            if (recorder.state === 'inactive') return;
            const elapsed = Math.max(0, audioContext!.currentTime - startedAt);
            if (elapsed >= durationSec) {
              drawFrameAt(durationSec);
              stopRecorderIfActive();
            }
          }, 200);

          const tick = (now: number) => {
            if (recorder.state === 'inactive') return;
            const elapsed = Math.max(0, audioContext!.currentTime - startedAt);
            drawFrameAt(elapsed);

            if (now - lastProgressUpdate >= 120) {
              lastProgressUpdate = now;
              const nextProgress = Math.min(99, Math.floor((elapsed / durationSec) * 100));
              setProgressPct(nextProgress);
            }

            if (elapsed >= durationSec) {
              drawFrameAt(durationSec);
              stopRecorderIfActive();
              return;
            }
            animationFrameId = requestAnimationFrame(tick);
          };
          animationFrameId = requestAnimationFrame(tick);
        };

        recorder.start(1000);
      });

      const actualFormat = resolveRecordingFormat(recorder.mimeType, supportedFormat) ?? supportedFormat;
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
      if (intervalTimer !== null) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
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
      if (mediaType === 'video' && videoEl) {
        try {
          videoEl.pause();
        } catch {
          // ignore
        }
      }
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
                ส่งออกวิดีโอ {supportedFormat ? `.${supportedFormat.extension.toUpperCase()}` : ''}
              </h2>
              <p className="text-[11px] text-slate-400">
                {mediaType === 'video'
                  ? `วิดีโอพื้นหลัง (${formatTime(selectedDuration)})`
                  : `เรนเดอร์คลื่นเสียงเพลง (${formatTime(selectedDuration)})`}
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
              !supportedFormat || !captureStreamSupported
                ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
                : 'bg-sky-950/20 border-sky-800/40 text-sky-300'
            }`}
          >
            {!captureStreamSupported
              ? 'เบราว์เซอร์นี้ไม่รองรับการจับภาพจาก Canvas'
              : !supportedFormat
                ? 'เบราว์เซอร์นี้ไม่รองรับการบันทึกวิดีโอด้วย MediaRecorder'
                : supportedFormat.extension === 'mp4'
                  ? 'เบราว์เซอร์นี้บันทึกเป็น .mp4 ได้ ไฟล์จะสร้างในเครื่องโดยตรง'
                  : 'เบราว์เซอร์นี้ไม่รองรับ MP4 สำหรับการบันทึก ระบบจะสร้างไฟล์ .webm และจะไม่ตั้งชื่อ WebM เป็น .mp4'}
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

                  {vDuration > 0 && Math.abs(vDuration - actualSongSec) > 0.5 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDuration(vDuration)}
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                        Math.abs(selectedDuration - vDuration) < 0.2
                          ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                          : 'border-slate-800 bg-slate-900 text-slate-300 hover:text-white'
                      }`}
                    >
                      🎬 ตามคลิปวิดีโอ ({formatTime(vDuration)})
                    </button>
                  )}

                  {masterMax >= 15 && (
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

                  {masterMax >= 30 && (
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

                  {masterMax >= 60 && (
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

                {/* Duration Slider */}
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, masterMax)}
                  step={0.5}
                  value={selectedDuration}
                  onChange={(e) => setSelectedDuration(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                />

                {/* Loop Notice if video is shorter than export duration */}
                {mediaType === 'video' && vDuration > 0 && selectedDuration > vDuration + 0.5 && (
                  <div className="text-[11px] text-sky-300 bg-sky-950/30 border border-sky-800/40 rounded px-2.5 py-1.5 flex items-center gap-1.5">
                    <span>🔁</span>
                    <span>
                      วิดีโอพื้นหลัง ({formatTime(vDuration)}) จะวนลูปซ้ำอัตโนมัติตลอดความยาวที่เลือก ({formatTime(selectedDuration)})
                    </span>
                  </div>
                )}
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
            <span>สื่อ: {mediaType === 'video' ? 'วิดีโอ' : 'ภาพนิ่ง'}</span>
            <span>อัตราส่วน: {ratio}</span>
            <span>ขนาด: {outW}×{outH} px</span>
            <span>FPS: {fps}</span>
            <span>คลื่น: {showWaveform ? style : 'ไม่ใส่ (ปิด)'}</span>
            <span>ความยาว: {formatTime(selectedDuration)}</span>
            <span>เบส: {bassIntensity > 0 ? `${bassIntensity.toFixed(1)}x` : 'ไม่ใส่ (ปิดสั่น)'}</span>
          </div>

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
              💡 แนะนำเปิดหน้านี้ทิ้งไว้ขณะเรนเดอร์
            </span>
            <div className="flex items-center gap-2">
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
