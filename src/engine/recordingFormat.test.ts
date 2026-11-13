import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSupportedRecordingFormat,
  resolveRecordingFormat,
} from './recordingFormat';

test('prefers MP4 when the browser reports MP4 support', () => {
  const format = findSupportedRecordingFormat((mimeType) => mimeType.startsWith('video/mp4'));
  assert.equal(format?.extension, 'mp4');
  assert.equal(format?.label, 'MP4');
});

test('falls back to WebM when MP4 is unavailable', () => {
  const format = findSupportedRecordingFormat((mimeType) => mimeType.startsWith('video/webm'));
  assert.equal(format?.extension, 'webm');
  assert.equal(format?.label, 'WebM');
});

test('returns no format when MediaRecorder supports none of the known containers', () => {
  assert.equal(findSupportedRecordingFormat(() => false), null);
});

test('continues checking MIME candidates if a browser probe throws', () => {
  let probes = 0;
  const format = findSupportedRecordingFormat(() => {
    probes++;
    if (probes === 1) throw new Error('unsupported MIME probe');
    return true;
  });
  assert.equal(probes, 2);
  assert.equal(format?.extension, 'mp4');
});

test('uses the recorder-reported container so a WebM is never named MP4', () => {
  const preferred = { mimeType: 'video/mp4', extension: 'mp4' as const, label: 'MP4' as const };
  assert.equal(resolveRecordingFormat('video/webm;codecs=vp8,opus', preferred)?.extension, 'webm');
  assert.equal(resolveRecordingFormat('video/mp4;codecs=avc1.42E01E', preferred)?.extension, 'mp4');
  assert.equal(resolveRecordingFormat('video/x-unknown', preferred), null);
});
