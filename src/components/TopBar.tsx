import React from 'react';
import { Film } from 'lucide-react';

export type WorkspaceTab = 'studio' | 'code' | 'architecture' | 'guide';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenRenderModal: () => void;
  isRendering: boolean;
  canRender: boolean;
}

const NAV_ITEMS: Array<{ key: WorkspaceTab; label: string }> = [
  { key: 'studio', label: 'สตูดิโอพรีวิว' },
  { key: 'code', label: 'โค้ด GitHub Actions' },
  { key: 'architecture', label: 'สถาปัตยกรรม DSP' },
  { key: 'guide', label: 'คู่มือติดตั้ง' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onOpenRenderModal,
  isRendering,
  canRender,
}) => {
  return (
    <header className="border-b border-slate-800/90 bg-[#0B101B]/95 backdrop-blur-sm sticky top-0 z-30 shrink-0">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 md:h-12 flex items-center justify-between gap-8">
        {/* Zone 1: Brand wordmark (single line, no badges/subtext) */}
        <button
          type="button"
          onClick={() => onSelectTab('studio')}
          className="text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 hover:text-sky-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded-md px-1"
        >
          MixImage Studio
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="เมนูหลัก"
          className="hidden md:flex items-center gap-6 overflow-x-auto"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelectTab(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`text-sm font-medium whitespace-nowrap shrink-0 py-1.5 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  active
                    ? 'border-sky-400 text-slate-50'
                    : 'border-transparent text-slate-400 hover:text-slate-100 hover:border-slate-700'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenRenderModal}
            disabled={!canRender || isRendering}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <Film className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{isRendering ? 'กำลังเรนเดอร์...' : 'เรนเดอร์ .MP4 / วิดีโอ'}</span>
          </button>
        </div>
      </div>

      {/* Mobile compact single-line nav bar */}
      <nav
        aria-label="เมนูหลักบนมือถือ"
        className="flex md:hidden items-center justify-between gap-1 px-3 pb-2 overflow-x-auto border-t border-slate-800/60 pt-1.5"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectTab(item.key)}
              aria-current={active ? 'page' : undefined}
              className={`text-[11px] font-medium whitespace-nowrap shrink-0 px-2 py-1 rounded-md transition-colors ${
                active
                  ? 'bg-slate-800 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
