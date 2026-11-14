export interface DspAnalysisResult {
  bassEnv: Float32Array;
  bassOnsetFlux: Float32Array;
  melSpec: Float32Array[]; // length = nBars (64), each Float32Array length = totalFrames
  totalFrames: number;
  fps: number;
  durationSec: number;
  peakBassFrames: number;
}

/**
 * In-place iterative Cooley-Tukey Radix-2 FFT.
 * `re` and `im` must have length equal to a power of 2.
 */
export function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const evenIdx = i + k;
        const oddIdx = evenIdx + halfLen;
        const tRe = wRe * re[oddIdx] - wIm * im[oddIdx];
        const tIm = wRe * im[oddIdx] + wIm * re[oddIdx];
        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

function hzToMel(hz: number): number {
  return 2595.0 * Math.log10(1.0 + hz / 700.0);
}

function melToHz(mel: number): number {
  return 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0);
}

/**
 * Builds triangular Mel filterbank weights matching librosa.filters.mel(fmin=30, fmax=12000).
 */
function buildMelFilterbank(
  sampleRate: number,
  nFft: number,
  nMels: number,
  fMin: number,
  fMax: number
): Array<{ indices: number[]; weights: number[] }> {
  const nBins = nFft / 2 + 1;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(Math.min(fMax, sampleRate / 2));

  const melPoints = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melMin + (i * (melMax - melMin)) / (nMels + 1);
  }

  const hzPoints = Array.from(melPoints, melToHz);
  const binFreqStep = sampleRate / nFft;

  const filters: Array<{ indices: number[]; weights: number[] }> = [];
  for (let m = 0; m < nMels; m++) {
    const fLeft = hzPoints[m];
    const fCenter = hzPoints[m + 1];
    const fRight = hzPoints[m + 2];

    const indices: number[] = [];
    const weights: number[] = [];

    for (let k = 0; k < nBins; k++) {
      const freq = k * binFreqStep;
      let w = 0;
      if (freq >= fLeft && freq <= fCenter && fCenter > fLeft) {
        w = (freq - fLeft) / (fCenter - fLeft);
      } else if (freq > fCenter && freq <= fRight && fRight > fCenter) {
        w = (fRight - freq) / (fRight - fCenter);
      }
      if (w > 0) {
        // Slaney-style area normalization approximation for balanced high/low bands
        const enorm = 2.0 / Math.max(1e-6, fRight - fLeft);
        indices.push(k);
        weights.push(w * enorm);
      }
    }

    // Fallback: ensure every band maps to at least the nearest FFT bin
    if (indices.length === 0) {
      const nearest = Math.min(nBins - 1, Math.max(0, Math.round(fCenter / binFreqStep)));
      indices.push(nearest);
      weights.push(1.0);
    }

    filters.push({ indices, weights });
  }

  return filters;
}

/**
 * 1D Gaussian smoothing along the time axis (matches scipy.ndimage.gaussian_filter1d).
 */
function gaussianFilter1dRow(data: Float32Array, sigma: number): Float32Array {
  const n = data.length;
  if (n <= 1 || sigma <= 0) return data;

  const radius = Math.ceil(4 * sigma);
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = val;
    sum += val;
  }
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      // Reflect boundary handling
      let idx = i + k;
      if (idx < 0) idx = Math.min(n - 1, -idx);
      if (idx >= n) idx = Math.max(0, 2 * n - 2 - idx);
      acc += data[idx] * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Analyzes mono PCM audio samples into:
 * 1) Bass-Sync Physics Envelope (20Hz - 150Hz, Fast Attack 0.80, Quick Release 0.28, power 1.35)
 * 2) Onset Flux (current frame bass energy minus moving average of previous 8 frames, clamped >= 0)
 * 3) 64-band Mel Spectrogram (30Hz - 12,000Hz, normalized 0..1, smoothed with sigma=0.65)
 */
export function analyzeAudioSamples(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  nBars = 64
): DspAnalysisResult {
  const nFft = 2048;
  const durationSec = samples.length / sampleRate;
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
  const nBins = nFft / 2 + 1;

  // Precompute Hann window
  const hann = new Float64Array(nFft);
  for (let i = 0; i < nFft; i++) {
    hann[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / nFft));
  }

  // Bass bin indices (20Hz - 150Hz)
  const bassBinIndices: number[] = [];
  for (let k = 0; k < nBins; k++) {
    const freq = (k * sampleRate) / nFft;
    if (freq >= 20 && freq <= 150) {
      bassBinIndices.push(k);
    }
  }

  const melFilters = buildMelFilterbank(sampleRate, nFft, nBars, 30, 12000);
  const bassRaw = new Float32Array(totalFrames);
  const melPower: Float32Array[] = Array.from({ length: nBars }, () => new Float32Array(totalFrames));

  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const mag = new Float64Array(nBins);
  const power = new Float64Array(nBins);

  let maxBassRaw = 0;
  let maxMelPower = 1e-10;

  for (let f = 0; f < totalFrames; f++) {
    const center = Math.round((f / fps) * sampleRate);
    const start = center - nFft / 2;

    for (let i = 0; i < nFft; i++) {
      const sampleIdx = start + i;
      const s = sampleIdx >= 0 && sampleIdx < samples.length ? samples[sampleIdx] : 0;
      re[i] = s * hann[i];
      im[i] = 0;
    }

    fftRadix2(re, im);

    for (let k = 0; k < nBins; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      power[k] = p;
      mag[k] = Math.sqrt(p);
    }

    // Extract 20Hz - 150Hz mean magnitude
    let bassSum = 0;
    for (let i = 0; i < bassBinIndices.length; i++) {
      bassSum += mag[bassBinIndices[i]];
    }
    const bassMean = bassBinIndices.length > 0 ? bassSum / bassBinIndices.length : 0;
    bassRaw[f] = bassMean;
    if (bassMean > maxBassRaw) maxBassRaw = bassMean;

    // Extract 64 Mel bands (normalized by filter weight sum + perceptual frequency balance)
    for (let m = 0; m < nBars; m++) {
      const filter = melFilters[m];
      let bandEnergy = 0;
      let weightSum = 0;
      for (let idx = 0; idx < filter.indices.length; idx++) {
        const w = filter.weights[idx];
        bandEnergy += power[filter.indices[idx]] * w;
        weightSum += w;
      }
      if (weightSum > 0) {
        bandEnergy /= weightSum;
      }
      // Perceptual frequency tilt (+4.5 dB/octave equivalent) so mid/vocal/snare/high bands balance naturally with low bands
      const freqTilt = 1.0 + Math.pow(m / Math.max(1, nBars - 1), 1.15) * 8.5;
      const weightedEnergy = bandEnergy * freqTilt;
      melPower[m][f] = weightedEnergy;
      if (weightedEnergy > maxMelPower) maxMelPower = weightedEnergy;
    }
  }

  // Normalize bass_raw & apply crisp Attack/Release Envelope (0.80 / 0.28) for Screen Bass-Sync
  if (maxBassRaw > 0) {
    for (let f = 0; f < totalFrames; f++) {
      bassRaw[f] /= maxBassRaw;
    }
  }

  const bassEnvRaw = new Float32Array(totalFrames);
  const attack = 0.80;
  const release = 0.28;
  bassEnvRaw[0] = Math.pow(bassRaw[0] * attack, 1.35);

  let envPrev = bassRaw[0] * attack;
  for (let f = 1; f < totalFrames; f++) {
    if (bassRaw[f] > envPrev) {
      envPrev = attack * bassRaw[f] + (1.0 - attack) * envPrev;
    } else {
      envPrev = release * bassRaw[f] + (1.0 - release) * envPrev;
    }
    bassEnvRaw[f] = Math.pow(Math.max(0, envPrev), 1.35);
  }
  const bassEnv = gaussianFilter1dRow(bassEnvRaw, 0.5);

  // Onset Flux: current frame bass energy minus moving average of previous 8 frames, clamped >= 0 (crisp kick onset for screen punch)
  const bassOnsetFlux = new Float32Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    const winStart = Math.max(0, f - 8);
    const count = f - winStart;
    let sum = 0;
    for (let k = winStart; k < f; k++) {
      sum += bassEnv[k];
    }
    const prevAvg = count > 0 ? sum / count : 0;
    bassOnsetFlux[f] = Math.min(1.0, Math.max(0, bassEnv[f] - prevAvg));
  }

  let peakBassFrames = 0;
  for (let f = 0; f < totalFrames; f++) {
    if (bassEnv[f] > 0.45) peakBassFrames++;
  }

  // Compute per-band peak reference blended with global peak so all musical pitches (bass, vocals, snare, melody, highs) register accurately
  const bandRefMax = new Float32Array(nBars);
  for (let m = 0; m < nBars; m++) {
    let localMax = 0;
    for (let f = 0; f < totalFrames; f++) {
      if (melPower[m][f] > localMax) localMax = melPower[m][f];
    }
    bandRefMax[m] = Math.max(maxMelPower * 0.06, localMax * 0.68 + maxMelPower * 0.32);
  }

  // Zero-lag Beat/Pitch Envelope:
  // Fast attack (hits on the exact millisecond of the beat/note) + smooth exponential gravity decay (glides down fluidly without jitter)
  const fpsScale = 30.0 / Math.max(15, fps);
  const melAttack = 1.0 - Math.pow(1.0 - 0.86, fpsScale);
  const melRelease = 1.0 - Math.pow(1.0 - 0.24, fpsScale);

  const tempMel: Float32Array[] = [];
  for (let m = 0; m < nBars; m++) {
    const envRow = new Float32Array(totalFrames);
    const refMax = Math.max(1e-10, bandRefMax[m]);
    let prevVal = 0;
    for (let f = 0; f < totalFrames; f++) {
      const ratio = Math.max(1e-10, melPower[m][f] / refMax);
      const db = 10.0 * Math.log10(ratio);
      // Clean [-42 dB, 0 dB] noise-gated musical window (eliminates background FFT noise jitter)
      const rawNorm = Math.min(1.0, Math.max(0.0, (db + 42.0) / 42.0));
      const smoothNorm = rawNorm * rawNorm * (3.0 - 2.0 * rawNorm);
      const shaped = Math.pow(smoothNorm, 1.18);
      if (f === 0) {
        prevVal = shaped;
      } else if (shaped > prevVal) {
        prevVal = melAttack * shaped + (1.0 - melAttack) * prevVal;
      } else {
        prevVal = melRelease * shaped + (1.0 - melRelease) * prevVal;
      }
      envRow[f] = prevVal;
    }
    // Tight zero-phase smoothing (sigma=0.82) rounds peaks smoothly while keeping 0ms beat alignment
    tempMel.push(gaussianFilter1dRow(envRow, 0.82 / fpsScale));
  }

  // Smooth 5-tap spatial blending across adjacent Mel bands for cohesive, liquid wave motion
  const melSpec: Float32Array[] = Array.from({ length: nBars }, () => new Float32Array(totalFrames));
  for (let m = 0; m < nBars; m++) {
    const rM2 = tempMel[Math.max(0, m - 2)];
    const rM1 = tempMel[Math.max(0, m - 1)];
    const r0 = tempMel[m];
    const rP1 = tempMel[Math.min(nBars - 1, m + 1)];
    const rP2 = tempMel[Math.min(nBars - 1, m + 2)];
    for (let f = 0; f < totalFrames; f++) {
      const blended =
        rM2[f] * 0.09 +
        rM1[f] * 0.23 +
        r0[f] * 0.36 +
        rP1[f] * 0.23 +
        rP2[f] * 0.09;
      melSpec[m][f] = Math.min(1.0, Math.max(0.0, blended));
    }
  }

  return {
    bassEnv,
    bassOnsetFlux,
    melSpec,
    totalFrames,
    fps,
    durationSec,
    peakBassFrames,
  };
}

/**
 * Samples interpolated DSP values (bassEnv, bassOnsetFlux, and 64-band melSpec) at exact time `timeSec`.
 */
export function sampleDspAtTime(
  dsp: DspAnalysisResult,
  timeSec: number,
  specOut: Float32Array
): { bassVal: number; onsetFlux: number; exactFrame: number } {
  const exactFrame = Math.min(
    dsp.totalFrames - 1,
    Math.max(0, timeSec * dsp.fps)
  );
  const f0 = Math.floor(exactFrame);
  const f1 = Math.min(dsp.totalFrames - 1, f0 + 1);
  const frac = exactFrame - f0;
  const smoothFrac = frac * frac * (3 - 2 * frac);

  const bassVal =
    (dsp.bassEnv[f0] ?? 0) * (1 - smoothFrac) +
    (dsp.bassEnv[f1] ?? 0) * smoothFrac;
  const onsetFlux =
    (dsp.bassOnsetFlux[f0] ?? 0) * (1 - smoothFrac) +
    (dsp.bassOnsetFlux[f1] ?? 0) * smoothFrac;

  const bands = Math.min(specOut.length, dsp.melSpec.length);
  for (let band = 0; band < bands; band++) {
    const v0 = dsp.melSpec[band][f0] ?? 0;
    const v1 = dsp.melSpec[band][f1] ?? 0;
    specOut[band] = v0 * (1 - smoothFrac) + v1 * smoothFrac;
  }

  return { bassVal, onsetFlux, exactFrame };
}

/**
 * Generates a deterministic 128 BPM electronic bass-heavy demo track (kick + sub-bass + arp + hats)
 * so users can immediately test Bass-Sync Physics and Neon Waveforms without uploading an MP3 first.
 */
export function generateDemoBassTrack(durationSec = 16, sampleRate = 44100): Float32Array {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(totalSamples);
  const bpm = 128;
  const beatDur = 60.0 / bpm;

  // Deterministic pseudo-random noise for hats/snare
  let seed = 133742;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  // Minor scale bassline notes (Hz)
  const bassNotes = [55.0, 55.0, 65.41, 73.42, 55.0, 49.0, 65.41, 82.41];
  const arpNotes = [220.0, 261.63, 329.63, 392.0, 440.0, 523.25, 659.25, 783.99];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const beatFloat = t / beatDur;
    const beatIndex = Math.floor(beatFloat);
    const beatPhase = beatFloat - beatIndex;
    const sixteenthFloat = t / (beatDur / 4);
    const sixteenthIdx = Math.floor(sixteenthFloat);
    const sixteenthPhase = sixteenthFloat - sixteenthIdx;

    // 1. Punchy 808 Kick on every beat (sweeps 135Hz -> 46Hz)
    let kick = 0;
    if (beatPhase < 0.55) {
      const kEnv = Math.exp(-beatPhase * 8.5);
      const kFreq = 46 + 90 * Math.exp(-beatPhase * 28);
      kick = Math.sin(2 * Math.PI * kFreq * (beatPhase * beatDur)) * kEnv * 0.65;
    }

    // 2. Sub-bass groove on off-beats and bar starts
    const bassFreq = bassNotes[beatIndex % bassNotes.length];
    const subGate = beatPhase > 0.35 && beatPhase < 0.92 ? 1.0 : 0.28;
    const subBass =
      (Math.sin(2 * Math.PI * bassFreq * t) * 0.7 +
        Math.sin(2 * Math.PI * bassFreq * 2 * t) * 0.25) *
      subGate *
      0.32;

    // 3. Crisp Synth Arp (16th notes across mid/high spectrum 220Hz - 3200Hz)
    const arpFreq = arpNotes[sixteenthIdx % arpNotes.length] * (sixteenthIdx % 8 === 7 ? 2 : 1);
    const arpEnv = Math.exp(-sixteenthPhase * 6.0);
    const arp =
      (Math.sin(2 * Math.PI * arpFreq * t) +
        0.4 * Math.sin(2 * Math.PI * arpFreq * 2 * t) +
        0.2 * Math.sin(2 * Math.PI * arpFreq * 3 * t)) *
      arpEnv *
      0.16;

    // 4. Hi-hat on off-beats & snare clap on beats 2 & 4
    const noise = nextRand();
    const hatEnv = sixteenthIdx % 2 === 1 ? Math.exp(-sixteenthPhase * 18) : 0;
    const hat = noise * hatEnv * 0.08;

    const snareEnv = beatIndex % 2 === 1 && beatPhase < 0.25 ? Math.exp(-beatPhase * 16) : 0;
    const snare = (noise * 0.7 + Math.sin(2 * Math.PI * 195 * t) * 0.3) * snareEnv * 0.28;

    // Soft limiter
    const mixed = kick + subBass + arp + hat + snare;
    out[i] = Math.tanh(mixed * 0.95);
  }

  return out;
}

/**
 * Encodes mono Float32Array samples [-1, 1] into a standard 16-bit PCM WAV byte array.
 */
export function encodeWav(samples: Float32Array, sampleRate = 44100): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Computes cover crop and blur_pad contain geometry for given source and target sizes.
 */
export function computeFitGeometry(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number
) {
  const scaleCover = Math.max(targetW / srcW, targetH / srcH);
  const coverW = Math.round(srcW * scaleCover);
  const coverH = Math.round(srcH * scaleCover);
  const coverX = Math.floor((targetW - coverW) / 2);
  const coverY = Math.floor((targetH - coverH) / 2);

  const scaleContain = Math.min(targetW / srcW, targetH / srcH);
  const containW = Math.round(srcW * scaleContain);
  const containH = Math.round(srcH * scaleContain);
  const containX = Math.floor((targetW - containW) / 2);
  const containY = Math.floor((targetH - containH) / 2);

  return {
    cover: { x: coverX, y: coverY, w: coverW, h: coverH },
    contain: { x: containX, y: containY, w: containW, h: containH },
  };
}
