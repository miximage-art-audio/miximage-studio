import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAudioSamples,
  computeFitGeometry,
  encodeWav,
  generateDemoBassTrack,
} from './dsp';
import {
  ASPECT_RATIOS,
  BASS_INTENSITY_PRESETS,
  COLOR_THEMES,
  WAVEFORM_STYLES,
  clampWaveformLayout,
  getDefaultWaveformLayout,
} from './presets';
import {
  generateCloudRenderYaml,
  generateRenderEnginePy,
  generateRequirementsTxt,
} from './codeTemplates';

test('ASPECT_RATIOS defines all 7 required 1080p Full HD ratios', () => {
  const keys = Object.keys(ASPECT_RATIOS);
  assert.deepEqual(keys, ['1:1', '2:3', '3:2', '4:5', '5:4', '16:9', '9:16']);
  assert.equal(ASPECT_RATIOS['16:9'].width, 1920);
  assert.equal(ASPECT_RATIOS['16:9'].height, 1080);
  assert.equal(ASPECT_RATIOS['9:16'].width, 1080);
  assert.equal(ASPECT_RATIOS['9:16'].height, 1920);
  assert.equal(ASPECT_RATIOS['4:5'].width, 1080);
  assert.equal(ASPECT_RATIOS['4:5'].height, 1350);
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
