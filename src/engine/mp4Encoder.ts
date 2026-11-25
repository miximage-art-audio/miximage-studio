import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export interface OfflineMp4Config {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  durationSec: number;
  audioSamples: Float32Array;
  audioBuffer: AudioBuffer | null;
  audioSampleRate: number;
  renderCanvas: HTMLCanvasElement;
  drawFrameAt: (sec: number) => void;
  onProgress: (pct: number, currentFrame: number, totalFrames: number) => void;
  signal?: AbortSignal;
}

interface SupportedCodecs {
  videoCodec: string;
  audioCodec: 'aac' | 'opus';
  audioCodecString: string;
  audioSampleRate: number;
  audioChannels: number;
}

const H264_PROFILES = [
  'avc1.64002a', // High Profile Level 4.2 (1080p60)
  'avc1.4d002a', // Main Profile Level 4.2
  'avc1.42002a', // Baseline Profile Level 4.2
  'avc1.640028', // High Profile Level 4.0 (1080p30)
  'avc1.4d0028', // Main Profile Level 4.0
  'avc1.420028', // Baseline Profile Level 4.0
  'avc1.42E01E', // Baseline Profile Level 3.0 (<= 720p)
];

export function isWebCodecsAvailable(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioData !== 'undefined'
  );
}

export async function probeWebCodecsMp4Support(
  width: number,
  height: number,
  fps: number,
  videoBitrate: number,
  sourceSampleRate: number,
  sourceChannels: number
): Promise<SupportedCodecs | null> {
  if (!isWebCodecsAvailable()) return null;

  let videoCodec: string | null = null;
  for (const candidate of H264_PROFILES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate,
        width,
        height,
        bitrate: videoBitrate,
        framerate: fps,
        hardwareAcceleration: 'no-preference',
      });
      if (support.supported) {
        videoCodec = candidate;
        break;
      }
    } catch {
      // Try next H.264 profile
    }
  }
  if (!videoCodec) return null;

  const targetChannels = Math.min(2, Math.max(1, sourceChannels));
  const srCandidates = Array.from(new Set([sourceSampleRate, 48000, 44100]));

  // Prefer AAC-LC (mp4a.40.2) for widest player compatibility; fallback to Opus in MP4
  for (const sr of srCandidates) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: sr,
        numberOfChannels: targetChannels,
        bitrate: 192_000,
      });
      if (support.supported) {
        return {
          videoCodec,
          audioCodec: 'aac',
          audioCodecString: 'mp4a.40.2',
          audioSampleRate: sr,
          audioChannels: targetChannels,
        };
      }
    } catch {
      // Try next sample rate
    }
  }

  for (const sr of [48000, sourceSampleRate]) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: sr,
        numberOfChannels: targetChannels,
        bitrate: 192_000,
      });
      if (support.supported) {
        return {
          videoCodec,
          audioCodec: 'opus',
          audioCodecString: 'opus',
          audioSampleRate: sr,
          audioChannels: targetChannels,
        };
      }
    } catch {
      // Try next sample rate
    }
  }

  return null;
}

async function prepareChannelData(
  audioSamples: Float32Array,
  audioBuffer: AudioBuffer | null,
  sourceSampleRate: number,
  targetSampleRate: number,
  targetChannels: number
): Promise<Float32Array[]> {
  const srcChannels = audioBuffer ? audioBuffer.numberOfChannels : 1;
  const srcLength = audioBuffer ? audioBuffer.length : audioSamples.length;
  const srcSr = audioBuffer ? audioBuffer.sampleRate : sourceSampleRate;

  // Fast path: sample rate matches and channel count fits directly
  if (srcSr === targetSampleRate) {
    const out: Float32Array[] = [];
    if (audioBuffer) {
      for (let ch = 0; ch < targetChannels; ch++) {
        const channelIdx = Math.min(ch, srcChannels - 1);
        out.push(audioBuffer.getChannelData(channelIdx));
      }
    } else {
      for (let ch = 0; ch < targetChannels; ch++) {
        out.push(audioSamples);
      }
    }
    return out;
  }

  // Resample cleanly with OfflineAudioContext if sample rate differs
  const targetLen = Math.max(1, Math.round((srcLength / srcSr) * targetSampleRate));
  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) {
    throw new Error('เบราว์เซอร์ไม่รองรับการปรับ Sample Rate ของเสียง');
  }

  const offline = new OfflineCtx(targetChannels, targetLen, targetSampleRate);
  const srcBuf = offline.createBuffer(targetChannels, srcLength, srcSr);
  if (audioBuffer) {
    for (let ch = 0; ch < targetChannels; ch++) {
      srcBuf.getChannelData(ch).set(audioBuffer.getChannelData(Math.min(ch, srcChannels - 1)));
    }
  } else {
    for (let ch = 0; ch < targetChannels; ch++) {
      srcBuf.getChannelData(ch).set(audioSamples);
    }
  }

  const srcNode = offline.createBufferSource();
  srcNode.buffer = srcBuf;
  srcNode.connect(offline.destination);
  srcNode.start(0);
  const rendered = await offline.startRendering();

  const out: Float32Array[] = [];
  for (let ch = 0; ch < targetChannels; ch++) {
    out.push(rendered.getChannelData(ch));
  }
  return out;
}

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function exportVideoWithWebCodecs(
  config: OfflineMp4Config
): Promise<Blob> {
  const {
    width,
    height,
    fps,
    videoBitrate,
    durationSec,
    audioSamples,
    audioBuffer,
    audioSampleRate,
    renderCanvas,
    drawFrameAt,
    onProgress,
    signal,
  } = config;

  const srcChannels = audioBuffer ? audioBuffer.numberOfChannels : 1;
  const srcSr = audioBuffer ? audioBuffer.sampleRate : audioSampleRate;
  const codecs = await probeWebCodecsMp4Support(
    width,
    height,
    fps,
    videoBitrate,
    srcSr,
    srcChannels
  );
  if (!codecs) {
    throw new Error('WEBCODECS_UNSUPPORTED');
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: fps,
    },
    audio: {
      codec: codecs.audioCodec,
      numberOfChannels: codecs.audioChannels,
      sampleRate: codecs.audioSampleRate,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encoderFailure: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderFailure = err instanceof Error ? err : new Error(String(err));
    },
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      muxer.addAudioChunk(chunk, meta);
    },
    error: (err) => {
      encoderFailure = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    videoEncoder.configure({
      codec: codecs.videoCodec,
      width,
      height,
      bitrate: videoBitrate,
      framerate: fps,
      hardwareAcceleration: 'no-preference',
    });

    audioEncoder.configure({
      codec: codecs.audioCodecString,
      sampleRate: codecs.audioSampleRate,
      numberOfChannels: codecs.audioChannels,
      bitrate: 192_000,
    });

    // 1. Encode complete audio track cleanly for the exact full target durationSec
    const channelData = await prepareChannelData(
      audioSamples,
      audioBuffer,
      audioSampleRate,
      codecs.audioSampleRate,
      codecs.audioChannels
    );
    const srcLen = channelData[0].length;
    const totalAudioFrames = Math.max(1, Math.round(durationSec * codecs.audioSampleRate));
    const chunkFrames = 4096;

    for (let offset = 0; offset < totalAudioFrames; offset += chunkFrames) {
      if (signal?.aborted) throw new Error('RENDER_ABORTED');
      if (encoderFailure) throw encoderFailure;

      const count = Math.min(chunkFrames, totalAudioFrames - offset);
      const planarBuffer = new Float32Array(count * codecs.audioChannels);
      for (let ch = 0; ch < codecs.audioChannels; ch++) {
        const chSrc = channelData[ch];
        const dstStart = ch * count;
        for (let i = 0; i < count; i++) {
          planarBuffer[dstStart + i] = chSrc[(offset + i) % srcLen];
        }
      }

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: codecs.audioSampleRate,
        numberOfChannels: codecs.audioChannels,
        numberOfFrames: count,
        timestamp: Math.round((offset / codecs.audioSampleRate) * 1_000_000),
        data: planarBuffer,
      });

      audioEncoder.encode(audioData);
      audioData.close();

      while (audioEncoder.encodeQueueSize > 32) {
        if (signal?.aborted) throw new Error('RENDER_ABORTED');
        if (encoderFailure) throw encoderFailure;
        await sleepMs(2);
      }
    }

    // 2. Render & encode every video frame deterministically (0 .. totalFrames - 1)
    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const frameDurationUs = Math.round((1 / fps) * 1_000_000);
    const keyframeInterval = Math.max(1, fps * 2);

    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) throw new Error('RENDER_ABORTED');
      if (encoderFailure) throw encoderFailure;

      const sec = f / fps;
      drawFrameAt(sec);

      const timestampUs = Math.round((f / fps) * 1_000_000);
      const videoFrame = new VideoFrame(renderCanvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      });

      videoEncoder.encode(videoFrame, { keyFrame: f % keyframeInterval === 0 });
      videoFrame.close();

      while (videoEncoder.encodeQueueSize > 8) {
        if (signal?.aborted) throw new Error('RENDER_ABORTED');
        if (encoderFailure) throw encoderFailure;
        await sleepMs(4);
      }

      if (f % 4 === 0 || f === totalFrames - 1) {
        const pct = Math.min(97, Math.floor(((f + 1) / totalFrames) * 96));
        onProgress(pct, f + 1, totalFrames);
        await sleepMs(0);
      }
    }

    if (encoderFailure) throw encoderFailure;
    onProgress(98, totalFrames, totalFrames);

    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);
    if (encoderFailure) throw encoderFailure;

    muxer.finalize();
    onProgress(100, totalFrames, totalFrames);

    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      // ignore close error
    }
    try {
      if (audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      // ignore close error
    }
  }
}
