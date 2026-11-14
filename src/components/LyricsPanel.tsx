import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { autoSyncLyrics, cleanLyrics, getCueValidationError, LyricCue, SubtitleStyle, toSbv, toSrt } from '../engine/lyrics';

interface LyricsPanelProps {
  audioSamples: Float32Array | null;
  sampleRate: number;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  keyboardEnabled: boolean;
  cues: LyricCue[];
  text: string;
  onChangeText: (text: string) => void;
  onChangeCues: (cues: LyricCue[]) => void;
  subtitleStyle: SubtitleStyle;
  onChangeStyle: (style: SubtitleStyle) => void;
  getPlaybackTime: () => number;
  onStartPlayback: () => void;
  onSeek: (time: number) => void;
}
const buttonClass = 'rounded-lg border border-slate-700 bg-[#0D1320] px-2.5 py-2 text-xs text-slate-100 hover:border-sky-400 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
const fieldClass = 'w-full min-w-0 rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-400';

function CueTimeInput({ label, value, duration, onCommit }: { label: string; value: number; duration: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);
  return <input aria-label={label} type="number" min={0} max={duration} step={0.001} value={draft}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      const next = Number(draft);
      if (draft.trim() && Number.isFinite(next)) {
        const clamped = duration > 0 && next > duration && next <= duration + 1e-3 ? duration : next;
        onCommit(clamped);
        setDraft(String(Number(clamped.toFixed(3))));
      } else setDraft(String(Number(value.toFixed(3))));
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    className={fieldClass} />;
}

export function LyricsPanel(props: LyricsPanelProps) {
  const { audioSamples, sampleRate, duration, currentTime, isPlaying, keyboardEnabled, cues, text, onChangeText: setText, onChangeCues, subtitleStyle, onChangeStyle, getPlaybackTime, onStartPlayback, onSeek } = props;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tapIndex, setTapIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const validationError = cues.length ? getCueValidationError(cues, duration) : null;

  // App owns retiming only when the decoded track changes, never on panel remount.
  useEffect(() => {
    setTapIndex(null);
  }, [audioSamples, sampleRate]);

  const processText = (raw: string) => {
    setError('');
    setTapIndex(null);
    const lines = cleanLyrics(raw);
    setText(lines.join('\n'));
    if (!lines.length) {
      onChangeCues([]);
      setMessage('ไม่พบเนื้อร้องหลังตัดข้อความในวงเล็บ');
      return;
    }
    if (!audioSamples) {
      setError('กรุณารอให้ไฟล์เสียงพร้อม แล้วกดประมวลผลอีกครั้ง');
      return;
    }
    onChangeCues(autoSyncLyrics(lines, audioSamples, sampleRate));
    setMessage(`กรองแล้ว ${lines.length} บรรทัด และประมาณเวลาจากช่วงเสียงเรียบร้อย`);
  };

  const uploadText = async (file: File) => {
    try {
      if (!/\.txt$/i.test(file.name)) throw new Error('กรุณาเลือกไฟล์ .txt ที่เข้ารหัส UTF-8');
      if (file.size > 5 * 1024 * 1024) throw new Error('ไฟล์เนื้อร้องต้องมีขนาดไม่เกิน 5 MB');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      processText(raw);
    } catch (cause) {
      setError(cause instanceof TypeError ? 'อ่านไฟล์ไม่ได้ กรุณาบันทึกไฟล์ .txt เป็น UTF-8' : cause instanceof Error ? cause.message : 'อ่านไฟล์ไม่สำเร็จ');
    }
  };

  const tap = useCallback(() => {
    if (tapIndex === null || !isPlaying || !cues.length) return;
    const time = Math.min(duration, Math.max(0, getPlaybackTime()));
    if (tapIndex > 0 && time <= cues[tapIndex - 1].start + 0.01) {
      setError('เวลาเคาะต้องอยู่หลังบรรทัดก่อนหน้า กรุณาเล่นเพลงต่อก่อนเคาะ');
      return;
    }
    setError('');
    const next = cues.map(cue => ({ ...cue }));
    if (tapIndex > 0) next[tapIndex - 1].end = time;
    if (tapIndex === next.length) {
      onChangeCues(next);
      setTapIndex(null);
      setMessage('เคาะเวลาครบแล้ว ตรวจฟังและแก้ไขเวลาในตารางได้');
      return;
    }
    if (time >= duration) return;
    next[tapIndex].start = time;
    next[tapIndex].end = duration;
    onChangeCues(next);
    setTapIndex(tapIndex + 1);
    setMessage(tapIndex + 1 === next.length ? 'บรรทัดสุดท้ายกำลังร้อง เคาะอีกครั้งเมื่อร้องจบ' : `ล็อกบรรทัด ${tapIndex + 1} แล้ว เคาะเมื่อเริ่มบรรทัดถัดไป`);
  }, [tapIndex, isPlaying, cues, duration, getPlaybackTime, onChangeCues]);

  useEffect(() => {
    if (!keyboardEnabled || tapIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return;
      if (!isPlaying) return;
      event.preventDefault();
      tap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardEnabled, tapIndex, isPlaying, tap]);

  const download = (format: 'srt' | 'sbv') => {
    try {
      const invalid = getCueValidationError(cues, duration);
      if (invalid) throw new Error(invalid);
      const value = format === 'srt' ? toSrt(cues) : toSbv(cues);
      const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `miximage_lyrics.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ส่งออกซับไตเติลไม่สำเร็จ');
    }
  };

  const updateCue = (index: number, patch: Partial<LyricCue>) => {
    setTapIndex(null);
    onChangeCues(cues.map((cue, i) => i === index ? { ...cue, ...patch } : cue));
  };

  return (
    <section aria-labelledby="lyrics-heading" className="flex flex-col gap-2.5 py-1">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h2 id="lyrics-heading" className="text-sm font-semibold text-slate-100">ซับไตเติล (Lyrics)</h2>
        <button type="button" className={buttonClass} onClick={() => fileRef.current?.click()}><Upload className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />นำเข้า .TXT UTF-8</button>
        <input ref={fileRef} aria-label="อัปโหลดเนื้อเพลง .txt UTF-8" type="file" accept=".txt,text/plain" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadText(file); event.target.value = ''; }} />
      </div>
      <label htmlFor="lyrics-text" className="text-xs text-slate-300">เนื้อร้อง — หนึ่งบรรทัดต่อหนึ่งซับไตเติล</label>
      <textarea id="lyrics-text" value={text} onChange={event => setText(event.target.value)} rows={5} className={`${fieldClass} resize-y leading-relaxed`} placeholder={'[Verse 1]\nวางเนื้อเพลงที่นี่ (ร้องประสาน)\nระบบจะตัดข้อความในวงเล็บออก'} />
      <p className="text-[11px] leading-relaxed text-slate-400">ตัดข้อความทั้งหมดใน [...] และ (...) รวมบรรทัดว่างออกอัตโนมัติเมื่อนำเข้าไฟล์หรือกดประมวลผล</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={buttonClass} disabled={!audioSamples} onClick={() => processText(text)}>กรองและประมวลผลเนื้อร้อง</button>
        <button type="button" className={buttonClass} disabled={!cues.length || !audioSamples} onClick={() => { setTapIndex(null); onChangeCues(autoSyncLyrics(cues.map(cue => cue.text), audioSamples!, sampleRate)); setMessage('Auto-Sync ประมาณเวลาใหม่แล้ว กรุณาตรวจฟัง'); setError(''); }}>Auto-Sync</button>
      </div>
      <p className="text-[11px] leading-relaxed text-amber-200/80">Auto-Sync วิเคราะห์ระดับพลังงานจากเสียงที่ถอดรหัสด้วย Web Audio เพื่อประมาณเวลา ไม่ใช่การแยกเสียงร้องหรือรู้จำคำ ควรตรวจฟังและใช้ Tap-to-Sync เพื่อความแม่นยำ</p>
      <div className="rounded-lg border border-slate-700 p-2.5 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={!cues.length || !audioSamples} onClick={event => { event.currentTarget.blur(); setTapIndex(0); setError(''); setMessage('เพลงเริ่มจากต้น เคาะเมื่อเริ่มร้องบรรทัดแรก'); onStartPlayback(); }}>เริ่ม Tap-to-Sync จากต้นเพลง</button>
          {tapIndex !== null && <button type="button" className={buttonClass} onClick={() => { setTapIndex(null); setMessage('หยุดโหมดเคาะแล้ว ตรวจเวลาในตารางก่อนส่งออก'); }}>หยุดโหมดเคาะ</button>}
        </div>
        <button type="button" className={`${buttonClass} border-sky-700 bg-sky-950/50`} disabled={tapIndex === null || !isPlaying} onClick={tap}>เคาะจังหวะขึ้นบรรทัดถัดไป — Spacebar</button>
        <p className="text-[11px] text-slate-400">เคาะครั้งแรกตอนเริ่มบรรทัดแรก และเคาะอีกครั้งเมื่อบรรทัดสุดท้ายจบ ปุ่ม Space ใช้เฉพาะโหมดเคาะขณะเพลงเล่น และไม่รบกวนการพิมพ์</p>
        {tapIndex !== null && <p className="text-xs text-sky-300">{tapIndex < cues.length ? `รอขึ้นบรรทัด ${tapIndex + 1}: ${cues[tapIndex]?.text}` : 'รอจบบรรทัดสุดท้าย'} · {currentTime.toFixed(2)} วินาที{!isPlaying ? ' — กดเล่นพรีวิวเพื่อเล่นต่อ' : ''}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={subtitleStyle.enabled} onChange={event => onChangeStyle({ ...subtitleStyle, enabled: event.target.checked })} className="accent-sky-400" />แสดงซับไตเติล</label>
        <label className="inline-flex items-center gap-2">สี<input aria-label="สีซับไตเติล" type="color" value={subtitleStyle.color} onChange={event => onChangeStyle({ ...subtitleStyle, color: event.target.value })} className="w-9 h-7 bg-transparent" /></label>
        <label className="inline-flex items-center gap-2">ตำแหน่ง<select aria-label="ตำแหน่งซับไตเติล" value={subtitleStyle.position} onChange={event => onChangeStyle({ ...subtitleStyle, position: event.target.value as SubtitleStyle['position'] })} className={fieldClass}><option value="bottom">ล่าง</option><option value="middle">กลาง</option></select></label>
      </div>
      <label htmlFor="subtitle-font-size" className="text-xs text-slate-300">ขนาดตัวอักษร {subtitleStyle.fontSize} px ที่ด้านสั้น 1080 px</label>
      <input id="subtitle-font-size" type="range" min={24} max={96} step={2} value={subtitleStyle.fontSize} onChange={event => onChangeStyle({ ...subtitleStyle, fontSize: Number(event.target.value) })} className="w-full accent-sky-400" />
      {cues.length > 0 && <div className="max-h-64 overflow-auto rounded-lg border border-slate-700">
        <table className="w-full text-left text-xs border-collapse">
          <caption className="p-2 text-slate-400 text-left">{cues.length} บรรทัด · เวลาเป็นวินาที · กดหมายเลขเพื่อฟังตำแหน่งนั้น</caption>
          <thead className="bg-slate-900 sticky top-0"><tr><th className="p-2">#</th><th className="p-2">เริ่ม</th><th className="p-2">จบ</th><th className="p-2">เนื้อร้อง</th></tr></thead>
          <tbody>{cues.map((cue, index) => <tr key={cue.id} data-testid="lyric-row" className={currentTime >= cue.start && currentTime < cue.end ? 'bg-sky-950/70' : 'border-t border-slate-800'}>
            <td className="p-1"><button type="button" aria-label={`ฟังบรรทัด ${index + 1}`} className="text-sky-300 p-2" onClick={() => onSeek(cue.start)}>{index + 1}</button></td>
            <td className="p-1 w-20"><CueTimeInput label={`เวลาเริ่มบรรทัด ${index + 1}`} value={cue.start} duration={duration} onCommit={start => updateCue(index, { start })} /></td>
            <td className="p-1 w-20"><CueTimeInput label={`เวลาจบบรรทัด ${index + 1}`} value={cue.end} duration={duration} onCommit={end => updateCue(index, { end })} /></td>
            <td className="p-1"><input aria-label={`เนื้อร้องบรรทัด ${index + 1}`} value={cue.text} onChange={event => updateCue(index, { text: event.target.value })} onBlur={() => { const clean = cleanLyrics(cue.text).join(' '); if (!clean) onChangeCues(cues.filter((_, i) => i !== index)); else if (clean !== cue.text) updateCue(index, { text: clean }); }} className={fieldClass} /></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={buttonClass} disabled={!cues.length || Boolean(validationError) || tapIndex !== null} onClick={() => download('srt')}><Download className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />ดาวน์โหลด .SRT</button>
        <button type="button" className={buttonClass} disabled={!cues.length || Boolean(validationError) || tapIndex !== null} onClick={() => download('sbv')}><Download className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />ดาวน์โหลด .SBV</button>
      </div>
      {message && <p role="status" className="text-[11px] text-sky-200 leading-relaxed">{message}</p>}
      {(error || validationError) && <p role="alert" className="text-xs text-rose-300">{error || validationError}</p>}
    </section>
  );
}
