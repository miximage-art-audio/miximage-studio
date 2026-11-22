import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArchitectureGuideView } from './components/ArchitectureGuideView';
import { CloudPipelineView } from './components/CloudPipelineView';
import { ControlRail } from './components/ControlRail';
import { RenderExportModal } from './components/RenderExportModal';
import { StudioStage } from './components/StudioStage';
import { TopBar, WorkspaceTab } from './components/TopBar';
import {
  DspAnalysisResult,
  analyzeAudioSamples,
  generateDemoBassTrack,
  sampleDspAtTime,
} from './engine/dsp';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformColorMix,
  WaveformLayoutConfig,
  WaveformStyle,
  getDefaultWaveformLayout,
  getThemeColorMix,
} from './engine/presets';
import { DEMO_ARTWORKS } from './engine/demoArtworks';
import {
  RenderSurface,
  createRenderSurface,
  renderStudioFrame,
  updateRenderSurfaceBase,
} from './engine/renderer';

function getPreviewDimensions(ratio: AspectRatioKey): { w: number; h: number } {
  const spec = ASPECT_RATIOS[ratio];
  return {
    w: spec.width,
    h: spec.height,
  };
}

function mixAudioBufferToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [isRenderModalOpen, setIsRenderModalOpen] = useState(false);

  // Media state (Image or Video)
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [selectedArtworkId, setSelectedArtworkId] = useState<string>(DEMO_ARTWORKS[0].id);
  const [customImageName, setCustomImageName] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string>(DEMO_ARTWORKS[0].src);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  // Video State
  const [loadedVideo, setLoadedVideo] = useState<HTMLVideoElement | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [customDuration, setCustomDuration] = useState<number | null>(null);
  const [trimStartSec, setTrimStartSec] = useState<number>(0);
  const customVideoUrlRef = useRef<string | null>(null);

  const [audioName, setAudioName] = useState<string>('Demo Bass Track (128 BPM · 16s)');
  const [isDemoAudio, setIsDemoAudio] = useState<boolean>(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(true);

  const [ratio, setRatio] = useState<AspectRatioKey>('16:9');
  const [fitMode, setFitMode] = useState<FitMode>('cover');
  const [style, setStyle] = useState<WaveformStyle>('bars_3d');
  const [theme, setTheme] = useState<ColorThemeKey>('cyberpunk');
  const [colorMix, setColorMix] = useState<WaveformColorMix>(() =>
    getThemeColorMix('cyberpunk')
  );
  const [bassIntensity, setBassIntensity] = useState<number>(1.0);
  const [fps, setFps] = useState<FpsOption>(30);
  const [waveformLayout, setWaveformLayout] = useState<WaveformLayoutConfig>(() =>
    getDefaultWaveformLayout('bars_3d')
  );
  const hasCustomPosRef = useRef<boolean>(false);

  // Audio + DSP Data
  const [audioSamples, setAudioSamples] = useState<Float32Array | null>(null);
  const [audioSampleRate, setAudioSampleRate] = useState<number>(44100);
  const [audioBufferForRender, setAudioBufferForRender] = useState<AudioBuffer | null>(null);
  const [dspResult, setDspResult] = useState<DspAnalysisResult | null>(null);

  // Duration calculations
  const maxAvailableDuration = useMemo(() => {
    if (mediaType === 'video' && videoDuration > 0) {
      return videoDuration;
    }
    return dspResult?.durationSec ?? 16;
  }, [mediaType, videoDuration, dspResult?.durationSec]);

  const effectiveDuration = useMemo(() => {
    const available = Math.max(0.5, maxAvailableDuration - trimStartSec);
    if (customDuration !== null && customDuration > 0) {
      return Math.max(0.5, Math.min(customDuration, available));
    }
    return available;
  }, [maxAvailableDuration, trimStartSec, customDuration]);

  // Playback UI State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentBassVal, setCurrentBassVal] = useState<number>(0);
  const [currentOnsetFlux, setCurrentOnsetFlux] = useState<number>(0);

  // Refs for smooth animation & Web Audio playback
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<RenderSurface | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  const playStateRef = useRef({
    isPlaying: false,
    startedAtCtxTime: 0,
    offsetSec: 0,
    durationSec: 16,
  });

  useEffect(() => {
    playStateRef.current.durationSec = effectiveDuration;
  }, [effectiveDuration]);

  const paramsRef = useRef({
    style,
    theme,
    colorMix,
    bassIntensity,
    fps,
    dspResult,
    waveformLayout,
    mediaType,
    trimStartSec,
  });

  paramsRef.current = {
    style,
    theme,
    colorMix,
    bassIntensity,
    fps,
    dspResult,
    waveformLayout,
    mediaType,
    trimStartSec,
  };

  const customImgUrlRef = useRef<string | null>(null);

  // 1. Load artwork image into HTMLImageElement
  useEffect(() => {
    if (mediaType !== 'image') return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!cancelled) {
        setLoadedImage(img);
      }
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc, mediaType]);

  // 2. Rebuild preview RenderSurface when media, ratio, or fitMode changes
  useEffect(() => {
    if (!canvasRef.current) return;
    const { w, h } = getPreviewDimensions(ratio);
    canvasRef.current.width = w;
    canvasRef.current.height = h;

    if (mediaType === 'video') {
      if (loadedVideo && loadedVideo.videoWidth > 0 && loadedVideo.videoHeight > 0) {
        surfaceRef.current = createRenderSurface(loadedVideo, w, h, fitMode);
      }
    } else {
      if (loadedImage) {
        surfaceRef.current = createRenderSurface(loadedImage, w, h, fitMode);
      }
    }
  }, [mediaType, loadedImage, loadedVideo, ratio, fitMode, activeTab]);

  // 3. Helper to stop Web Audio & video playback cleanly
  const stopAudioSource = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore already-stopped AudioBufferSourceNode
      }
      sourceNodeRef.current = null;
    }
    if (loadedVideo) {
      try {
        loadedVideo.pause();
      } catch {
        // Ignore video pause error
      }
    }
  }, [loadedVideo]);

  // 4. Load deterministic Demo Bass Track on initial mount
  const loadDemoAudio = useCallback(() => {
    stopAudioSource();
    setAudioBufferForRender(null);
    setIsPlaying(false);
    playStateRef.current.isPlaying = false;
    playStateRef.current.offsetSec = 0;
    setCurrentTime(0);
    setAudioError(null);
    setIsAnalyzing(true);

    setTimeout(() => {
      const sr = 44100;
      const samples = generateDemoBassTrack(16, sr);

      audioBufferRef.current = null; // Hydrated lazily on Play via AudioContext
      setAudioSamples(samples);
      setAudioSampleRate(sr);
      setAudioName('Demo Bass Track (128 BPM · 16s)');
      setIsDemoAudio(true);
      setIsAnalyzing(false);
    }, 20);
  }, [stopAudioSource]);

  useEffect(() => {
    loadDemoAudio();
    return () => {
      stopAudioSource();
      if (customImgUrlRef.current) URL.revokeObjectURL(customImgUrlRef.current);
      if (customVideoUrlRef.current) URL.revokeObjectURL(customVideoUrlRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [loadDemoAudio, stopAudioSource]);

  // 5. Re-run DSP analysis whenever audioSamples, sampleRate, or fps changes
  useEffect(() => {
    if (!audioSamples) return;
    setIsAnalyzing(true);
    const timer = setTimeout(() => {
      const result = analyzeAudioSamples(audioSamples, audioSampleRate, fps, 64);
      setDspResult(result);
      setIsAnalyzing(false);
    }, 10);
    return () => clearTimeout(timer);
  }, [audioSamples, audioSampleRate, fps]);

  // 6. Render a single frame for a given playback time
  const drawFrameAtTime = useCallback(
    (timeSec: number) => {
      const canvas = canvasRef.current;
      const surface = surfaceRef.current;
      const {
        dspResult: dsp,
        style: s,
        theme: t,
        colorMix: cMix,
        bassIntensity: bInt,
        waveformLayout: wfLayout,
        mediaType: mType,
        trimStartSec: tStart,
      } = paramsRef.current;
      if (!canvas || !surface || !dsp) return { bassVal: 0, onsetFlux: 0 };

      const ctx = canvas.getContext('2d');
      if (!ctx) return { bassVal: 0, onsetFlux: 0 };

      // Update background frame if video is active
      if (mType === 'video' && loadedVideo && loadedVideo.videoWidth > 0 && loadedVideo.videoHeight > 0) {
        const targetVideoTime = Math.max(0, tStart + timeSec);
        if (
          Math.abs(loadedVideo.currentTime - targetVideoTime) > 0.08 ||
          !playStateRef.current.isPlaying
        ) {
          try {
            loadedVideo.currentTime = targetVideoTime;
          } catch {
            // ignore seek errors
          }
        }
        updateRenderSurfaceBase(
          surface,
          loadedVideo,
          loadedVideo.videoWidth,
          loadedVideo.videoHeight,
          fitMode
        );
      }

      // Sample audio DSP at matching time
      const audioTime = isDemoAudio ? timeSec % (dsp.durationSec || 16) : timeSec;
      const specCol = new Float32Array(64);
      const { bassVal, onsetFlux, exactFrame } = sampleDspAtTime(dsp, audioTime, specCol);

      renderStudioFrame(
        ctx,
        surface,
        specCol,
        bassVal,
        s,
        t,
        bInt,
        exactFrame,
        wfLayout,
        onsetFlux,
        cMix
      );
      return { bassVal, onsetFlux };
    },
    [fitMode, isDemoAudio, loadedVideo]
  );

  // Re-draw static preview immediately whenever parameters, surface, or seek time change while paused
  useEffect(() => {
    if (activeTab !== 'studio' || playStateRef.current.isPlaying) return;
    const { bassVal, onsetFlux } = drawFrameAtTime(playStateRef.current.offsetSec);
    setCurrentBassVal(bassVal);
    setCurrentOnsetFlux(onsetFlux);
  }, [
    activeTab,
    mediaType,
    loadedImage,
    loadedVideo,
    ratio,
    fitMode,
    style,
    theme,
    colorMix,
    bassIntensity,
    fps,
    waveformLayout,
    dspResult,
    currentTime,
    trimStartSec,
    drawFrameAtTime,
  ]);

  // 7. Continuous animation loop when playing
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastUiSync = 0;

    const tick = (now: number) => {
      const state = playStateRef.current;
      if (!state.isPlaying) return;

      let elapsed = state.offsetSec;
      if (audioCtxRef.current && audioBufferRef.current) {
        elapsed =
          state.offsetSec +
          (audioCtxRef.current.currentTime - state.startedAtCtxTime);
      } else {
        // Fallback wall-clock progression if AudioContext unavailable
        elapsed += 1 / 60;
        state.offsetSec = elapsed;
      }

      if (elapsed >= state.durationSec) {
        stopAudioSource();
        state.isPlaying = false;
        state.offsetSec = 0;
        setIsPlaying(false);
        setCurrentTime(0);
        const { bassVal, onsetFlux } = drawFrameAtTime(0);
        setCurrentBassVal(bassVal);
        setCurrentOnsetFlux(onsetFlux);
        return;
      }

      const { bassVal, onsetFlux } = drawFrameAtTime(elapsed);

      if (now - lastUiSync > 60) {
        lastUiSync = now;
        setCurrentTime(elapsed);
        setCurrentBassVal(bassVal);
        setCurrentOnsetFlux(onsetFlux);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, drawFrameAtTime, stopAudioSource]);

  // 8. Ensure AudioContext + AudioBuffer exist for playback
  const ensureAudioReady = useCallback(async () => {
    if (!audioSamples) return null;
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.gain.value = isMuted ? 0 : 1;
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }

    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume().catch(() => {});
    }

    if (!audioBufferRef.current) {
      const buf = audioCtxRef.current.createBuffer(
        1,
        audioSamples.length,
        audioSampleRate
      );
      buf.getChannelData(0).set(audioSamples);
      audioBufferRef.current = buf;
    }

    return audioCtxRef.current;
  }, [audioSamples, audioSampleRate, isMuted]);

  const startPlaybackAt = useCallback(
    async (offsetSec: number) => {
      const ctx = await ensureAudioReady();
      stopAudioSource();

      if (ctx && audioBufferRef.current && gainNodeRef.current) {
        const src = ctx.createBufferSource();
        src.buffer = audioBufferRef.current;
        src.loop = isDemoAudio;
        src.connect(gainNodeRef.current);
        const clamped = Math.max(
          0,
          Math.min(offsetSec, Math.max(0, audioBufferRef.current.duration - 0.05))
        );
        src.start(0, isDemoAudio ? offsetSec % audioBufferRef.current.duration : clamped);
        sourceNodeRef.current = src;
        playStateRef.current.startedAtCtxTime = ctx.currentTime;
        playStateRef.current.offsetSec = offsetSec;
      } else {
        playStateRef.current.offsetSec = offsetSec;
      }

      if (mediaType === 'video' && loadedVideo) {
        try {
          loadedVideo.currentTime = Math.max(0, trimStartSec + offsetSec);
          loadedVideo.play().catch(() => {});
        } catch {
          // ignore play error
        }
      }

      playStateRef.current.isPlaying = true;
      setIsPlaying(true);
    },
    [ensureAudioReady, isDemoAudio, loadedVideo, mediaType, stopAudioSource, trimStartSec]
  );

  const handleTogglePlay = useCallback(() => {
    if (!dspResult) return;
    if (playStateRef.current.isPlaying) {
      let currentPos = playStateRef.current.offsetSec;
      if (audioCtxRef.current) {
        currentPos =
          playStateRef.current.offsetSec +
          (audioCtxRef.current.currentTime - playStateRef.current.startedAtCtxTime);
      }
      stopAudioSource();
      playStateRef.current.isPlaying = false;
      playStateRef.current.offsetSec = Math.min(currentPos, effectiveDuration);
      setIsPlaying(false);
      setCurrentTime(playStateRef.current.offsetSec);
    } else {
      const startAt =
        playStateRef.current.offsetSec >= effectiveDuration - 0.1
          ? 0
          : playStateRef.current.offsetSec;
      startPlaybackAt(startAt);
    }
  }, [dspResult, effectiveDuration, startPlaybackAt, stopAudioSource]);

  const handleRestart = useCallback(() => {
    if (playStateRef.current.isPlaying) {
      startPlaybackAt(0);
    } else {
      playStateRef.current.offsetSec = 0;
      setCurrentTime(0);
      if (loadedVideo) {
        loadedVideo.currentTime = trimStartSec;
      }
      const { bassVal, onsetFlux } = drawFrameAtTime(0);
      setCurrentBassVal(bassVal);
      setCurrentOnsetFlux(onsetFlux);
    }
  }, [drawFrameAtTime, loadedVideo, startPlaybackAt, trimStartSec]);

  const handleSeek = useCallback(
    (timeSec: number) => {
      const clamped = Math.max(0, Math.min(timeSec, effectiveDuration));
      playStateRef.current.offsetSec = clamped;
      setCurrentTime(clamped);
      if (playStateRef.current.isPlaying) {
        startPlaybackAt(clamped);
      } else {
        const { bassVal, onsetFlux } = drawFrameAtTime(clamped);
        setCurrentBassVal(bassVal);
        setCurrentOnsetFlux(onsetFlux);
      }
    },
    [drawFrameAtTime, effectiveDuration, startPlaybackAt]
  );

  const handleToggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = next ? 0 : 1;
    }
  }, [isMuted]);

  // 9. Handle Artwork / Image / Video / Audio Uploads
  const handleSelectDemoArtwork = (id: string) => {
    const found = DEMO_ARTWORKS.find((a) => a.id === id);
    if (!found) return;
    setMediaType('image');
    if (loadedVideo) {
      loadedVideo.pause();
      setLoadedVideo(null);
    }
    setCustomDuration(null);
    setTrimStartSec(0);
    setSelectedArtworkId(id);
    setCustomImageName(null);
    setImageSrc(found.src);
  };

  const handleUploadImage = (file: File) => {
    if (customImgUrlRef.current) {
      URL.revokeObjectURL(customImgUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    customImgUrlRef.current = url;
    setMediaType('image');
    if (loadedVideo) {
      loadedVideo.pause();
      setLoadedVideo(null);
    }
    setCustomDuration(null);
    setTrimStartSec(0);
    setSelectedArtworkId('custom');
    setCustomImageName(file.name);
    setImageSrc(url);
  };

  const handleUploadVideo = useCallback(
    async (file: File) => {
      stopAudioSource();
      if (customVideoUrlRef.current) {
        URL.revokeObjectURL(customVideoUrlRef.current);
      }

      const url = URL.createObjectURL(file);
      customVideoUrlRef.current = url;

      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.muted = true;
      video.preload = 'auto';
      video.src = url;

      video.onloadedmetadata = async () => {
        const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 16;
        setVideoDuration(dur);
        setCustomDuration(dur); // Default duration follows actual video length!
        setTrimStartSec(0);
        setLoadedVideo(video);
        setMediaType('video');
        setSelectedArtworkId('custom-video');
        setCustomImageName(file.name);

        video.currentTime = 0;

        // Try extracting audio track directly from the video file
        try {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const decodeCtx = audioCtxRef.current || new Ctx({ sampleRate: 44100 });
          if (!audioCtxRef.current) {
            audioCtxRef.current = decodeCtx;
            gainNodeRef.current = decodeCtx.createGain();
            gainNodeRef.current.gain.value = isMuted ? 0 : 1;
            gainNodeRef.current.connect(decodeCtx.destination);
          }

          const rawBytes = await file.arrayBuffer();
          const decodedBuffer = await decodeCtx.decodeAudioData(rawBytes.slice(0));
          if (decodedBuffer && decodedBuffer.length > 0 && decodedBuffer.duration > 0) {
            const mono = mixAudioBufferToMono(decodedBuffer);
            audioBufferRef.current = decodedBuffer;
            setAudioBufferForRender(decodedBuffer);
            setAudioSamples(mono);
            setAudioSampleRate(decodedBuffer.sampleRate);
            setAudioName(`${file.name} (Audio)`);
            setIsDemoAudio(false);
          }
        } catch {
          // Keep current audio track if video lacks audio
        }

        setCurrentTime(0);
        playStateRef.current.offsetSec = 0;
      };
    },
    [isMuted, stopAudioSource]
  );

  const handleUploadAudio = async (file: File) => {
    stopAudioSource();
    setAudioBufferForRender(null);
    audioBufferRef.current = null;
    setAudioSamples(null);
    setDspResult(null);
    setIsPlaying(false);
    playStateRef.current.isPlaying = false;
    playStateRef.current.offsetSec = 0;
    setCurrentTime(0);
    setAudioError(null);
    setIsAnalyzing(true);

    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const decodeCtx = audioCtxRef.current || new Ctx({ sampleRate: 44100 });
      if (!audioCtxRef.current) {
        audioCtxRef.current = decodeCtx;
        gainNodeRef.current = decodeCtx.createGain();
        gainNodeRef.current.gain.value = isMuted ? 0 : 1;
        gainNodeRef.current.connect(decodeCtx.destination);
      }

      let decodedBuffer: AudioBuffer | null = null;
      try {
        const rawBytes = await file.arrayBuffer();
        decodedBuffer = await decodeCtx.decodeAudioData(rawBytes.slice(0));
      } catch {
        // Fallback to server Universal Audio Pipeline when server is running
        const form = new FormData();
        form.append('audio', file);
        const res = await fetch('/api/decode-audio', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          throw new Error('เบราว์เซอร์อ่านไฟล์เสียงนี้ไม่ได้ กรุณาใช้ MP3 หรือ WAV PCM ที่รองรับ');
        }
        const wavBytes = await res.arrayBuffer();
        decodedBuffer = await decodeCtx.decodeAudioData(wavBytes);
      }

      if (!decodedBuffer || !decodedBuffer.length || decodedBuffer.duration <= 0) {
        throw new Error('ไฟล์เสียงไม่มีข้อมูล');
      }

      const mono = mixAudioBufferToMono(decodedBuffer);
      audioBufferRef.current = decodedBuffer;
      setAudioBufferForRender(decodedBuffer);
      setAudioSamples(mono);
      setAudioSampleRate(decodedBuffer.sampleRate);
      setAudioName(file.name);
      setIsDemoAudio(false);
    } catch (err) {
      setAudioError(
        err instanceof Error
          ? err.message
          : 'เบราว์เซอร์อ่านไฟล์เสียงนี้ไม่ได้ กรุณาใช้ MP3 หรือ WAV PCM ที่รองรับ'
      );
      setIsAnalyzing(false);
    }
  };

  const handleChangeStyle = (nextStyle: WaveformStyle) => {
    setStyle(nextStyle);
    if (!hasCustomPosRef.current) {
      const def = getDefaultWaveformLayout(nextStyle);
      setWaveformLayout((prev) => ({ ...prev, posX: def.posX, posY: def.posY }));
    }
  };

  const handleChangeTheme = (nextTheme: ColorThemeKey) => {
    setTheme(nextTheme);
    setColorMix(getThemeColorMix(nextTheme));
  };

  const handleChangeWaveformLayout = (next: WaveformLayoutConfig) => {
    hasCustomPosRef.current = true;
    setWaveformLayout(next);
  };

  const handleResetWaveformLayout = () => {
    hasCustomPosRef.current = false;
    setWaveformLayout(getDefaultWaveformLayout(style));
  };

  const workflowDefaults = useMemo(
    () => ({
      ratio,
      style,
      theme,
      bass: bassIntensity,
      fit: fitMode,
      fps,
      layout: waveformLayout,
    }),
    [ratio, style, theme, bassIntensity, fitMode, fps, waveformLayout]
  );

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-[#090D16] text-slate-100 flex flex-col">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenRenderModal={() => setIsRenderModalOpen(true)}
        isRendering={false}
        canRender={
          !isAnalyzing &&
          ((mediaType === 'image' && Boolean(loadedImage)) ||
            (mediaType === 'video' && Boolean(loadedVideo))) &&
          Boolean(audioSamples)
        }
      />

      <main
        className={`flex-1 min-h-0 w-full max-w-[1440px] mx-auto px-4 sm:px-6 ${
          activeTab === 'studio'
            ? 'py-3 lg:py-3.5 lg:overflow-hidden'
            : 'py-6 lg:overflow-y-auto'
        }`}
      >
        {activeTab === 'studio' && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_520px] xl:grid-cols-[minmax(0,1fr)_560px] gap-4 lg:h-full min-h-0 items-stretch">
            <div className="min-h-0 lg:h-full flex flex-col">
              <StudioStage
                canvasRef={canvasRef}
                ratio={ratio}
                fitMode={fitMode}
                style={style}
                theme={theme}
                fps={fps}
                bassIntensity={bassIntensity}
                waveformLayout={waveformLayout}
                isPlaying={isPlaying}
                isMuted={isMuted}
                isAnalyzing={isAnalyzing}
                audioName={audioName}
                currentTime={currentTime}
                duration={effectiveDuration}
                currentBassVal={currentBassVal}
                currentOnsetFlux={currentOnsetFlux}
                totalFrames={Math.max(1, Math.round(effectiveDuration * fps))}
                peakBassFrames={dspResult?.peakBassFrames ?? 0}
                onTogglePlay={handleTogglePlay}
                onRestart={handleRestart}
                onToggleMute={handleToggleMute}
                onSeek={handleSeek}
                onChangeWaveformLayout={handleChangeWaveformLayout}
              />
            </div>

            <div className="min-h-0 lg:h-full flex flex-col">
              <ControlRail
                selectedArtworkId={selectedArtworkId}
                customImageName={customImageName}
                audioName={audioName}
                isDemoAudio={isDemoAudio}
                ratio={ratio}
                fitMode={fitMode}
                style={style}
                theme={theme}
                colorMix={colorMix}
                bassIntensity={bassIntensity}
                fps={fps}
                waveformLayout={waveformLayout}
                audioError={audioError}
                mediaType={mediaType}
                videoDuration={videoDuration}
                customDuration={customDuration}
                trimStartSec={trimStartSec}
                onSelectDemoArtwork={handleSelectDemoArtwork}
                onUploadImage={handleUploadImage}
                onUploadVideo={handleUploadVideo}
                onChangeCustomDuration={setCustomDuration}
                onChangeTrimStartSec={setTrimStartSec}
                onUseDemoAudio={loadDemoAudio}
                onUploadAudio={handleUploadAudio}
                onChangeRatio={setRatio}
                onChangeFitMode={setFitMode}
                onChangeStyle={handleChangeStyle}
                onChangeTheme={handleChangeTheme}
                onChangeColorMix={setColorMix}
                onChangeBassIntensity={setBassIntensity}
                onChangeFps={setFps}
                onChangeWaveformLayout={handleChangeWaveformLayout}
                onResetWaveformLayout={handleResetWaveformLayout}
              />
            </div>
          </div>
        )}

        {activeTab === 'code' && <CloudPipelineView defaults={workflowDefaults} />}

        {(activeTab === 'architecture' || activeTab === 'guide') && (
          <ArchitectureGuideView
            mode={activeTab}
            onSwitchToCode={() => setActiveTab('code')}
          />
        )}
      </main>

      <RenderExportModal
        isOpen={isRenderModalOpen}
        onClose={() => setIsRenderModalOpen(false)}
        mediaType={mediaType}
        imageEl={loadedImage}
        videoEl={loadedVideo}
        renderDuration={effectiveDuration}
        trimStartSec={trimStartSec}
        audioSamples={audioSamples}
        audioBuffer={audioBufferForRender}
        audioSampleRate={audioSampleRate}
        cachedDsp={dspResult}
        ratio={ratio}
        fitMode={fitMode}
        style={style}
        theme={theme}
        colorMix={colorMix}
        bassIntensity={bassIntensity}
        fps={fps}
        waveformLayout={waveformLayout}
      />
    </div>
  );
}
