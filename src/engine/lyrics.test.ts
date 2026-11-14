import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoSyncLyrics,
  cleanLyrics,
  formatSubtitleTime,
  getCueValidationError,
  toSbv,
  toSrt,
} from './lyrics';

test('cleanLyrics handles Thai, BOM, nested and multiline bracket blocks', () => {
  assert.deepEqual(cleanLyrics('\uFEFFสวัสดี [โลก (ลับ)]\r\n[ทั้งบรรทัด]\nต่อไป'), ['สวัสดี', 'ต่อไป']);
  assert.deepEqual(cleanLyrics('ก่อน (ตัด [ซ้อน]\nต่อ) หลัง [ค้าง'), ['ก่อน หลัง']);
  assert.deepEqual(cleanLyrics('เพลง (x) ดี [y] มาก'), ['เพลง ดี มาก']);
  assert.deepEqual(cleanLyrics('คงเหลือ ) ข้อความ ] ต่อ'), ['คงเหลือ ข้อความ ต่อ']);
});

test('cleanLyrics normalizes whitespace and removes empty bracket-only lines', () => {
  assert.deepEqual(cleanLyrics('  A   B  \n () \n [x] \n C\tD '), ['A B', 'C D']);
});

test('autoSync returns weighted, monotonic cues over active audio with intro and outro', () => {
  const sampleRate = 1000;
  const samples = new Float32Array(4000);
  for (let i = 700; i < 3300; i++) samples[i] = 0.7;
  const cues = autoSyncLyrics(['หนึ่ง', 'บรรทัดที่สอง', 'สาม'], samples, sampleRate);
  assert.equal(cues.length, 3);
  assert.ok(cues[0].start >= 0.68 && cues[0].start <= 0.7);
  assert.ok(cues[2].end <= 3.32 && cues[2].end > 3.0);
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].end > cues[i].start);
    if (i) assert.ok(cues[i].start >= cues[i - 1].end);
  }
});

test('autoSync safely spreads silence and many short lines within the buffer', () => {
  const cues = autoSyncLyrics(['a', 'b', 'c', 'd', 'e'], new Float32Array(100), 1000);
  assert.equal(cues.length, 5);
  assert.equal(cues[0].start, 0);
  assert.equal(cues.at(-1)?.end, 0.1);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end);
});

test('autoSync handles empty audio and long energy arrays without spread overflow', () => {
  assert.deepEqual(autoSyncLyrics(['ไม่มีเสียง'], new Float32Array(), 1000), []);
  const samples = new Float32Array(1_600_000);
  for (let i = 700_000; i < 900_000; i++) samples[i] = 0.8;
  const cues = autoSyncLyrics(['หนึ่ง', 'สอง'], samples, 1000);
  assert.equal(cues.length, 2);
  assert.ok(cues.every((cue) => cue.end > cue.start));
});

test('autoSync keeps sparse-pulse cues ordered with positive intervals', () => {
  const samples = new Float32Array(20_000);
  for (let i = 8_000; i < 8_040; i++) samples[i] = 1;
  const cues = autoSyncLyrics(Array.from({ length: 20 }, (_, i) => `บรรทัด ${i + 1}`), samples, 1000);
  assert.equal(cues.length, 20);
  for (const [index, cue] of cues.entries()) {
    assert.ok(cue.end > cue.start);
    if (index) assert.ok(cue.start >= cues[index - 1].end);
  }
});

test('cue validation reports Thai-friendly errors', () => {
  assert.equal(getCueValidationError([{ id: '1', text: 'ok', start: 0, end: 1 }], 1), null);
  assert.match(getCueValidationError([{ id: '1', text: ' ', start: 0, end: 1 }]) ?? '', /ข้อความ/);
  assert.match(getCueValidationError([{ id: '1', text: 'x', start: 2, end: 1 }]) ?? '', /เวลา/);
  assert.match(getCueValidationError([
    { id: '1', text: 'x', start: 0, end: 2 },
    { id: '2', text: 'y', start: 1, end: 3 },
  ]) ?? '', /ทับซ้อน/);
  assert.match(getCueValidationError([{ id: '1', text: 'x', start: 0, end: 2 }], 1) ?? '', /เกิน/);
  // 3-decimal UI rounding at fractional sub-millisecond track end (e.g. 44125 / 44100 = 1.00056689s -> 1.001s) should not fail
  assert.equal(getCueValidationError([{ id: '1', text: 'ok', start: 0, end: 1.001 }], 44125 / 44100), null);
});

test('subtitle timestamps round milliseconds with carry and support hours', () => {
  assert.equal(formatSubtitleTime(3661.9996, 'srt'), '01:01:02,000');
  assert.equal(formatSubtitleTime(3661.9996, 'sbv'), '01:01:02.000');
  assert.throws(() => formatSubtitleTime(-1, 'srt'));
  assert.throws(() => formatSubtitleTime(Number.NaN, 'sbv'));
});

test('toSrt and toSbv serialize UTF-8 text with CRLF and reject invalid cues', () => {
  const cues = [
    { id: 'a', text: 'สวัสดี', start: 0.001, end: 1.2 },
    { id: 'b', text: 'โลก', start: 2, end: 3661.5 },
  ];
  assert.equal(toSrt(cues), '1\r\n00:00:00,001 --> 00:00:01,200\r\nสวัสดี\r\n\r\n2\r\n00:00:02,000 --> 01:01:01,500\r\nโลก\r\n');
  assert.equal(toSbv(cues), '00:00:00.001,00:00:01.200\r\nสวัสดี\r\n\r\n00:00:02.000,01:01:01.500\r\nโลก\r\n');
  assert.throws(() => toSrt([{ id: 'x', text: 'bad', start: 1, end: 0 }]));
  assert.throws(() => toSrt([{ id: 'x', text: 'too short', start: 0.0011, end: 0.0014 }]));
});
