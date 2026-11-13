import type { LyricCue, SubtitleStyle } from './lyrics';

const FONT_FAMILY = '"Noto Sans Thai", sans-serif';
const MAX_LOOKBACK = 8;

interface Layout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

function activeCueAt(timeSec: number, cues: readonly LyricCue[]): LyricCue | undefined {
  if (!Number.isFinite(timeSec) || cues.length === 0) return undefined;

  // Cues are timeline ordered. Binary search keeps the per-frame lookup bounded;
  // the short backwards probe also handles an occasional overlapping cue.
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (cues[middle].start <= timeSec) low = middle + 1;
    else high = middle;
  }
  const lastStarted = low - 1;
  for (let i = lastStarted; i >= Math.max(0, lastStarted - MAX_LOOKBACK + 1); i -= 1) {
    const cue = cues[i];
    if (cue.start <= timeSec && timeSec < cue.end) return cue;
    // In a normally ordered, non-overlapping list no earlier cue can match.
    if (cue.end <= timeSec && i < lastStarted) break;
  }
  return undefined;
}

function graphemes(value: string): string[] {
  const SegmenterCtor = (Intl as typeof Intl & {
    Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  if (SegmenterCtor) {
    return Array.from(new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(value), part => part.segment);
  }
  return Array.from(value);
}

function splitLongToken(token: string, maxWidth: number, measure: (text: string) => number): string[] {
  const result: string[] = [];
  let current = '';
  for (const part of graphemes(token)) {
    const candidate = current + part;
    if (current && measure(candidate) > maxWidth) {
      result.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(current);
  return result.length ? result : [''];
}

function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];

  const tokens = normalized.split(/(\s+)/u).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const isSpace = /^\s+$/u.test(token);
    if (isSpace) continue;
    const candidate = line ? `${line} ${token}` : token;
    if (line && measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (measure(token) <= maxWidth) {
      line = token;
    } else {
      const pieces = splitLongToken(token, maxWidth, measure);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1];
    }
  }
  if (line) lines.push(line);
  return lines;
}

function makeLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  availableHeight: number,
  requestedSize: number,
  scale: number
): Layout | undefined {
  const minimumSize = Math.max(8, Math.min(requestedSize, scale * 12));
  let fontSize = Math.max(minimumSize, requestedSize);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
    const lines = wrapText(text, maxWidth, value => ctx.measureText(value).width);
    const lineHeight = fontSize * 1.2;
    const widest = lines.reduce((width, line) => Math.max(width, ctx.measureText(line).width), 0);
    if (lines.length && widest <= maxWidth + 0.5 && lines.length * lineHeight <= availableHeight) {
      return { lines, fontSize, lineHeight };
    }
    const heightRatio = lines.length ? availableHeight / (lines.length * lineHeight) : 0.8;
    const widthRatio = widest > maxWidth ? maxWidth / widest : 1;
    const ratio = Math.min(0.9, heightRatio, widthRatio);
    const next = Math.max(minimumSize, fontSize * (Number.isFinite(ratio) && ratio > 0 ? ratio : 0.82));
    if (next >= fontSize - 0.1) break;
    fontSize = next;
  }
  ctx.font = `700 ${minimumSize}px ${FONT_FAMILY}`;
  const lines = wrapText(text, maxWidth, value => ctx.measureText(value).width);
  const lineHeight = minimumSize * 1.2;
  return lines.length && lines.length * lineHeight <= availableHeight + 0.5
    ? { lines, fontSize: minimumSize, lineHeight }
    : undefined;
}

/** Draws the active lyric cue without changing the caller's canvas state. */
export function drawLyricsOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeSec: number,
  cues: readonly LyricCue[],
  style: SubtitleStyle
): void {
  if (!style.enabled || width <= 0 || height <= 0) return;
  const cue = activeCueAt(timeSec, cues);
  if (!cue || !cue.text.trim()) return;

  const minDimension = Math.min(width, height);
  const scale = minDimension / 1080;
  const margin = Math.max(12 * scale, minDimension * 0.05);
  const maxWidth = Math.max(1, width - margin * 2);
  const availableHeight = Math.max(1, height - margin * 2);
  const requestedSize = Math.max(8, Math.min(style.fontSize * scale, availableHeight * 0.22));

  ctx.save();
  try {
    const layout = makeLayout(ctx, cue.text, maxWidth, availableHeight, requestedSize, scale);
    if (!layout) return;

    ctx.font = `700 ${layout.fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style.color || '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, layout.fontSize * 0.12);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = Math.max(3, layout.fontSize * 0.18);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, layout.fontSize * 0.06);

    const blockHeight = layout.lines.length * layout.lineHeight;
    const centerY = style.position === 'middle'
      ? height / 2
      : height - margin - blockHeight / 2;
    const firstY = Math.max(margin + layout.lineHeight / 2, Math.min(height - margin - layout.lineHeight / 2, centerY - blockHeight / 2 + layout.lineHeight / 2));
    for (let index = 0; index < layout.lines.length; index += 1) {
      const y = firstY + index * layout.lineHeight;
      ctx.strokeText(layout.lines[index], width / 2, y, maxWidth);
      ctx.fillText(layout.lines[index], width / 2, y, maxWidth);
    }
  } finally {
    ctx.restore();
  }
}
