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
  BASS_INTENSITY_PRESETS,
  COLOR_THEMES,
  WAVEFORM_STYLES,
  clampWaveformLayout,
  formatTime,
  getDefaultWaveformLayout,
  getThemeColorMix,
  hexToRgb,
  rgbToHex,
  SUPPORTED_MEDIA_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
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

test('WAVEFORM_STYLES defines 15 non-circular 3D/wave styles, COLOR_THEMES defines 4 themes, and BASS_INTENSITY_PRESETS supports soft values', () => {
  assert.equal(WAVEFORM_STYLES.length, 15);
  assert.deepEqual(
    BASS_INTENSITY_PRESETS.map((p) => p.value),
    [0.0, 0.2, 0.5, 1.0, 1.5, 2.0]
  );
  assert.deepEqual(
    WAVEFORM_STYLES.map((s) => s.key),
    [
      'bars_3d',
      'layered_fluid',
      'dot_halftone',
      'pixel_grid',
      'mesh_ribbon',
      'smooth_osc',
      'mirror_needles',
      'silk_aura',
      'prism_peaks',
      'brush_spectrum',
      'harmonic_waves',
      'dot_mountains',
      'double_flame',
      'triple_sine',
      'seismic_line',
    ]
  );
  assert.deepEqual(Object.keys(COLOR_THEMES), [
    'cyberpunk',
    'gold_fire',
    'ice_blue',
    'emerald',
  ]);
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
  assert.equal(def.posY, 0.80);

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

  // First 1s: 60Hz sub-bass; Second 1s: 4000Hz high tone
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    samples[i] = t < 1.0 ? Math.sin(2 * Math.PI * 60 * t) : Math.sin(2 * Math.PI * 4000 * t);
  }

  const result = analyzeAudioSamples(samples, sr, 30, 64);
  assert.equal(result.melSpec.length, 64);
  assert.equal(result.bassEnv.length, result.totalFrames);

  // Midpoint of first half (around frame 15) should have high bass energy
  const firstHalfMax = Math.max(...Array.from(result.bassEnv.slice(5, 25)));
  // End of second half (around frame 50..59) should have decayed low bass energy
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
  // First 1s: steady continuous 60Hz bass; 1.2s..1.4s: silence; 1.4s..2.0s: sudden 60Hz hit
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t < 1.0 || t >= 1.4) {
      samples[i] = Math.sin(2 * Math.PI * 60 * t);
    }
  }
  const res = analyzeAudioSamples(samples, sr, 30, 64);
  // Sustained middle of first second (frames 15..25) should have minimal flux
  const sustainedMax = Math.max(...Array.from(res.bassOnsetFlux.slice(15, 25)));
  // Sudden onset around t=1.4s (frames 41..46) should spike
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

test('computeFitGeometry scales 16:9 image into 9:16 cover and blur_pad contain properly', () => {
  const geom = computeFitGeometry(1920, 1080, 1080, 1920);
  assert.ok(geom.cover.w >= 1080 && geom.cover.h >= 1920);
  assert.equal(geom.contain.w, 1080);
  assert.ok(geom.contain.h < 1920);
  assert.ok(geom.contain.y > 0);
});

test('Code templates inject studio defaults and 15 styles cleanly into cloud_render.yml', () => {
  const reqs = generateRequirementsTxt();
  const py = generateRenderEnginePy();
  const yml = generateCloudRenderYaml({
    ratio: '9:16',
    style: 'bars_3d',
    theme: 'gold_fire',
    bass: 0.2,
    fit: 'blur_pad',
    fps: 60,
    layout: { posX: 0.35, posY: 0.42, scale: 1.35, opacity: 0.75 },
  });

  assert.match(reqs, /librosa>=0\.10\.1/);
  assert.match(py, /def apply_bass_transform/);
  assert.match(py, /bars_3d/);
  assert.match(py, /dot_mountains/);
  assert.doesNotMatch(py, /circular_core/);
  assert.match(py, /--pos-x/);
  assert.match(py, /--opacity/);
  assert.match(yml, /default: '9:16'/);
  assert.match(yml, /default: 'bars_3d'/);
  assert.match(yml, /default: 'gold_fire'/);
  assert.match(yml, /default: '0\.2'/);
  assert.match(yml, /default: 'blur_pad'/);
  assert.match(yml, /default: '60'/);
  assert.match(yml, /default: '0\.35'/);
  assert.match(yml, /default: '0\.42'/);
  assert.match(yml, /default: '1\.35'/);
  assert.match(yml, /default: '0\.75'/);
  assert.match(yml, /\.opus/);
  assert.match(yml, /\.aiff/);
});

test('Video support defines extensions and formatTime formats correctly', () => {
  assert.ok(SUPPORTED_VIDEO_EXTENSIONS.includes('.mp4'));
  assert.ok(SUPPORTED_VIDEO_EXTENSIONS.includes('.webm'));
  assert.ok(SUPPORTED_VIDEO_EXTENSIONS.includes('.mov'));
  assert.ok(SUPPORTED_MEDIA_EXTENSIONS.includes('.mp4'));
  assert.ok(SUPPORTED_MEDIA_EXTENSIONS.includes('.jpg'));
  assert.ok(SUPPORTED_MEDIA_EXTENSIONS.includes('.png'));

  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(15), '00:15');
  assert.equal(formatTime(75), '01:15');
  assert.equal(formatTime(3665), '61:05');
});

test('renderStudioFrame executes without errors across all 15 styles', () => {
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
        0,
        getDefaultWaveformLayout(style.key),
        0.5
      );
    }, `renderStudioFrame threw on style ${style.key}`);
  }
});
