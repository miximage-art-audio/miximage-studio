import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAudioSamples,
  computeFitGeometry,
  encodeWav,
  generateDemoBassTrack,
} from './dsp';
import { ASPECT_RATIOS, COLOR_THEMES } from './presets';
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

test('COLOR_THEMES defines all 4 neon themes', () => {
  assert.deepEqual(Object.keys(COLOR_THEMES), [
    'cyberpunk',
    'gold_fire',
    'ice_blue',
    'emerald',
  ]);
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

test('Code templates inject studio defaults cleanly into cloud_render.yml', () => {
  const reqs = generateRequirementsTxt();
  const py = generateRenderEnginePy();
  const yml = generateCloudRenderYaml({
    ratio: '9:16',
    style: 'circular_core',
    theme: 'gold_fire',
    bass: 1.5,
    fit: 'blur_pad',
    fps: 60,
  });

  assert.match(reqs, /librosa>=0\.10\.1/);
  assert.match(py, /def apply_bass_transform/);
  assert.match(yml, /default: '9:16'/);
  assert.match(yml, /default: 'circular_core'/);
  assert.match(yml, /default: 'gold_fire'/);
  assert.match(yml, /default: '1\.5'/);
  assert.match(yml, /default: 'blur_pad'/);
  assert.match(yml, /default: '60'/);
  assert.match(yml, /\.opus/);
  assert.match(yml, /\.aiff/);
});
