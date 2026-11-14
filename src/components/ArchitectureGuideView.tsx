import React from 'react';
import { ASPECT_RATIOS, AspectRatioKey } from '../engine/presets';

interface ArchitectureGuideViewProps {
  mode: 'architecture' | 'guide';
  onSwitchToCode: () => void;
}

export const ArchitectureGuideView: React.FC<ArchitectureGuideViewProps> = ({
  mode,
  onSwitchToCode,
}) => {
  if (mode === 'guide') {
    return (
      <section aria-label="คู่มือขั้นตอนการติดตั้งและใช้งานบน GitHub" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight text-slate-50">
              คู่มือขั้นตอนการติดตั้งและใช้งานบน GitHub ทีละขั้น
            </h1>
            <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
              รันเรนเดอร์วิดีโอความละเอียด Full HD บนเซิร์ฟเวอร์ GitHub Actions (Ubuntu Cloud Runner)
              ได้ฟรี 100% โดยไม่ใช้ทรัพยากรเครื่องของคุณ และสั่งงานซ้ำจากมือถือได้ทุกที่ทุกเวลา
            </p>
          </div>
          <button
            type="button"
            onClick={onSwitchToCode}
            className="px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-sm font-medium text-slate-100 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            ไปที่หน้าชุดโค้ดและดาวน์โหลด .ZIP
          </button>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <li className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-2">
            <h2 className="text-base font-semibold text-slate-50">
              01. สร้าง Repository ใหม่
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              เข้าไปใน Organization <span className="font-mono text-sky-300">miximage-art-audio</span>{' '}
              กดสร้าง Repository ใหม่ โดยแนะนำให้ตั้งค่าเป็น{' '}
              <span className="font-semibold text-slate-100">Private</span>{' '}
              เพื่อเก็บไฟล์เพลงและรูปภาพของคุณไว้เป็นส่วนตัว
            </p>
          </li>

          <li className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-2">
            <h2 className="text-base font-semibold text-slate-50">
              02. สร้างไฟล์ระบบทั้ง 3 ไฟล์
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              กดปุ่ม <span className="font-mono text-slate-100">Add file → Create new file</span>{' '}
              (หรือแตกไฟล์ ZIP จากแท็บโค้ด) เพื่อวางไฟล์{' '}
              <span className="font-mono text-sky-300">requirements.txt</span>,{' '}
              <span className="font-mono text-sky-300">render_engine.py</span> และ{' '}
              <span className="font-mono text-sky-300">.github/workflows/cloud_render.yml</span>
            </p>
          </li>

          <li className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-2">
            <h2 className="text-base font-semibold text-slate-50">
              03. อัปโหลดรูปภาพและไฟล์เพลง
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              สร้างโฟลเดอร์ชื่อ <span className="font-mono text-sky-300">input</span>{' '}
              แล้วอัปโหลดรูปภาพ 1 รูป (.jpg, .png, .webp, .bmp) และไฟล์เพลง 1 เพลง
              (.mp3, .wav, .flac, .m4a, .aac, .ogg, .opus, .wma, .aiff) เข้าไปในโฟลเดอร์นี้
            </p>
          </li>

          <li className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-2">
            <h2 className="text-base font-semibold text-slate-50">
              04. สั่งรันงานบนเซิร์ฟเวอร์ GitHub Actions
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              คลิกที่แถบ <span className="font-semibold text-slate-100">Actions</span> ด้านบนสุดของ Repository
              เลือกหัวข้อ <span className="text-slate-100">ระบบเรนเดอร์วิดีโอซิ้งเบสและคลื่นเสียงบนคลาวด์</span>{' '}
              แล้วกดปุ่ม <span className="font-semibold text-slate-100">Run workflow</span>{' '}
              เพื่อเลือกค่าภาษาไทยทั้ง 6 ข้อ (อัตราส่วน, รูปแบบคลื่น, โทนสี, ความแรงเบส, โหมดภาพ, FPS)
            </p>
          </li>

          <li className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-2 md:col-span-2">
            <h2 className="text-base font-semibold text-slate-50">
              05. ดาวน์โหลดวิดีโอสำเร็จรูป (.MP4)
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              รอเซิร์ฟเวอร์ทำงานประมาณ 1–2 นาที เมื่อขึ้นเครื่องหมายถูกสีเขียว ให้คลิกเข้าไปในงานนั้น
              เลื่อนลงมาด้านล่างสุดที่หัวข้อ <span className="font-semibold text-slate-100">Artifacts</span>{' '}
              แล้วคลิกดาวน์โหลดไฟล์วิดีโอความคมชัดสูง <span className="font-mono text-sky-300">miximage_render.mp4</span>{' '}
              (เข้ารหัส H.264 CRF 18 + เสียง AAC 320kbps) มาใช้งานได้ทันที
            </p>
          </li>
        </ol>
      </section>
    );
  }

  return (
    <section aria-label="เจาะลึกสถาปัตยกรรมและการทำงานของระบบ" className="flex flex-col gap-8">
      <div className="border-b border-slate-800 pb-5 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">
          เจาะลึกสถาปัตยกรรมระบบประมวลผลเสียงและภาพ (DSP Architecture)
        </h1>
        <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
          ออกแบบเพื่อแก้ปัญหาไฟล์เสียงหลาก Codec, อาการภาพสั่นมั่วจากเสียงร้อง,
          และการเรนเดอร์ความเร็วสูงผ่าน Direct FFmpeg Pipe โดยไม่เขียนเฟรมลงดิสก์
        </p>
      </div>

      {/* 3 Core Subsystems */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <article className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-50">
            01. ระบบจัดการไฟล์เสียง 2 ท่อขนาน
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            <span className="font-semibold text-slate-100">ท่อวิเคราะห์สัญญาณ (DSP Track):</span>{' '}
            ใช้ FFmpeg แปลงไฟล์ต้นฉบับทุกสกุล (.mp3, .wav, .flac, .m4a, .aac, .ogg, .opus, .wma, .aiff)
            เป็น WAV มาตรฐานชั่วคราว (44.1kHz, Mono) เพื่อวิเคราะห์ความถี่ได้แม่นยำ
          </p>
          <p className="text-sm text-slate-300 leading-relaxed">
            <span className="font-semibold text-slate-100">ท่อเสียงต้นฉบับ (Master Track):</span>{' '}
            ดึงเสียงต้นฉบับมาเข้ารหัส AAC 320kbps ในขั้นตอนสุดท้ายเพื่อให้เสียงใสคมชัด
          </p>
        </article>

        <article className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-50">
            02. ฟิสิกส์ภาพกระตุกย่านเบส (20–150Hz)
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            คัดกรองเฉพาะคลื่นความถี่ต่ำด้วย STFT Bandpass 20Hz–150Hz (ซับเบสและกระเดื่องกลอง)
            ผ่านสมการ Attack 80% / Release 28% ยกกำลัง 1.35 พร้อมคำนวณ Onset Flux เพื่อควบคุม 3 เอฟเฟกต์พร้อมกัน:
          </p>
          <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
            <li>Dynamic Zoom Punch: ขยายภาพตามจังหวะกระเดื่องกลอง (1.00x – 1.24x)</li>
            <li>Directional Micro-Shake: สั่นแกน X/Y เฉพาะช่วง Onset Flux พุ่งเกิน 18%</li>
            <li>Luminance Flash Boost: เร่งความสว่างภาพชั่วเสี้ยววินาทีที่เบสลงหนัก</li>
          </ul>
        </article>

        <article className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-50">
            03. คลื่นเสียง 64 ย่าน & Neon Bloom
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            แบ่งสเปกตรัม Mel-Scale 64 ย่านตั้งแต่ 30Hz ถึง 12,000Hz กรองความนุ่มนวลด้วย
            Gaussian Filter (sigma 0.65) วาดบนเลเยอร์โปร่งใสแล้วซ้อน Gaussian Blur
            แบบ Additive Blending 2 ชั้นเพื่อให้เกิดแสงฟุ้งเรืองแสงระดับสตูดิโอ
          </p>
          <p className="text-xs text-slate-400">
            เลือกได้ 15 สไตล์ (แท่ง 3D อีควอ และคลื่นแนวนอนหลากรูปแบบ) และ 4 โทนสี
          </p>
        </article>
      </div>

      {/* 7-Ratio Reference Table */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-slate-50">
            ตารางขนาดภาพ 7 อัตราส่วนมาตรฐาน Full HD (1080p Base)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            รองรับโหมด <span className="font-mono text-slate-200">cover</span> (ขยายเต็มกรอบจากจุดกึ่งกลาง)
            และ <span className="font-mono text-slate-200">blur_pad</span> (พื้นหลังเบลอลดสว่าง 55% + ภาพเต็มใบตรงกลาง)
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0D1320] text-xs font-semibold text-slate-300">
                <th className="py-3 px-5">อัตราส่วนภาพ</th>
                <th className="py-3 px-5">ขนาดพิกเซล (กว้าง × สูง)</th>
                <th className="py-3 px-5">คำอธิบาย</th>
                <th className="py-3 px-5">แพลตฟอร์มและการนำไปใช้งาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-sm">
              {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((key) => {
                const spec = ASPECT_RATIOS[key];
                return (
                  <tr key={key} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-5 font-mono font-semibold text-sky-300">
                      {spec.key}
                    </td>
                    <td className="py-3 px-5 font-mono tabular-nums text-slate-100">
                      {spec.width} × {spec.height} px
                    </td>
                    <td className="py-3 px-5 text-slate-200">{spec.label}</td>
                    <td className="py-3 px-5 text-slate-400">{spec.usage}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
