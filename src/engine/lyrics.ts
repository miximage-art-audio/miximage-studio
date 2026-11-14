export interface LyricCue {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface SubtitleStyle {
  enabled: boolean;
  fontSize: number;
  color: string;
  position: 'bottom' | 'middle';
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  enabled: true,
  fontSize: 48,
  color: '#ffffff',
  position: 'bottom',
};

/**
 * Removes balanced and unbalanced (), [] blocks with a small scanner rather
 * than a single regex: this supports nesting and blocks spanning newlines.
 * Unmatched closers are discarded while their surrounding text is retained;
 * an unmatched opener consumes the remainder of the input.
 */
export function cleanLyrics(input: string): string[] {
  const source = input.replace(/^\uFEFF+/, '').replace(/\r\n?/g, '\n');
  const output: string[] = [];
  let visible = '';
  const stack: string[] = [];
  const matching: Record<string, string> = { '(': ')', '[': ']' };

  for (const char of source) {
    if (matching[char]) {
      stack.push(matching[char]);
    } else if (char === ')' || char === ']') {
      const top = stack[stack.length - 1];
      if (top === char) stack.pop();
      // An unmatched closing delimiter is intentionally omitted.
    } else if (stack.length === 0) {
      visible += char;
    }
  }

  // Split after scanning so a multiline bracket block cannot leak a line.
  for (const line of visible.split('\n')) {
    const normalized = line.trim().replace(/\s+/g, ' ');
    if (normalized) output.push(normalized);
  }
  return output;
}

function graphemeLength(text: string): number {
  // Intl.Segmenter is not available in every browser; Array.from still counts
  // Unicode code points (and therefore handles Thai much better than length).
  const Segmenter = (globalThis as { Intl?: { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(s: string): Iterable<unknown> } } }).Intl?.Segmenter;
  if (Segmenter) {
    try { return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length; } catch { /* fallback */ }
  }
  return Array.from(text).length;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)))];
}

/** Estimate cue timing from mixed-track loudness; this is activity timing, not vocal recognition. */
export function autoSyncLyrics(lines: string[], samples: Float32Array, sampleRate: number): LyricCue[] {
  const texts = lines.map((line) => line.trim()).filter(Boolean);
  if (!texts.length || samples.length === 0) return [];
  const validRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const duration = samples.length / validRate;
  const weights = texts.map((text) => Math.max(1, graphemeLength(text)));
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  // 20 ms RMS windows with 10 ms hop provide stable activity without an FFT.
  const window = Math.max(1, Math.round(validRate * 0.02));
  const hop = Math.max(1, Math.round(validRate * 0.01));
  const energies: number[] = [];
  for (let start = 0; start < samples.length; start += hop) {
    const stop = Math.min(samples.length, start + window);
    let sum = 0;
    for (let i = start; i < stop; i++) {
      const value = Number.isFinite(samples[i]) ? samples[i] : 0;
      sum += value * value;
    }
    energies.push(Math.sqrt(sum / Math.max(1, stop - start)));
  }
  // Do not spread a potentially very large array into Math.max: long tracks
  // can exceed the engine's argument limit.
  let peak = 0;
  for (const energy of energies) peak = Math.max(peak, energy);
  const median = percentile(energies, 0.5);
  const noise = percentile(energies, 0.2);
  const threshold = Math.max(peak * 0.035, noise + (peak - noise) * 0.18, 1e-7);
  const active = energies.map((energy) => energy >= threshold);
  let first = active.indexOf(true);
  let last = active.lastIndexOf(true);
  if (first < 0 || !duration || !Number.isFinite(duration)) {
    first = 0;
    last = Math.max(0, energies.length - 1);
  }
  const regionStart = first * hop / validRate;
  const regionEnd = Math.min(duration, ((last + 1) * hop + window) / validRate);
  const start = Math.max(0, Math.min(duration, regionStart));
  const end = Math.max(start, Math.min(duration, regionEnd));

  // Cumulative active energy is the timing distribution. Silence is spread
  // evenly, while active material gets more boundary resolution by energy.
  const bins = Math.max(1, last - first + 1);
  const cumulative = [0];
  for (let i = first; i <= last; i++) {
    cumulative.push(cumulative[cumulative.length - 1] + Math.max(0, energies[i] - threshold));
  }
  const totalEnergy = cumulative[cumulative.length - 1];
  const boundaries = [start];
  let previous = start;
  let textTotal = 0;
  let degenerateDistribution = totalEnergy <= 0;
  for (let i = 0; i < texts.length - 1; i++) {
    textTotal += weights[i];
    const fraction = textTotal / weightTotal;
    let boundary: number;
    if (totalEnergy > 0 && !degenerateDistribution) {
      const target = totalEnergy * fraction;
      let bin = 0;
      while (bin < bins && cumulative[bin + 1] < target) bin++;
      const left = cumulative[bin];
      const right = cumulative[Math.min(bins, bin + 1)];
      const ratio = right > left ? (target - left) / (right - left) : 0;
      boundary = (first + bin + ratio) * hop / validRate;
      boundary = Math.max(start, Math.min(end, boundary));
    } else {
      boundary = start + (end - start) * fraction;
    }
    // Protect strict ordering even when a very short buffer has many lines.
    boundary = Math.max(previous, boundary);
    if (boundary <= previous && end > start) degenerateDistribution = true;
    boundaries.push(boundary);
    previous = boundary;
  }
  if (degenerateDistribution && end > start) {
    boundaries.length = 0;
    for (let i = 0; i < texts.length; i++) boundaries.push(start + (end - start) * i / texts.length);
  }
  boundaries.push(end);
  return texts.map((text, i) => {
    return { id: `cue-${i + 1}`, text, start: boundaries[i], end: Math.min(duration, boundaries[i + 1]) };
  });
}

export function getCueValidationError(cues: LyricCue[], duration?: number): string | null {
  if (!Array.isArray(cues)) return 'รูปแบบซับไตเติลไม่ถูกต้อง';
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) return 'ความยาวเสียงไม่ถูกต้อง';
  let previousEnd = 0;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue.text || !cue.text.trim()) return `บรรทัดที่ ${i + 1} ไม่มีข้อความ`;
    if (![cue.start, cue.end].every(Number.isFinite)) return `บรรทัดที่ ${i + 1} มีเวลาไม่ถูกต้อง`;
    if (cue.start < 0) return `บรรทัดที่ ${i + 1} เริ่มต้นก่อนเวลา 0`;
    if (cue.end <= cue.start) return `บรรทัดที่ ${i + 1} มีช่วงเวลาไม่ถูกต้อง`;
    if (i > 0 && cue.start < previousEnd) return `บรรทัดที่ ${i + 1} เวลาเรียงลำดับหรือทับซ้อนกัน`;
    if (duration !== undefined && cue.end > duration + 1e-3) return `บรรทัดที่ ${i + 1} เกินความยาวเสียง`;
    previousEnd = cue.end;
  }
  return null;
}

export function formatSubtitleTime(seconds: number, format: 'srt' | 'sbv'): string {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('เวลาซับไตเติลไม่ถูกต้อง');
  let millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3600000); millis %= 3600000;
  const minutes = Math.floor(millis / 60000); millis %= 60000;
  const secs = Math.floor(millis / 1000); millis %= 1000;
  const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return format === 'srt' ? `${base},${String(millis).padStart(3, '0')}` : `${base}.${String(millis).padStart(3, '0')}`;
}

function assertSerializable(cues: LyricCue[]): void {
  const error = getCueValidationError(cues);
  if (error) throw new Error(error);
  let previousEndMs = -1;
  for (const cue of cues) {
    const startMs = Math.round(cue.start * 1000);
    const endMs = Math.round(cue.end * 1000);
    if (endMs <= startMs) throw new Error('ช่วงเวลาซับไตเติลสั้นเกินไปหลังปัดเศษมิลลิวินาที');
    if (startMs < previousEndMs) throw new Error('ช่วงเวลาซับไตเติลทับซ้อนกันหลังปัดเศษมิลลิวินาที');
    previousEndMs = endMs;
  }
}

export function toSrt(cues: LyricCue[]): string {
  assertSerializable(cues);
  return cues.map((cue, i) => `${i + 1}\r\n${formatSubtitleTime(cue.start, 'srt')} --> ${formatSubtitleTime(cue.end, 'srt')}\r\n${cue.text}\r\n`).join('\r\n');
}

export function toSbv(cues: LyricCue[]): string {
  assertSerializable(cues);
  return cues.map((cue) => `${formatSubtitleTime(cue.start, 'sbv')},${formatSubtitleTime(cue.end, 'sbv')}\r\n${cue.text}\r\n`).join('\r\n');
}
