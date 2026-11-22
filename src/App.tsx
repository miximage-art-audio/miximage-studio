import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArchitectureGuideView } from './components/ArchitectureGuideView';
import { CloudPipelineView } from './components/CloudPipelineView';
import { ControlRail } from './components/ControlRail';
import { RenderExportModal } from './components/RenderExportModal';
import { StudioStage } from './components/StudioStage';
import { LyricsPanel } from './components/LyricsPanel';
import { autoSyncLyrics, DEFAULT_SUBTITLE_STYLE, LyricCue, SubtitleStyle } from './engine/lyrics';
import { drawLyricsOverlay } from './engine/renderLyrics';
import { TopBar, WorkspaceTab } from './components/TopBar';
import {
  DspAnalysisResult,
  analyzeAudioSamples,
  generateDemoBassTrack,
} from './engine/dsp';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformLayoutConfig,
  WaveformStyle,
  getDefaultWaveformLayout,
} from './engine/presets';
import { DEMO_ARTWORKS } from './engine/demoArtworks';
import {
  RenderSurface,
  createRenderSurface,
  renderStudioFrame,
} from './engine/renderer';

function getPreviewDimensions(ratio: AspectRatioKey): { w: number; h: number } {
  const spec = ASPECT_RATIOS[ratio];
  const maxDim = 960;
  const scale = maxDim / Math.max(spec.width, spec.height);
  return {
    w: Math.round(spec.width * scale),
    h: Math.round(spec.height * scale),
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

  // Studio Parameters
  const [selectedArtworkId, setSelectedArtworkId] = useState<string>(DEMO_ARTWORKS[0].id);
  const [customImageName, setCustomImageName] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string>(DEMO_ARTWORKS[0].src);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  const [audioName, setAudioName] = useState<string>('Demo Bass Track (128 BPM · 16s)');
  const [isDemoAudio, setIsDemoAudio] = useState<boolean>(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(true);

  const [ratio, setRatio] = useState<AspectRatioKey>('16:9');
  const [fitMode, setFitMode] = useState<FitMode>('cover');
  const [style, setStyle] = useState<WaveformStyle>('bars_3d');
  const [theme, setTheme] = useState<ColorThemeKey>('cyberpunk');
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

  // Playback UI State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0.48);
  const [currentBassVal, setCurrentBassVal] = useState<number>(0);

  const [lyricCues, setLyricCues] = useState<LyricCue[]>([]);
  const [lyricsText, setLyricsText] = useState('');
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);

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
    offsetSec: 0.48,
    durationSec: 16,
  });

  const paramsRef = useRef({
    style,
    theme,
    bassIntensity,
    fps,
    dspResult,
    waveformLayout,
    lyricCues,
    subtitleStyle,
  });
  paramsRef.current = { style, theme, bassIntensity, fps, dspResult, waveformLayout, lyricCues, subtitleStyle };

  const customImgUrlRef = useRef<string | null>(null);

  // 1. Load artwork image into HTMLImageElement
  useEffect(() => {
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
  }, [imageSrc]);

  // 2. Rebuild preview RenderSurface when image, ratio, or fitMode changes
  useEffect(() => {
    if (!loadedImage || !canvasRef.current) return;
    const { w, h } = getPreviewDimensions(ratio);
    canvasRef.current.width = w;
    canvasRef.current.height = h;
    surfaceRef.current = createRenderSurface(loadedImage, w, h, fitMode);
  }, [loadedImage, ratio, fitMode, activeTab]);

  // 3. Helper to stop Web Audio playback cleanly
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
  }, []);

  // 4. Load deterministic Demo Bass Track on initial mount
  const loadDemoAudio = useCallback(() => {
    stopAudioSource();
    setAudioBufferForRender(null);
    setIsPlaying(false);
    playStateRef.current.isPlaying = false;
    playStateRef.current.offsetSec = 0.48;
    setCurrentTime(0.48);
    setAudioError(null);
    setIsAnalyzing(true);

    setTimeout(() => {
      const sr = 44100;
      const samples = generateDemoBassTrack(16, sr);

      audioBufferRef.current = null; // Will be hydrated lazily on Play via AudioContext
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
      playStateRef.current.durationSec = result.durationSec;
      setIsAnalyzing(false);
    }, 10);
    return () => clearTimeout(timer);
  }, [audioSamples, audioSampleRate, fps]);

  useEffect(() => {
    if (audioSamples) {
      setLyricCues(cues => cues.length ? autoSyncLyrics(cues.map(cue => cue.text), audioSamples, audioSampleRate) : cues);
    }
  }, [audioSamples, audioSampleRate]);

  // 6. Render a single frame for a given playback time
  const drawFrameAtTime = useCallback((timeSec: number) => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    const {
      dspResult: dsp,
      style: s,
      theme: t,
      bassIntensity: bInt,
      fps: curFps,
      waveformLayout: wfLayout,
    } = paramsRef.current;
    if (!canvas || !surface || !dsp) return 0;

    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;

    const exactFrame = Math.min(
      dsp.totalFrames - 1,
      Math.max(0, timeSec * curFps)
    );
    const f0 = Math.floor(exactFrame);
    const f1 = Math.min(dsp.totalFrames - 1, f0 + 1);
    const frac = exactFrame - f0;
    const smoothFrac = frac * frac * (3 - 2 * frac);

    const bassVal =
      (dsp.bassEnv[f0] ?? 0) * (1 - smoothFrac) +
      (dsp.bassEnv[f1] ?? 0) * smoothFrac;

    const specCol = new Float32Array(64);
    for (let b = 0; b < 64; b++) {
      const v0 = dsp.melSpec[b][f0] ?? 0;
      const v1 = dsp.melSpec[b][f1] ?? 0;
      specCol[b] = v0 * (1 - smoothFrac) + v1 * smoothFrac;
    }

    renderStudioFrame(ctx, surface, specCol, bassVal, s, t, bInt, exactFrame, wfLayout);
    drawLyricsOverlay(ctx, surface.width, surface.height, timeSec, paramsRef.current.lyricCues, paramsRef.current.subtitleStyle);
    return bassVal;
  }, []);

  // Re-draw static preview immediately whenever parameters, surface, or seek time change while paused
  useEffect(() => {
    if (activeTab !== 'studio' || playStateRef.current.isPlaying) return;
    const bVal = drawFrameAtTime(playStateRef.current.offsetSec);
    setCurrentBassVal(bVal);
  }, [
    activeTab,
    loadedImage,
    ratio,
    fitMode,
    style,
    theme,
    bassIntensity,
    fps,
    waveformLayout,
    dspResult,
    lyricCues,
    subtitleStyle,
    currentTime,
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
        const bVal = drawFrameAtTime(0);
        setCurrentBassVal(bVal);
        return;
      }

      const bVal = drawFrameAtTime(elapsed);

      if (now - lastUiSync > 70) {
        lastUiSync = now;
        setCurrentTime(elapsed);
        setCurrentBassVal(bVal);
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
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
        src.connect(gainNodeRef.current);
        const clamped = Math.max(
          0,
          Math.min(offsetSec, Math.max(0, audioBufferRef.current.duration - 0.05))
        );
        src.start(0, clamped);
        sourceNodeRef.current = src;
        playStateRef.current.startedAtCtxTime = ctx.currentTime;
        playStateRef.current.offsetSec = clamped;
      } else {
        playStateRef.current.offsetSec = offsetSec;
      }

      playStateRef.current.isPlaying = true;
      setIsPlaying(true);
    },
    [ensureAudioReady, stopAudioSource]
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
      playStateRef.current.offsetSec = Math.min(currentPos, dspResult.durationSec);
      setIsPlaying(false);
      setCurrentTime(playStateRef.current.offsetSec);
    } else {
      const startAt =
        playStateRef.current.offsetSec >= dspResult.durationSec - 0.1
          ? 0
          : playStateRef.current.offsetSec;
      startPlaybackAt(startAt);
    }
  }, [dspResult, startPlaybackAt, stopAudioSource]);

  const handleRestart = useCallback(() => {
    if (playStateRef.current.isPlaying) {
      startPlaybackAt(0);
    } else {
      playStateRef.current.offsetSec = 0;
      setCurrentTime(0);
    }
  }, [startPlaybackAt]);

  const handleSeek = useCallback(
    (timeSec: number) => {
      playStateRef.current.offsetSec = timeSec;
      setCurrentTime(timeSec);
      if (playStateRef.current.isPlaying) {
        startPlaybackAt(timeSec);
      }
    },
    [startPlaybackAt]
  );

  const getPlaybackTime = useCallback(() => {
    const state = playStateRef.current;
    const elapsed = state.isPlaying && audioCtxRef.current
      ? audioCtxRef.current.currentTime - state.startedAtCtxTime
      : 0;
    return Math.min(state.durationSec, Math.max(0, state.offsetSec + elapsed));
  }, []);

  const handleToggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = next ? 0 : 1;
    }
  }, [isMuted]);

  // 9. Handle custom Image & Audio Uploads
  const handleSelectDemoArtwork = (id: string) => {
    const found = DEMO_ARTWORKS.find((a) => a.id === id);
    if (!found) return;
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
    setSelectedArtworkId('custom');
    setCustomImageName(file.name);
    setImageSrc(url);
  };

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
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const decodeCtx = audioCtxRef.current || new Ctx({ sampleRate: 44100 });
      if (!audioCtxRef.current) {
        audioCtxRef.current = decodeCtx;
        gainNodeRef.current = decodeCtx.createGain();
        gainNodeRef.current.gain.value = isMuted ? 0 : 1;
        gainNodeRef.current.connect(decodeCtx.destination);
      }

      const rawBytes = await file.arrayBuffer();
      const decodedBuffer = await decodeCtx.decodeAudioData(rawBytes);
      if (!decodedBuffer.length || decodedBuffer.duration <= 0) throw new Error('ไฟล์เสียงไม่มีข้อมูล');

      const mono = mixAudioBufferToMono(decodedBuffer);
      audioBufferRef.current = decodedBuffer;
      setAudioBufferForRender(decodedBuffer);
      setAudioSamples(mono);
      setAudioSampleRate(decodedBuffer.sampleRate);
      setAudioName(file.name);
      setIsDemoAudio(false);
    } catch (err) {
      setAudioError(`เบราว์เซอร์อ่านไฟล์เสียงนี้ไม่ได้ กรุณาใช้ MP3 หรือ WAV PCM ที่รองรับ โดยไม่มีการส่งไฟล์ไปยังเซิร์ฟเวอร์${err instanceof Error && err.message ? ` — ${err.message}` : ''}`);
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
        canRender={!isAnalyzing && Boolean(loadedImage) && Boolean(audioSamples)}
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
                duration={dspResult?.durationSec ?? 16}
                currentBassVal={currentBassVal}
                totalFrames={dspResult?.totalFrames ?? 0}
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
                bassIntensity={bassIntensity}
                fps={fps}
                waveformLayout={waveformLayout}
                audioError={audioError}
                onSelectDemoArtwork={handleSelectDemoArtwork}
                onUploadImage={handleUploadImage}
                onUseDemoAudio={loadDemoAudio}
                onUploadAudio={handleUploadAudio}
                onChangeRatio={setRatio}
                onChangeFitMode={setFitMode}
                onChangeStyle={handleChangeStyle}
                onChangeTheme={setTheme}
                onChangeBassIntensity={setBassIntensity}
                onChangeFps={setFps}
                onChangeWaveformLayout={handleChangeWaveformLayout}
                onResetWaveformLayout={handleResetWaveformLayout}
              >
                <LyricsPanel
                  audioSamples={audioSamples}
                  sampleRate={audioSampleRate}
                  duration={audioSamples ? audioSamples.length / audioSampleRate : 0}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  keyboardEnabled={!isRenderModalOpen}
                  cues={lyricCues}
                  text={lyricsText}
                  onChangeText={setLyricsText}
                  onChangeCues={setLyricCues}
                  subtitleStyle={subtitleStyle}
                  onChangeStyle={setSubtitleStyle}
                  getPlaybackTime={getPlaybackTime}
                  onStartPlayback={() => { void startPlaybackAt(0); }}
                  onSeek={handleSeek}
                />
              </ControlRail>
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
        imageEl={loadedImage}
        audioSamples={audioSamples}
        audioBuffer={audioBufferForRender}
        audioSampleRate={audioSampleRate}
        cachedDsp={dspResult}
        ratio={ratio}
        fitMode={fitMode}
        style={style}
        theme={theme}
        bassIntensity={bassIntensity}
        fps={fps}
        waveformLayout={waveformLayout}
        lyricCues={lyricCues}
        subtitleStyle={subtitleStyle}
      />
    </div>
  );
}
