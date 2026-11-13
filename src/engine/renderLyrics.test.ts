import test from 'node:test';
import assert from 'node:assert/strict';
import { drawLyricsOverlay } from './renderLyrics';
import { DEFAULT_SUBTITLE_STYLE, type LyricCue, type SubtitleStyle } from './lyrics';

function mockContext() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const ctx = {
    calls,
    font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineJoin: '', lineCap: '',
    lineWidth: 0, shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    save() { calls.push({ name: 'save', args: [] }); },
    restore() { calls.push({ name: 'restore', args: [] }); },
    measureText(text: string) { return { width: Array.from(text).length * 20 }; },
    strokeText(...args: unknown[]) { calls.push({ name: 'strokeText', args }); },
    fillText(...args: unknown[]) { calls.push({ name: 'fillText', args }); },
  } as unknown as CanvasRenderingContext2D & { calls: typeof calls };
  return ctx;
}

const cue: LyricCue = { id: '1', text: 'สวัสดี โลก', start: 1, end: 2 };
const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontSize: 48, color: '#ff00aa', position: 'middle' };

test('drawLyricsOverlay renders only the active cue and honors style', () => {
  const ctx = mockContext();
  drawLyricsOverlay(ctx, 1080, 1080, 1.5, [cue], style);
  assert.equal(ctx.calls.filter((call) => call.name === 'save').length, 1);
  assert.equal(ctx.calls.filter((call) => call.name === 'restore').length, 1);
  const fill = ctx.calls.find((call) => call.name === 'fillText');
  assert.ok(fill);
  assert.equal(ctx.fillStyle, '#ff00aa');
  assert.equal(ctx.textAlign, 'center');
  assert.equal(ctx.textBaseline, 'middle');
  assert.equal(fill.args[1], 540);
  assert.equal(fill.args[2], 540);

  const inactive = mockContext();
  drawLyricsOverlay(inactive, 1080, 1080, 2, [cue], style);
  assert.equal(inactive.calls.length, 0);
  const disabled = mockContext();
  drawLyricsOverlay(disabled, 1080, 1080, 1.5, [cue], { ...style, enabled: false });
  assert.equal(disabled.calls.length, 0);
});

test('drawLyricsOverlay wraps long Thai text within the canvas and restores state', () => {
  const ctx = mockContext();
  const longCue = { ...cue, text: 'ภาษาไทยยาวมาก'.repeat(8) };
  drawLyricsOverlay(ctx, 640, 360, 1.5, [longCue], { ...style, position: 'bottom' });
  const textCalls = ctx.calls.filter((call) => call.name === 'fillText');
  assert.ok(textCalls.length > 1);
  for (const call of textCalls) {
    assert.equal(call.args[1], 320);
    assert.ok(Number(call.args[2]) >= 0 && Number(call.args[2]) <= 360);
  }
  assert.equal(ctx.calls.at(-1)?.name, 'restore');
});
