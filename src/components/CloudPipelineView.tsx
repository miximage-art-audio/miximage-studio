import React, { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Check, Copy, Download, FolderArchive } from 'lucide-react';
import {
  CloudWorkflowDefaults,
  generateCloudRenderYaml,
  generateRenderEnginePy,
  generateRequirementsTxt,
} from '../engine/codeTemplates';

interface CloudPipelineViewProps {
  defaults: CloudWorkflowDefaults;
}

type RepoFileKey = 'requirements' | 'engine' | 'workflow';

export const CloudPipelineView: React.FC<CloudPipelineViewProps> = ({ defaults }) => {
  const [activeFile, setActiveFile] = useState<RepoFileKey>('workflow');
  const [copiedKey, setCopiedKey] = useState<RepoFileKey | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  const files = useMemo(() => {
    return {
      requirements: {
        path: 'requirements.txt',
        filename: 'requirements.txt',
        summary: 'รายการไลบรารี Python สำหรับประมวลผลเสียงและภาพบน Ubuntu Runner',
        content: generateRequirementsTxt(),
      },
      engine: {
        path: 'render_engine.py',
        filename: 'render_engine.py',
        summary: 'โค้ดหลักระบบ Bass-Sync Physics (20–150Hz), 64-Band Neon Bloom และ Direct FFmpeg Pipe',
        content: generateRenderEnginePy(),
      },
      workflow: {
        path: '.github/workflows/cloud_render.yml',
        filename: 'cloud_render.yml',
        summary: 'ไฟล์ตั้งค่าเมนูสั่งงานบนหน้าเว็บ GitHub Actions (ค่าเริ่มต้นซิ้งกับสตูดิโอปัจจุบัน)',
        content: generateCloudRenderYaml(defaults),
      },
    };
  }, [defaults]);

  const current = files[activeFile];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(current.content);
      setCopiedKey(activeFile);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Fallback textarea copy
      const el = document.createElement('textarea');
      el.value = current.content;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedKey(activeFile);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  };

  const handleDownloadSingle = () => {
    const blob = new Blob([current.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = current.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    try {
      setZipError(null);
      const zip = new JSZip();
      zip.file('requirements.txt', files.requirements.content);
      zip.file('render_engine.py', files.engine.content);
      zip.file('.github/workflows/cloud_render.yml', files.workflow.content);
      zip.file(
        'input/README.txt',
        'วางไฟล์รูปภาพ (.jpg, .png, .webp, .bmp) 1 รูป และไฟล์เพลง (.mp3, .wav, .flac, .m4a, .aac, .ogg, .opus, .wma, .aiff) 1 เพลง ในโฟลเดอร์นี้\n'
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'miximage-cloud-pipeline.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : 'ไม่สามารถสร้างไฟล์ ZIP ได้');
    }
  };

  return (
    <section
      aria-label="ชุดโค้ดพร้อมใช้งานสำหรับ GitHub Actions"
      className="flex flex-col gap-6"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-slate-50">
            ชุดโค้ดพร้อมใช้งานบน GitHub Actions
          </h1>
          <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
            โค้ด Python และเวิร์กโฟลว์สำหรับรันเรนเดอร์แบบ Headless บน Ubuntu Cloud Runner
            โดยค่าเริ่มต้นในไฟล์ <span className="font-mono text-slate-200">cloud_render.yml</span>{' '}
            ถูกซิ้งให้ตรงกับการตั้งค่าในสตูดิโอของคุณโดยอัตโนมัติ ({defaults.ratio} · {defaults.style} ·{' '}
            {defaults.theme} · {defaults.bass.toFixed(1)}x · {defaults.fit} · {defaults.fps} FPS)
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadZip}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <FolderArchive className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>ดาวน์โหลดทั้งโปรเจกต์ (.ZIP)</span>
        </button>
      </div>

      {zipError && (
        <p role="alert" className="text-sm text-rose-400">
          {zipError}
        </p>
      )}

      {/* Repository Structure + Code Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Tree & File Switcher */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              โครงสร้าง Repository
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              สร้าง 3 ไฟล์นี้และโฟลเดอร์ <span className="font-mono text-slate-300">input/</span>{' '}
              ใน Repository ของคุณ
            </p>
          </div>

          <pre className="font-mono text-xs text-slate-300 bg-[#111827] border border-slate-800 rounded-xl p-4 overflow-x-auto leading-relaxed">
{`miximage-art-audio/
├── input/
├── requirements.txt
├── render_engine.py
└── .github/
    └── workflows/
        └── cloud_render.yml`}
          </pre>

          <div
            className="flex flex-col divide-y divide-slate-800/80 border border-slate-800 rounded-xl overflow-hidden bg-[#111827]"
            role="tablist"
            aria-label="เลือกไฟล์โค้ด"
          >
            {(['workflow', 'engine', 'requirements'] as RepoFileKey[]).map((key) => {
              const item = files[key];
              const active = activeFile === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveFile(key)}
                  className={`px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 ${
                    active
                      ? 'bg-sky-500/15 text-slate-50'
                      : 'text-slate-300 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold truncate">{item.path}</span>
                    {active && (
                      <span className="text-[11px] text-sky-300 font-medium shrink-0">
                        กำลังดู
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {item.summary}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Code Viewer */}
        <div className="lg:col-span-8 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-[#0D1320]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs font-semibold text-slate-100 truncate">
                {current.path}
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-xs text-slate-400 font-mono tabular-nums whitespace-nowrap">
                {current.content.split('\n').length} บรรทัด
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-xs font-medium text-slate-200 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                {copiedKey === activeFile ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                    <span>คัดลอกแล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>คัดลอกโค้ด</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadSingle}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-xs font-medium text-slate-200 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ดาวน์โหลดไฟล์</span>
              </button>
            </div>
          </div>

          <pre className="p-4 sm:p-5 font-mono text-xs text-slate-200 bg-[#090D16] overflow-x-auto max-h-[620px] leading-relaxed">
            <code>{current.content}</code>
          </pre>
        </div>
      </div>
    </section>
  );
};
