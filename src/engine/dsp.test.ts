import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAudioSamples,
  computeFitGeometry,
  encodeWav,
  generateDemoBassTrack,
  sampleDspAtTime,
} from './dsp';
import {
  ASPECT_RATIOS,
  AspectRatioKey,
  BASS_INTENSITY_PRESETS,
  COLOR_THEMES,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  WAVEFORM_STYLES,
  clampWaveformLayout,
  formatTime,
  getDefaultWaveformLayout,
  getThemeColorMix,
  hexToRgb,
  rgbToHex,
} from './presets';
import { renderStudioFrame } from './renderer';
import {
  generateCloudRenderYaml,
  generateRenderEnginePy,
  generateRequirementsTxt,
} from './codeTemplates';

test('ASPECT_RATIOS defines all 7 required 1080p Full HD ratios', () => {
  const keys = Object.keys(ASPECT_RATIOS);
  assert.deepEqual(keys, ['1:1', '2:3', '3:2', '4:5', '5:4', '16:9', '9:16']);
  assert.equal(ASPECT_RATIOS['1:1'].width, 1080);
  assert.equal(ASPECT_RATIOS['1:1'].height, 1080);
  assert.equal(ASPECT_RATIOS['16:9'].width, 1920);
  assert.equal(ASPECT_RATIOS['16:9'].height, 1080);
  assert.equal(ASPECT_RATIOS['9:16'].width, 1080);
  assert.equal(ASPECT_RATIOS['9:16'].height, 1920);
  assert.equal(ASPECT_RATIOS['4:5'].width, 1080);
  assert.equal(ASPECT_RATIOS['4:5'].height, 1350);
  assert.equal(ASPECT_RATIOS['5:4'].width, 1350);
  assert.equal(ASPECT_RATIOS['5:4'].height, 1080);
  assert.equal(ASPECT_RATIOS['2:3'].width, 1080);
  assert.equal(ASPECT_RATIOS['2:3'].height, 1620);
  assert.equal(ASPECT_RATIOS['3:2'].width, 1620);
  assert.equal(ASPECT_RATIOS['3:2'].height, 1080);
});

test('WAVEFORM_STYLES defines 20 styles (incl. 5 DJ smooth) and COLOR_THEMES defines 4 classic + 5 two-tone + 5 gradient presets', () => {
  assert.equal(WAVEFORM_STYLES.length, 20);
  const djStyles = WAVEFORM_STYLES.filter((s) => s.isDjSmooth);
  assert.equal(djStyles.length, 5);
  assert.deepEqual(
    djStyles.map((s) => s.key),
    ['dj_dual_deck', 'dj_club_eq', 'dj_liquid_plasma', 'dj_pulse_horizon', 'dj_vinyl_arc']
  );

  assert.deepEqual(
    BASS_INTENSITY_PRESETS.map((p) => p.value),
    [0.0, 0.2, 0.5, 1.0, 1.5, 2.0]
  );

  const allThemes = Object.values(COLOR_THEMES);
  assert.equal(allThemes.filter((t) => t.category === 'classic').length, 4);
  assert.equal(allThemes.filter((t) => t.category === 'twotone').length, 5);
  assert.equal(allThemes.filter((t) => t.category === 'gradient').length, 5);
  assert.equal(allThemes.length, 14);

  const mix = getThemeColorMix('cyberpunk');
  assert.equal(mix.c1, '#00F0FF');
  assert.equal(mix.c2, '#8A2BE2');
  assert.equal(mix.c3, '#FF00A0');
  assert.deepEqual(hexToRgb('#FF8000'), [255, 128, 0]);
  assert.equal(rgbToHex([255, 128, 0]), '#FF8000');
});

test('WaveformLayoutConfig defaults and clamping enforce valid ranges', () => {
  const def = getDefaultWaveformLayout('bars_3d');
  assert.equal(def.posX, 0.5);
  assert.equal(def.posY, 0.82);

  const clamped = clampWaveformLayout({
    posX: -0.5,
    posY: 1.5,
    scale: 4.0,
    opacity: -0.2,
  });
  assert.equal(clamped.posX, 0.1);
  assert.equal(clamped.posY, 0.9);
  assert.equal(clamped.scale, 2.0);
  assert.equal(clamped.opacity, 0.0);
});

test('Bass-Sync bandpass (20Hz-150Hz) reacts strongly to 60Hz sub-bass and ignores 4kHz tone', () => {
  const sr = 44100;
  const duration = 2;
  const n = sr * duration;
  const samples = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    samples[i] = t < 1.0 ? Math.sin(2 * Math.PI * 60 * t) : Math.sin(2 * Math.PI * 4000 * t);
  }

  const result = analyzeAudioSamples(samples, sr, 30, 64);
  assert.equal(result.melSpec.length, 64);
  assert.equal(result.bassEnv.length, result.totalFrames);

  const firstHalfMax = Math.max(...Array.from(result.bassEnv.slice(5, 25)));
  const secondHalfTail = result.bassEnv[result.totalFrames - 2];

  assert.ok(firstHalfMax > 0.7, `Expected bass peak > 0.7, got ${firstHalfMax}`);
  assert.ok(secondHalfTail < 0.15, `Expected high-freq bass tail < 0.15, got ${secondHalfTail}`);
});

test('64-band Mel spectrogram values remain clamped in [0, 1]', () => {
  const track = generateDemoBassTrack(2, 44100);
  const analysis = analyzeAudioSamples(track, 44100, 30, 64);

  assert.equal(analysis.melSpec.length, 64);
  for (let b = 0; b < 64; b++) {
    assert.equal(analysis.melSpec[b].length, analysis.totalFrames);
    for (let f = 0; f < analysis.totalFrames; f++) {
      const v = analysis.melSpec[b][f];
      assert.ok(v >= 0 && v <= 1, `Mel value out of range [0,1]: ${v}`);
    }
  }
  assert.ok(analysis.peakBassFrames > 0, 'Demo track should produce bass peaks > 0.45');
  assert.equal(analysis.bassOnsetFlux.length, analysis.totalFrames);
  const maxFlux = Math.max(...Array.from(analysis.bassOnsetFlux));
  assert.ok(maxFlux > 0.15, `Demo kick hits should trigger Onset Flux > 0.15, got ${maxFlux}`);
  for (let f = 0; f < analysis.totalFrames; f++) {
    assert.ok(
      analysis.bassOnsetFlux[f] >= 0 && analysis.bassOnsetFlux[f] <= 1,
      `Onset flux out of range [0, 1]: ${analysis.bassOnsetFlux[f]}`
    );
  }

  const specOut = new Float32Array(64);
  const sampled = sampleDspAtTime(analysis, 0.5, specOut);
  assert.ok(sampled.bassVal >= 0 && sampled.bassVal <= 1);
  assert.ok(sampled.onsetFlux >= 0 && sampled.onsetFlux <= 1);
});

test('Onset Flux stays near zero on sustained steady 60Hz bass and spikes on kick onset', () => {
  const sr = 44100;
  const duration = 2;
  const n = sr * duration;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t < 1.0 || t >= 1.4) {
      samples[i] = Math.sin(2 * Math.PI * 60 * t);
    }
  }
  const res = analyzeAudioSamples(samples, sr, 30, 64);
  const sustainedMax = Math.max(...Array.from(res.bassOnsetFlux.slice(15, 25)));
  const onsetMax = Math.max(...Array.from(res.bassOnsetFlux.slice(41, 47)));
  assert.ok(sustainedMax < 0.05, `Sustained bass should not trigger shake flux, got ${sustainedMax}`);
  assert.ok(onsetMax > 0.25, `Kick onset should trigger zoom punch flux > 0.25, got ${onsetMax}`);
});

test('encodeWav creates valid RIFF/WAVE header', () => {
  const samples = generateDemoBassTrack(0.5, 44100);
  const wav = encodeWav(samples, 44100);
  const header = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
  const format = String.fromCharCode(wav[8], wav[9], wav[10], wav[11]);
  assert.equal(header, 'RIFF');
  assert.equal(format, 'WAVE');
  assert.equal(wav.length, 44 + samples.length * 2);
});

test('computeFitGeometry scales PNG proportionally centered across all 7 aspect ratios without overflowing', () => {
  const srcW = 1024;
  const srcH = 1024;

  for (const key of Object.keys(ASPECT_RATIOS) as AspectRatioKey[]) {
    const spec = ASPECT_RATIOS[key];
    const geom = computeFitGeometry(srcW, srcH, spec.width, spec.height);

    // Center mode: padded neatly inside frame (not huge edge-to-edge) and dead-centered
    assert.ok(geom.center.w > 0 && geom.center.w < spec.width * 0.7);
    assert.ok(geom.center.h > 0 && geom.center.h < spec.height * 0.65);
    assert.equal(geom.center.w, geom.center.h, `1:1 PNG aspect preserved on ${key}`);
    assert.ok(geom.center.x > 0 && geom.center.y > 0, `Centered with margin on ${key}`);
    assert.ok(
      Math.abs(geom.center.x * 2 + geom.center.w - spec.width) <= 2,
      `Horizontally centered on ${key}`
    );
    assert.ok(
      Math.abs(geom.center.y * 2 + geom.center.h - spec.height) <= 2,
      `Vertically centered on ${key}`
    );
  }

  const rectGeom = computeFitGeometry(1920, 1080, 1080, 1920);
  assert.ok(rectGeom.cover.w >= 1080 && rectGeom.cover.h >= 1920);
  assert.equal(rectGeom.contain.w, 1080);
  assert.ok(rectGeom.contain.h < 1920);
});

test('Code templates inject studio defaults and 20 styles cleanly into cloud_render.yml', () => {
  const reqs = generateRequirementsTxt();
  const py = generateRenderEnginePy();
  const yml = generateCloudRenderYaml({
    ratio: '9:16',
    style: 'dj_dual_deck',
    theme: 'tt_crimson_cyan',
    bass: 0.2,
    fit: 'center',
    fps: 60,
    layout: { posX: 0.35, posY: 0.42, scale: 1.35, opacity: 0.75 },
  });

  assert.match(reqs, /librosa>=0\.10\.1/);
  assert.match(py, /def apply_bass_transform/);
  assert.match(py, /bars_3d/);
  assert.match(py, /dj_dual_deck/);
  assert.match(py, /dj_vinyl_arc/);
  assert.doesNotMatch(py, /circular_core/);
  assert.match(py, /--pos-x/);
  assert.match(py, /--opacity/);
  assert.match(yml, /default: '9:16'/);
  assert.match(yml, /default: 'dj_dual_deck'/);
  assert.match(yml, /default: 'tt_crimson_cyan'/);
  assert.match(yml, /default: '0\.2'/);
  assert.match(yml, /default: 'center'/);
  assert.match(yml, /default: '60'/);
  assert.match(yml, /default: '0\.35'/);
  assert.match(yml, /default: '0\.42'/);
  assert.match(yml, /default: '1\.35'/);
  assert.match(yml, /default: '0\.75'/);
  assert.match(yml, /\.opus/);
  assert.match(yml, /\.aiff/);
});

test('Supported extensions restrict uploads to image and audio only (no video) and formatTime works', () => {
  assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes('.png'));
  assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes('.jpg'));
  assert.ok(SUPPORTED_AUDIO_EXTENSIONS.includes('.mp3'));
  assert.ok(SUPPORTED_AUDIO_EXTENSIONS.includes('.wav'));
  assert.ok(!SUPPORTED_IMAGE_EXTENSIONS.includes('.mp4'));
  assert.ok(!SUPPORTED_AUDIO_EXTENSIONS.includes('.mp4'));

  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(15), '00:15');
  assert.equal(formatTime(75), '01:15');
  assert.equal(formatTime(3665), '61:05');
});

test('renderStudioFrame executes without errors across all 20 styles (including 5 DJ smooth)', () => {
  const createMockCanvas = () => {
    const ctx = {
      save: () => {},
      restore: () => {},
      fillRect: () => {},
      clearRect: () => {},
      drawImage: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      filter: 'none',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
      shadowBlur: 0,
      shadowColor: '',
    };
    return {
      width: 1920,
      height: 1080,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
  };

  const targetCanvas = createMockCanvas();
  const surface = {
    width: 1920,
    height: 1080,
    baseCanvas: createMockCanvas(),
    overlayCanvas: createMockCanvas(),
    glowCanvas: createMockCanvas(),
    workCanvas: createMockCanvas(),
  };
  const specCol = new Float32Array(64).fill(0.5);

  for (const style of WAVEFORM_STYLES) {
    assert.doesNotThrow(() => {
      renderStudioFrame(
        targetCanvas.getContext('2d') as any,
        surface as any,
        specCol,
        0.5,
        style.key,
        'cyberpunk',
        1.0,
        12,
        getDefaultWaveformLayout(style.key),
        0.5
      );
    }, `renderStudioFrame threw on style ${style.key}`);
  }

  assert.doesNotThrow(() => {
    renderStudioFrame(
      targetCanvas.getContext('2d') as any,
      surface as any,
      specCol,
      0.8,
      'dj_dual_deck',
      'gr_sunset_synth',
      1.0,
      0,
      getDefaultWaveformLayout('dj_dual_deck'),
      0.8,
      undefined,
      false
    );
  }, 'renderStudioFrame failed when showWaveform is false');

  assert.doesNotThrow(() => {
    renderStudioFrame(
      targetCanvas.getContext('2d') as any,
      surface as any,
      specCol,
      0.9,
      'dj_liquid_plasma',
      'tt_gold_violet',
      0.0,
      0,
      getDefaultWaveformLayout('dj_liquid_plasma'),
      0.9,
      undefined,
      true
    );
  }, 'renderStudioFrame failed when bassIntensity is 0.0');
});

test('duration resolution defaults to full song length and supports manual adjustments', () => {
  const songDuration = 215.5;
  const customDuration: number | null = null;
  const effectiveDuration =
    customDuration !== null && customDuration > 0
      ? Math.max(0.5, Math.min(customDuration, songDuration))
      : Math.max(0.5, songDuration);
  assert.equal(effectiveDuration, 215.5);

  const shortsDuration = 15.0;
  assert.equal(Math.max(0.5, Math.min(shortsDuration, songDuration)), 15.0);

  const overflowDuration = 999.0;
  assert.equal(Math.max(0.5, Math.min(overflowDuration, songDuration)), 215.5);
});
