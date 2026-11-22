import React, { useRef, useState } from 'react';
import { Download, Film, X } from 'lucide-react';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import {
  DspAnalysisResult,
  analyzeAudioSamples,
  sampleDspAtTime,
} from '../engine/dsp';
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

interface RenderExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaType: 'image' | 'video';
  imageEl: HTMLImageElement | null;
  videoEl: HTMLVideoElement | null;
  renderDuration: number;
  trimStartSec: number;
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

function isWebCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioData !== 'undefined'
  );
}

function createAudioBufferFromSamples(
  samples: Float32Array,
  sampleRate: number
): AudioBuffer {
  if (typeof AudioBuffer !== 'undefined') {
    const buf = new AudioBuffer({
      length: samples.length,
      numberOfChannels: 1,
      sampleRate,
    });
    buf.getChannelData(0).set(samples);
    return buf;
  }
  const browserWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctx = window.AudioContext || browserWindow.webkitAudioContext;
  if (!Ctx) {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Audio API สำหรับเตรียมเสียง');
  }
  const ctx = new Ctx({ sampleRate });
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.getChannelData(0).set(samples);
  ctx.close().catch(() => {});
  return buf;
}

interface ResolvedAudioConfig {
  buffer: AudioBuffer;
  config: AudioEncoderConfig;
  muxerAudioCodec: 'aac' | 'opus';
  label: string;
}

async function resampleAudioBuffer(
  buffer: AudioBuffer,
  channels: number,
  sampleRate: number
): Promise<AudioBuffer> {
  if (buffer.numberOfChannels === channels && buffer.sampleRate === sampleRate) {
    return buffer;
  }
  if (typeof OfflineAudioContext !== 'undefined') {
    const targetLength = Math.max(1, Math.ceil(buffer.duration * sampleRate));
    const offline = new OfflineAudioContext(channels, targetLength, sampleRate);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    src.connect(offline.destination);
    src.start(0);
    return await offline.startRendering();
  }
  return buffer;
}

async function resolveAudioEncoderAndBuffer(
  buffer: AudioBuffer
): Promise<ResolvedAudioConfig> {
  // Windows Media Foundation and standard WebCodecs support 1 (mono) or 2 (stereo) channels
  const targetChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRates = [buffer.sampleRate, 48000, 44100];
  // Windows Media Foundation AAC strictly supports 96k, 128k, 160k, 192k for stereo; macOS/iOS/Android support up to 320k
  const aacBitrates =
    targetChannels === 1
      ? [128_000, 96_000, 64_000, 160_000, 192_000]
      : [192_000, 160_000, 128_000, 256_000, 320_000, 96_000];

  // 1. Try AAC across candidate sample rates and standard supported bitrates
  for (const sr of sampleRates) {
    for (const bitrate of aacBitrates) {
      const config: AudioEncoderConfig = {
        codec: 'mp4a.40.2',
        numberOfChannels: targetChannels,
        sampleRate: sr,
        bitrate,
      };
      try {
        const support = await AudioEncoder.isConfigSupported(config);
        if (support.supported) {
          const finalBuffer = await resampleAudioBuffer(buffer, targetChannels, sr);
          return {
            buffer: finalBuffer,
            config,
            muxerAudioCodec: 'aac',
            label: `AAC ${Math.round(bitrate / 1000)} kbps`,
          };
        }
      } catch {
        // try next combination
      }
    }
  }

  // 2. High-compatibility fallback: Opus (native in WebCodecs, supported in MP4 by mp4-muxer)
  const opusBitrates = [192_000, 160_000, 128_000, 96_000];
  for (const sr of [48000, buffer.sampleRate]) {
    for (const bitrate of opusBitrates) {
      const config: AudioEncoderConfig = {
        codec: 'opus',
        numberOfChannels: targetChannels,
        sampleRate: sr,
        bitrate,
      };
      try {
        const support = await AudioEncoder.isConfigSupported(config);
        if (support.supported) {
          const finalBuffer = await resampleAudioBuffer(buffer, targetChannels, sr);
          return {
            buffer: finalBuffer,
            config,
            muxerAudioCodec: 'opus',
            label: `Opus ${Math.round(bitrate / 1000)} kbps`,
          };
        }
      } catch {
        // try next
      }
    }
  }

  throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้ารหัสเสียงทั้ง AAC และ Opus ใน WebCodecs');
}

async function resolveH264EncoderConfig(
  width: number,
  height: number,
  fps: number
): Promise<VideoEncoderConfig> {
  const codecs = [
    'avc1.4d002a',
    'avc1.64002a',
    'avc1.42E02A',
    'avc1.4d0032',
    'avc1.640032',
    'avc1.42E032',
  ];
  for (const codec of codecs) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 8_000_000,
      framerate: fps,
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported) {
      return config;
    }
  }
  throw new Error(
    `เบราว์เซอร์นี้ไม่รองรับการเข้ารหัสวิดีโอ H.264 ที่ความละเอียด ${width}×${height} px`
  );
}

export const RenderExportModal: React.FC<RenderExportModalProps> = ({
  isOpen,
  onClose,
  mediaType,
  imageEl,
  videoEl,
  renderDuration,
  trimStartSec,
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
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [progressPct, setProgressPct] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cancelRequestedRef = useRef(false);

  const webCodecsReady = isWebCodecsSupported();

  if (!isOpen) return null;

  const baseSpec = ASPECT_RATIOS[ratio];
  const outW = baseSpec.width;
  const outH = baseSpec.height;
  const exportFilename = `miximage_${ratio.replace(':', 'x')}_${style}_${fps}fps.mp4`;

  const handleClose = () => {
    if (status === 'rendering') {
      cancelRequestedRef.current = true;
      return;
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setStatus('idle');
    setProgressPct(0);
    setStatusText('');
    setErrorMsg(null);
    onClose();
  };

  const handleStartRender = async () => {
    const hasVisualSource = mediaType === 'video' ? Boolean(videoEl) : Boolean(imageEl);
    if (!hasVisualSource || !audioSamples) {
      setErrorMsg('กรุณาเลือกรูปภาพ/วิดีโอและไฟล์เสียงก่อนเริ่มเรนเดอร์');
      setStatus('error');
      return;
    }

    if (!webCodecsReady) {
      setErrorMsg(
        'เบราว์เซอร์นี้ไม่รองรับ WebCodecs API (VideoEncoder / AudioEncoder) กรุณาเปิดด้วย Chrome, Edge หรือ Safari รุ่นใหม่'
      );
      setStatus('error');
      return;
    }

    let videoEncoder: VideoEncoder | null = null;
    let audioEncoder: AudioEncoder | null = null;
    cancelRequestedRef.current = false;

    try {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
      }
      setErrorMsg(null);
      setStatus('rendering');
      setProgressPct(0);
      setStatusText('กำลังเตรียมข้อมูลคลื่นความถี่และตัวเข้ารหัส MP4...');

      const rawAudioBuffer =
        audioBuffer ?? createAudioBufferFromSamples(audioSamples, audioSampleRate);
      if (!Number.isFinite(rawAudioBuffer.duration) || rawAudioBuffer.duration <= 0) {
        throw new Error('ไฟล์เสียงไม่มีความยาวที่ใช้เรนเดอร์ได้');
      }

      const [
        { buffer: finalAudioBuffer, config: audioConfig, muxerAudioCodec, label: audioLabel },
        videoConfig,
      ] = await Promise.all([
        resolveAudioEncoderAndBuffer(rawAudioBuffer),
        resolveH264EncoderConfig(outW, outH, fps),
      ]);

      const dsp: DspAnalysisResult =
        cachedDsp && cachedDsp.fps === fps
          ? cachedDsp
          : analyzeAudioSamples(audioSamples, audioSampleRate, fps, 64);

      const renderSec = renderDuration > 0 ? renderDuration : finalAudioBuffer.duration;
      const totalFrames = Math.max(1, Math.ceil(renderSec * fps));

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: 'avc',
          width: outW,
          height: outH,
          frameRate: fps,
        },
        audio: {
          codec: muxerAudioCodec,
          numberOfChannels: finalAudioBuffer.numberOfChannels,
          sampleRate: finalAudioBuffer.sampleRate,
        },
        fastStart: 'in-memory',
      });

      let encoderError: Error | null = null;

      videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => {
          encoderError = err instanceof Error ? err : new Error(String(err));
        },
      });
      videoEncoder.configure(videoConfig);

      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (err) => {
          encoderError = err instanceof Error ? err : new Error(String(err));
        },
      });
      audioEncoder.configure(audioConfig);

      // 1. Encode full audio track cleanly via WebCodecs AudioEncoder
      setStatusText(`กำลังเข้ารหัสเสียง ${audioLabel}...`);
      const numChannels = finalAudioBuffer.numberOfChannels;
      const sr = finalAudioBuffer.sampleRate;
      const startSample = Math.max(0, Math.min(finalAudioBuffer.length, Math.floor(trimStartSec * sr)));
      const maxAudioSamples = Math.floor(renderSec * sr);
      const totalSamples = Math.min(maxAudioSamples, finalAudioBuffer.length - startSample);
      const chunkSize = 4096;
      const channelDatas: Float32Array[] = [];
      for (let ch = 0; ch < numChannels; ch++) {
        channelDatas.push(finalAudioBuffer.getChannelData(ch));
      }

      for (let offset = 0; offset < totalSamples; offset += chunkSize) {
        if (encoderError) throw encoderError;
        if (cancelRequestedRef.current) throw new Error('ยกเลิกการเรนเดอร์แล้ว');

        const framesInChunk = Math.min(chunkSize, totalSamples - offset);
        const sampleOffset = startSample + offset;
        const planar = new Float32Array(framesInChunk * numChannels);
        for (let ch = 0; ch < numChannels; ch++) {
          planar.set(
            channelDatas[ch].subarray(sampleOffset, sampleOffset + framesInChunk),
            ch * framesInChunk
          );
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: sr,
          numberOfFrames: framesInChunk,
          numberOfChannels: numChannels,
          timestamp: Math.round((offset / sr) * 1_000_000),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();

        if (audioEncoder.encodeQueueSize > 16) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      await audioEncoder.flush();
      if (encoderError) throw encoderError;
      setProgressPct(5);

      // 2. Offline frame-by-frame Canvas -> VideoFrame -> VideoEncoder loop
      const source = mediaType === 'video' ? videoEl! : imageEl!;
      const surface = createRenderSurface(source, outW, outH, fitMode);
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = outW;
      renderCanvas.height = outH;
      const renderCtx = renderCanvas.getContext('2d', { alpha: false });
      if (!renderCtx) throw new Error('สร้าง Canvas สำหรับเรนเดอร์ไม่สำเร็จ');

      const specCol = new Float32Array(64);
      const frameDurationUs = Math.round(1_000_000 / fps);
      const keyFrameInterval = fps * 2;

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (encoderError) throw encoderError;
        if (cancelRequestedRef.current) throw new Error('ยกเลิกการเรนเดอร์แล้ว');

        const t = frameIdx / fps;

        if (mediaType === 'video' && videoEl) {
          const videoTime = Math.min(
            videoEl.duration || 0,
            trimStartSec + t
          );
          if (Math.abs(videoEl.currentTime - videoTime) > 0.005) {
            await new Promise<void>((resolve) => {
              let tid: any;
              const onSeeked = () => {
                clearTimeout(tid);
                videoEl.removeEventListener('seeked', onSeeked);
                resolve();
              };
              videoEl.addEventListener('seeked', onSeeked);
              videoEl.currentTime = videoTime;
              tid = setTimeout(() => {
                videoEl.removeEventListener('seeked', onSeeked);
                resolve();
              }, 300);
            });
          }
          updateRenderSurfaceBase(
            surface,
            videoEl,
            videoEl.videoWidth || outW,
            videoEl.videoHeight || outH,
            fitMode
          );
        }

        const { bassVal, onsetFlux } = sampleDspAtTime(dsp, trimStartSec + t, specCol);

        renderStudioFrame(
          renderCtx,
          surface,
          specCol,
          bassVal,
          style,
          theme,
          bassIntensity,
          frameIdx,
          waveformLayout,
          onsetFlux,
          colorMix
        );

        const videoFrame = new VideoFrame(renderCanvas, {
          timestamp: Math.round(t * 1_000_000),
          duration: frameDurationUs,
        });
        videoEncoder.encode(videoFrame, {
          keyFrame: frameIdx % keyFrameInterval === 0,
        });
        videoFrame.close();

        if (frameIdx % 15 === 0 || frameIdx === totalFrames - 1) {
          const pct = Math.min(98, 5 + Math.round(((frameIdx + 1) / totalFrames) * 93));
          setProgressPct(pct);
          setStatusText(
            `กำลังเรนเดอร์เฟรมที่ ${frameIdx + 1} / ${totalFrames} (${outW}×${outH} px)...`
          );
          await new Promise((r) => setTimeout(r, 0));
        }

        while (videoEncoder.encodeQueueSize > 12) {
          await new Promise((r) => setTimeout(r, 4));
        }
      }

      setStatusText('กำลังประกอบไฟล์ MP4 ขั้นสุดท้าย...');
      await videoEncoder.flush();
      if (encoderError) throw encoderError;

      muxer.finalize();

      const { buffer } = muxer.target;
      const mp4Blob = new Blob([buffer], { type: 'video/mp4' });
      if (mp4Blob.size === 0) {
        throw new Error('ไม่สามารถสร้างไฟล์ MP4 ได้ กรุณาลองใหม่อีกครั้ง');
      }

      const url = URL.createObjectURL(mp4Blob);
      setVideoUrl(url);
      setProgressPct(100);
      setStatus('done');
      setStatusText(
        `เรนเดอร์วิดีโอ .MP4 (${outW}×${outH} px · ${totalFrames} เฟรม) เสร็จสมบูรณ์`
      );

      // Trigger automatic download of the video/mp4 Blob
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setStatus('error');
      setErrorMsg(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างเรนเดอร์วิดีโอ MP4'
      );
    } finally {
      if (videoEncoder && videoEncoder.state !== 'closed') {
        try {
          videoEncoder.close();
        } catch {
          // Ignore already closed encoder
        }
      }
      if (audioEncoder && audioEncoder.state !== 'closed') {
        try {
          audioEncoder.close();
        } catch {
          // Ignore already closed encoder
        }
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
              เรนเดอร์วิดีโอ MP4 แบบเฟรมต่อเฟรม (1080p)
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={isBusy ? 'ยกเลิกการเรนเดอร์' : 'ปิดหน้าต่างเรนเดอร์'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          <div
            role="status"
            className={`rounded-lg border p-3 text-xs leading-relaxed ${
              !webCodecsReady
                ? 'border-rose-900/60 bg-rose-950/30 text-rose-300'
                : 'border-emerald-900/60 bg-emerald-950/25 text-emerald-300'
            }`}
          >
            {!webCodecsReady
              ? 'เบราว์เซอร์นี้ไม่รองรับ WebCodecs API (VideoEncoder / AudioEncoder) กรุณาเปิดด้วย Chrome, Edge หรือ Safari รุ่นใหม่'
              : `เรนเดอร์ออฟไลน์ทีละเฟรมด้วย WebCodecs (H.264 8 Mbps + สเตอริโอความละเอียดสูง) ความละเอียดเต็ม 1080p (${outW}×${outH} px) และความยาวตรงกับเพลง 100%`}
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 flex flex-wrap gap-x-4 gap-y-1.5 font-mono tabular-nums">
            <span>สื่อ: {mediaType === 'video' ? 'วิดีโอพื้นหลัง' : 'ภาพนิ่ง'}</span>
            <span>ความยาว: {formatTime(renderDuration > 0 ? renderDuration : (cachedDsp?.durationSec ?? 16))}</span>
            {trimStartSec > 0 && (
              <span>ช่วง: {formatTime(trimStartSec)} - {formatTime(trimStartSec + (renderDuration > 0 ? renderDuration : 0))}</span>
            )}
            <span>อัตราส่วน: {ratio}</span>
            <span>ขนาด: {outW}×{outH} px (1080p)</span>
            <span>FPS: {fps}</span>
            <span>คลื่น: {style}</span>
            <span>สี: {theme}</span>
            <span>เบส: {bassIntensity.toFixed(1)}x</span>
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

          {status === 'done' && videoUrl && (
            <div className="flex flex-col gap-3">
              <video
                src={videoUrl}
                controls
                className="w-full max-h-[260px] rounded-lg border border-slate-800 bg-black"
              />
              <a
                href={videoUrl}
                download={exportFilename}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>ดาวน์โหลดไฟล์ .MP4</span>
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

          <div className="flex items-center justify-end gap-3 pt-1 border-t border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-xs font-medium text-slate-200 transition-colors"
            >
              {isBusy ? 'ยกเลิกเรนเดอร์' : 'ปิด'}
            </button>
            {(status === 'idle' || status === 'error') && (
              <button
                type="button"
                onClick={handleStartRender}
                disabled={!webCodecsReady}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
